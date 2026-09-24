// Talks to the Apps Script endpoint and keeps an offline write queue.
import { applyOps } from "./logic.js";

const K_QUEUE = "iv_queue";
const K_CACHE = "iv_cache";

export function createSync({
  url,
  getToken,
  storage,
  fetchFn = (...a) => fetch(...a),
  newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36),
  onChange = () => {},
  onDrop = () => {},
}) {
  let queue = storage.get(K_QUEUE) || [];
  let state = queue.length ? "pending" : "ok";
  let flushing = null;

  const save = () => storage.set(K_QUEUE, queue);
  const status = () => ({ state, pending: queue.length });
  const set = s => { state = s; onChange(status()); };

  async function call(body) {
    try {
      // No headers: the browser sends text/plain, which skips the CORS preflight Apps Script can't answer.
      const r = await fetchFn(url, { method: "POST", body: JSON.stringify({ ...body, token: getToken() }) });
      return await r.json();
    } catch (e) {
      const err = new Error("network");
      err.code = "network";
      throw err;
    }
  }

  async function load() {
    let res;
    try { res = await call({ op: "get" }); } catch (e) { set("offline"); throw e; }
    if (!res.ok) {
      if (res.error === "bad_token") set("bad_token");
      const err = new Error(res.error);
      err.code = res.error;
      throw err;
    }
    const data = { words: res.words, log: res.log, daily: res.daily || {} };
    storage.set(K_CACHE, data);
    set(queue.length ? "pending" : "ok");
    return applyOps(data, queue);
  }

  function cached() {
    const c = storage.get(K_CACHE);
    return c ? applyOps(c, queue) : null;
  }

  function enqueue(op) {
    queue.push({ ...op, opId: newId() });
    save();
    set("pending");
    return flush();
  }

  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length) {
        const op = queue[0];
        let res;
        try { res = await call(op); } catch (e) { set("offline"); return; }
        if (!res.ok && res.error === "bad_token") { set("bad_token"); return; }
        queue.shift();
        save();
        if (res.ok) {
          const c = storage.get(K_CACHE);
          if (c) storage.set(K_CACHE, applyOps(c, [op]));
        } else {
          onDrop(op, res.error);
        }
      }
      set("ok");
    })().finally(() => { flushing = null; });
    return flushing;
  }

  return { load, cached, enqueue, flush, status };
}

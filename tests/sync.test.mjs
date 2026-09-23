import { test } from "node:test";
import assert from "node:assert/strict";
import { createSync } from "../sync.js";

function memStorage() {
  const m = new Map();
  return { get: k => (m.has(k) ? structuredClone(m.get(k)) : null), set: (k, v) => m.set(k, structuredClone(v)) };
}
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.headers, undefined);
    const body = JSON.parse(init.body);
    calls.push(body);
    const r = handler(body);
    if (r instanceof Error) throw r;
    return { json: async () => r };
  };
  fn.calls = calls;
  return fn;
}
const DATA = { words: [{ row: 2, w: "apple", fam: 0, date: "", cnt: 0 }], log: [] };
const FAM_OP = { op: "fam", row: 2, w: "apple", fam: 3, date: "2026-09-23" };
let n = 0;
function make(handler, extra = {}) {
  const storage = extra.storage || memStorage();
  const fetchFn = fakeFetch(handler);
  const sync = createSync({ url: "U", getToken: () => "T", storage, fetchFn, newId: () => "op" + ++n, ...extra });
  return { sync, storage, fetchFn };
}

test("load posts op:get with token and caches the result", async () => {
  const { sync, storage, fetchFn } = make(() => ({ ok: true, ...DATA }));
  const d = await sync.load();
  assert.deepEqual(fetchFn.calls[0], { op: "get", token: "T" });
  assert.deepEqual(d, DATA);
  assert.deepEqual(storage.get("iv_cache"), DATA);
  assert.deepEqual(sync.status(), { state: "ok", pending: 0 });
});

test("load with wrong token rejects bad_token", async () => {
  const { sync } = make(() => ({ ok: false, error: "bad_token" }));
  await assert.rejects(sync.load(), { code: "bad_token" });
  assert.equal(sync.status().state, "bad_token");
});

test("load network failure rejects network and marks offline", async () => {
  const { sync } = make(() => new TypeError("Failed to fetch"));
  await assert.rejects(sync.load(), { code: "network" });
  assert.equal(sync.status().state, "offline");
});

test("enqueue sends op with opId and token, empties queue, patches cache", async () => {
  const { sync, storage, fetchFn } = make(b => (b.op === "get" ? { ok: true, ...DATA } : { ok: true, cnt: 1 }));
  await sync.load();
  await sync.enqueue(FAM_OP);
  assert.ok(fetchFn.calls[1].opId);
  assert.equal(fetchFn.calls[1].token, "T");
  assert.equal(fetchFn.calls[1].fam, 3);
  assert.deepEqual(sync.status(), { state: "ok", pending: 0 });
  assert.equal(storage.get("iv_cache").words[0].fam, 3);
});

test("network failure keeps op queued and retries with the same opId", async () => {
  let online = false;
  const { sync, fetchFn } = make(() => (online ? { ok: true } : new TypeError("Failed to fetch")));
  await sync.enqueue(FAM_OP);
  assert.deepEqual(sync.status(), { state: "offline", pending: 1 });
  online = true;
  await sync.flush();
  assert.deepEqual(sync.status(), { state: "ok", pending: 0 });
  assert.equal(fetchFn.calls[0].opId, fetchFn.calls[1].opId);
});

test("cached() applies still-pending ops on top of the cache", async () => {
  let online = true;
  const { sync } = make(b => (!online ? new TypeError("x") : b.op === "get" ? { ok: true, ...DATA } : { ok: true }));
  await sync.load();
  online = false;
  await sync.enqueue(FAM_OP);
  const c = sync.cached();
  assert.equal(c.words[0].fam, 3);
  assert.equal(c.words[0].cnt, 1);
});

test("not_found drops the op and reports it", async () => {
  const dropped = [];
  const { sync } = make(() => ({ ok: false, error: "not_found" }), { onDrop: (op, err) => dropped.push(err) });
  await sync.enqueue(FAM_OP);
  assert.deepEqual(sync.status(), { state: "ok", pending: 0 });
  assert.deepEqual(dropped, ["not_found"]);
});

test("bad_token during flush keeps the op queued", async () => {
  const { sync } = make(() => ({ ok: false, error: "bad_token" }));
  await sync.enqueue(FAM_OP);
  assert.deepEqual(sync.status(), { state: "bad_token", pending: 1 });
});

test("queue survives a page reload (new instance, same storage)", async () => {
  const storage = memStorage();
  const a = make(() => new TypeError("offline"), { storage });
  await a.sync.enqueue(FAM_OP);
  const b = make(() => ({ ok: true }), { storage });
  assert.deepEqual(b.sync.status(), { state: "pending", pending: 1 });
  await b.sync.flush();
  assert.equal(b.fetchFn.calls[0].row, 2);
  assert.deepEqual(b.sync.status(), { state: "ok", pending: 0 });
});

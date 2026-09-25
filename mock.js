// In-memory stand-in for the Apps Script endpoint (same request/response contract). Used with ?mock=1.
export function createMockFetch(seed, token = "mock") {
  const data = structuredClone(seed);
  const seen = new Set();
  const reply = o => ({ json: async () => structuredClone(o) });
  return async (url, init) => {
    if (globalThis.__mockOffline) throw new TypeError("Failed to fetch");
    const req = JSON.parse(init.body);
    if (req.token !== token) return reply({ ok: false, error: "bad_token" });
    if (req.op === "get") return reply({ ok: true, words: data.words, log: data.log });
    if (req.opId && seen.has(req.opId)) return reply({ ok: true, dup: true });
    if (req.op === "fam") {
      const w = data.words.find(x => x.row === req.row);
      if (!w || w.w !== req.w) return reply({ ok: false, error: "not_found" });
      w.fam = req.fam;
      w.date = req.date;
      w.cnt = (w.cnt || 0) + 1;
      seen.add(req.opId);
      return reply({ ok: true, cnt: w.cnt });
    }
    if (req.op === "spell") {
      const w = data.words.find(x => x.row === req.row);
      if (!w || w.w !== req.w) return reply({ ok: false, error: "not_found" });
      w.spell = req.ok ? "對" : "錯";
      if (!req.ok) w.miss = (w.miss || 0) + 1;
      seen.add(req.opId);
      return reply({ ok: true });
    }
    if (req.op === "done") {
      data.log.push({ round: req.round, portion: req.portion, date: req.date, words: req.words, minutes: req.minutes, note: req.note || "" });
      seen.add(req.opId);
      return reply({ ok: true });
    }
    return reply({ ok: false, error: "bad_request" });
  };
}

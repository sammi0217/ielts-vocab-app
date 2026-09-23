import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockFetch } from "../mock.js";

const seed = { words: [{ row: 2, w: "apple", fam: 0, date: "", cnt: 0 }], log: [] };
const post = async (f, body) => (await f("mock", { method: "POST", body: JSON.stringify(body) })).json();

test("wrong token is rejected", async () => {
  assert.deepEqual(await post(createMockFetch(seed), { op: "get", token: "nope" }), { ok: false, error: "bad_token" });
});

test("get returns a copy of the seed", async () => {
  const f = createMockFetch(seed);
  const r = await post(f, { op: "get", token: "mock" });
  assert.deepEqual(r, { ok: true, ...seed });
});

test("fam updates the word once per opId", async () => {
  const f = createMockFetch(seed);
  const op = { op: "fam", token: "mock", opId: "a1", row: 2, w: "apple", fam: 2, date: "2026-09-23" };
  assert.deepEqual(await post(f, op), { ok: true, cnt: 1 });
  assert.deepEqual(await post(f, op), { ok: true, dup: true });
  const r = await post(f, { op: "get", token: "mock" });
  assert.deepEqual(r.words[0], { row: 2, w: "apple", fam: 2, date: "2026-09-23", cnt: 1 });
  assert.equal(seed.words[0].cnt, 0);
});

test("fam with a mismatched word is not_found", async () => {
  const r = await post(createMockFetch(seed), { op: "fam", token: "mock", opId: "b", row: 2, w: "pear", fam: 1, date: "2026-09-23" });
  assert.deepEqual(r, { ok: false, error: "not_found" });
});

test("done appends to the log", async () => {
  const f = createMockFetch(seed);
  await post(f, { op: "done", token: "mock", opId: "c", round: 1, portion: 1, date: "2026-09-23", words: 47, minutes: 9, note: "" });
  const r = await post(f, { op: "get", token: "mock" });
  assert.deepEqual(r.log, [{ round: 1, portion: 1, date: "2026-09-23", words: 47, minutes: 9, note: "" }]);
});

test("__mockOffline simulates a network failure", async () => {
  globalThis.__mockOffline = true;
  try {
    await assert.rejects(post(createMockFetch(seed), { op: "get", token: "mock" }), TypeError);
  } finally {
    globalThis.__mockOffline = false;
  }
});

# 試算表即時同步 + 份數首頁 + 卡片滑動 + 行事曆提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把單字複習網頁改成：首頁依日曆顯示今天做第幾份、卡片可左右滑、點熟悉度即時寫入 Google 試算表、可下載每天 8:00 的行事曆提醒，並發布到 GitHub Pages。

**Architecture:** 試算表綁一支 Apps Script Web App（全部走 POST + token）作為唯一資料源。前端是無框架的 ES modules：`logic.js`（純函式）、`sync.js`（API＋離線佇列）、`mock.js`（本機假後端）、`swipe.js`、`export.js`、`app.js`（DOM）。repo 不含任何單字內容。

**Tech Stack:** 純 HTML/CSS/JS（ES modules）、Google Apps Script、node:test（Node 26）、GitHub Pages、ExcelJS 4.4.0（CDN，僅匯出備份用）。

**Spec:** `docs/superpowers/specs/2026-09-23-sheet-sync-and-portion-home-design.md`

## Global Constraints

- 起始日 `START = "2026-09-23"`＝第 1 輪第 1 份；`round = floor(d/7)+1`、`portion = d mod 7 + 1`。
- 份數大小 `PORTION_SIZES = [47,47,47,47,47,46,46]`（共 327 字，依試算表順序）。
- 熟悉度文字 `["未學習","學習中","熟悉","已掌握"]`，前端以 0–3 表示。
- 試算表：`單字庫` A–N 欄、第 2 列起；`複習紀錄` A–F 欄、第 14 列起（輪次、份數、日期、本次複習單字數、花費時間、備註）。
- 寫入以 `row`（試算表列號）定位，並驗證 C 欄單字相符，不符回 `not_found`。
- 所有 API 呼叫都是 `POST`，body 為 JSON 字串、不設 Content-Type（瀏覽器預設 text/plain，避開 CORS preflight）；token 放 body，**絕不放網址參數**。
- repo 為 public：**不得 commit 任何單字資料**（`data/`、`dist/`、`mock/` 皆 gitignore），也不得 commit token 或 Sheet ID。
- 行事曆：每份每 7 天重複、08:00 Asia/Taipei、15 分鐘。
- 網址：`https://sammi0217.github.io/ielts-vocab-app/`，repo `sammi0217/ielts-vocab-app`。
- UI 文案用繁體中文；程式碼、註解、commit message 用英文。
- commit message 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## File Structure

| 檔案 | 責任 |
|---|---|
| `logic.js` | 純函式：日期、排程、份數狀態、輪數、`applyOps`、`swipeDecision`、`buildIcs` |
| `sync.js` | `createSync()`：呼叫 API、離線佇列（`iv_queue`）、快取（`iv_cache`）、狀態 |
| `mock.js` | `createMockFetch()`：與 Apps Script 相同契約的記憶體假後端（`?mock=1`） |
| `swipe.js` | `attachSwipe()`：Pointer Events 滑動／點擊判定與動畫 |
| `export.js` | `exportExcel(data)`：產生備份 xlsx Blob |
| `app.js` | 開機流程、首頁、卡片頁、列表、設定、鍵盤 |
| `index.html` | 結構＋樣式 |
| `apps-script/Code.gs` | 貼到試算表的 Apps Script |
| `tests/*.test.mjs` | node:test 單元測試 |
| `tools/make_mock.mjs` | 從本機 `dist/index.html` 抽出單字產生 `mock/data.json`（gitignored） |
| `package.json` | `"type":"module"`、`npm test` |

刪除：`app_template.html`、`build.py`、`dist/`（最後一個 task）。

---

### Task 1: Git 初始化與專案骨架

**Files:**
- Modify: `.gitignore`
- Create: `package.json`

**Interfaces:**
- Produces: `npm test` → `node --test tests/`；ESM 設定讓 `tests/*.mjs` 可 import 根目錄 `.js`。

- [ ] **Step 1: 改寫 `.gitignore`**

```gitignore
__pycache__/
*.pyc
.DS_Store
# vocabulary content is copyrighted — never commit it (repo is public)
data/
dist/
mock/
.claude/
node_modules/
```

- [ ] **Step 2: 建立 `package.json`**

```json
{
  "name": "ielts-vocab-app",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 3: git init 並確認沒有資料檔會被加入**

```bash
cd /Users/sammi/Documents/ielts-vocab-app
git init -b main
git add .gitignore package.json app_template.html build.py docs/
git status --short
```
Expected：只列出上述檔案；**不可**出現 `data/`、`dist/`、`README.md`（舊 README 含 Sheet ID，最後一個 task 會重寫後再加入）。

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: initialize repo with spec, plan and current template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `logic.js` 純函式＋單元測試

**Files:**
- Create: `logic.js`
- Test: `tests/logic.test.mjs`

**Interfaces:**
- Produces（全部 named export）：
  - `START: string`、`PORTION_SIZES: number[]`、`PORTION_BOUNDS: [number,number][]`、`FAM: string[]`
  - `ymd(d: Date): string`、`parseYmd(s): Date`、`addDays(s, n): string`、`daysBetween(a, b): number`
  - `fmtMD(s): string`（`"9/23"`）、`fmtMDW(s): string`（`"9/23（三）"`）
  - `schedule(today, start=START): {day, round, portion}`
  - `portionDate(round, k, start=START): string`
  - `isDone(log, round, k): boolean`
  - `portionStatus(log, round, k, today, start=START): "done"|"today"|"missed"|"upcoming"`
  - `canMarkDone(round, k, today, start=START): boolean`
  - `completedRounds(log): number`
  - `portionIndices(k): number[]`（0-based 單字索引）
  - `applyOps(data: {words, log}, ops): {words, log}`（不改動輸入）
  - `swipeDecision({dx, dy, dt, width}): "next"|"prev"|"cancel"`
  - `buildIcs({url, start=START, stamp="20260923T000000Z"}): string`
- 資料形狀：word `{row, cat, w, pos, zh, en, ex, exzh, syn, ant, fam, date, cnt, note}`；log `{round, portion, date, words, minutes, note}`；op `{op:"fam", row, w, fam, date, opId?}` 或 `{op:"done", round, portion, date, words, minutes, note, opId?}`。

- [ ] **Step 1: 寫失敗的測試 `tests/logic.test.mjs`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../logic.js";

test("schedule: start day is round 1 portion 1", () => {
  assert.deepEqual(L.schedule("2026-09-23"), { day: 0, round: 1, portion: 1 });
});

test("schedule: day 6 is portion 7, day 7 starts round 2", () => {
  assert.deepEqual(L.schedule("2026-09-29"), { day: 6, round: 1, portion: 7 });
  assert.deepEqual(L.schedule("2026-09-30"), { day: 7, round: 2, portion: 1 });
});

test("schedule: crosses month boundary", () => {
  assert.deepEqual(L.schedule("2026-10-08"), { day: 15, round: 3, portion: 2 });
});

test("schedule: dates before start clamp to round 1 portion 1", () => {
  assert.deepEqual(L.schedule("2026-09-01"), { day: 0, round: 1, portion: 1 });
});

test("date helpers", () => {
  assert.equal(L.addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(L.daysBetween("2026-09-23", "2026-10-01"), 8);
  assert.equal(L.fmtMD("2026-10-01"), "10/1");
  assert.equal(L.fmtMDW("2026-09-23"), "9/23（三）");
  assert.equal(L.ymd(new Date(2026, 8, 5)), "2026-09-05");
});

test("portionDate", () => {
  assert.equal(L.portionDate(1, 1), "2026-09-23");
  assert.equal(L.portionDate(1, 7), "2026-09-29");
  assert.equal(L.portionDate(2, 3), "2026-10-02");
});

test("portionStatus covers done / missed / today / upcoming", () => {
  const log = [{ round: 1, portion: 1, date: "2026-09-23", words: 47, minutes: 10, note: "" }];
  const t = "2026-09-25";
  assert.equal(L.portionStatus(log, 1, 1, t), "done");
  assert.equal(L.portionStatus(log, 1, 2, t), "missed");
  assert.equal(L.portionStatus(log, 1, 3, t), "today");
  assert.equal(L.portionStatus(log, 1, 4, t), "upcoming");
  assert.equal(L.portionStatus(log, 2, 1, t), "upcoming");
});

test("canMarkDone only on or after the portion date", () => {
  assert.equal(L.canMarkDone(1, 3, "2026-09-25"), true);
  assert.equal(L.canMarkDone(1, 2, "2026-09-25"), true);
  assert.equal(L.canMarkDone(1, 4, "2026-09-25"), false);
});

test("completedRounds counts rounds with all 7 portions", () => {
  const full = [1, 2, 3, 4, 5, 6, 7].map(k => ({ round: 1, portion: k }));
  assert.equal(L.completedRounds([]), 0);
  assert.equal(L.completedRounds(full.slice(0, 6)), 0);
  assert.equal(L.completedRounds(full), 1);
  assert.equal(L.completedRounds([...full, { round: 2, portion: 1 }, { round: 1, portion: 3 }]), 1);
});

test("portionIndices follow PORTION_SIZES", () => {
  assert.equal(L.portionIndices(1).length, 47);
  assert.equal(L.portionIndices(1)[0], 0);
  assert.equal(L.portionIndices(7).length, 46);
  assert.equal(L.portionIndices(7)[0], 281);
  assert.equal(L.portionIndices(7).at(-1), 326);
});

test("applyOps applies fam and done without mutating input", () => {
  const data = { words: [{ row: 2, w: "apple", fam: 0, date: "", cnt: 2 }], log: [] };
  const out = L.applyOps(data, [
    { op: "fam", row: 2, w: "apple", fam: 3, date: "2026-09-23" },
    { op: "fam", row: 9, w: "ghost", fam: 1, date: "2026-09-23" },
    { op: "done", round: 1, portion: 1, date: "2026-09-23", words: 47, minutes: 12, note: "" },
  ]);
  assert.deepEqual(out.words[0], { row: 2, w: "apple", fam: 3, date: "2026-09-23", cnt: 3 });
  assert.deepEqual(out.log, [{ round: 1, portion: 1, date: "2026-09-23", words: 47, minutes: 12, note: "" }]);
  assert.equal(data.words[0].fam, 0);
  assert.equal(data.log.length, 0);
});

test("swipeDecision", () => {
  const w = 400;
  assert.equal(L.swipeDecision({ dx: -150, dy: 10, dt: 400, width: w }), "next");
  assert.equal(L.swipeDecision({ dx: 150, dy: 10, dt: 400, width: w }), "prev");
  assert.equal(L.swipeDecision({ dx: -60, dy: 5, dt: 400, width: w }), "cancel");
  assert.equal(L.swipeDecision({ dx: -60, dy: 5, dt: 80, width: w }), "next");
  assert.equal(L.swipeDecision({ dx: -20, dy: 2, dt: 10, width: w }), "cancel");
  assert.equal(L.swipeDecision({ dx: -150, dy: 200, dt: 400, width: w }), "cancel");
});

test("buildIcs: 7 weekly-repeating 08:00 Taipei events, CRLF, folded lines", () => {
  const ics = L.buildIcs({ url: "https://sammi0217.github.io/ielts-vocab-app/" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 7);
  assert.equal(ics.match(/RRULE:FREQ=DAILY;INTERVAL=7/g).length, 7);
  assert.ok(ics.includes("DTSTART;TZID=Asia/Taipei:20260923T080000"));
  assert.ok(ics.includes("DTSTART;TZID=Asia/Taipei:20260929T080000"));
  assert.ok(ics.includes("SUMMARY:雅思 第1份（47字）"));
  assert.ok(ics.includes("SUMMARY:雅思 第7份（46字）"));
  const enc = new TextEncoder();
  for (const line of ics.split("\r\n")) assert.ok(enc.encode(line).length <= 75, line);
  assert.ok(!/[^\r]\n/.test(ics), "bare LF found");
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test`
Expected: FAIL，`Cannot find module '.../logic.js'`

- [ ] **Step 3: 實作 `logic.js`**

```js
// Pure helpers shared by the page and the tests. No DOM access here.

export const START = "2026-09-23"; // round 1, portion 1
export const PORTION_SIZES = [47, 47, 47, 47, 47, 46, 46];
export const PORTION_BOUNDS = (() => {
  const a = [];
  let s = 0;
  for (const n of PORTION_SIZES) { a.push([s, s + n]); s += n; }
  return a;
})();
export const FAM = ["未學習", "學習中", "熟悉", "已掌握"];
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/* ===== dates (local calendar days, "YYYY-MM-DD") ===== */
export function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
export function fmtMD(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function fmtMDW(s) {
  return `${fmtMD(s)}（${WD[parseYmd(s).getDay()]}）`;
}

/* ===== calendar-fixed schedule ===== */
export function schedule(today, start = START) {
  const day = Math.max(0, daysBetween(start, today));
  return { day, round: Math.floor(day / 7) + 1, portion: (day % 7) + 1 };
}
export function portionDate(round, k, start = START) {
  return addDays(start, (round - 1) * 7 + (k - 1));
}
export function isDone(log, round, k) {
  return log.some(r => r.round === round && r.portion === k);
}
export function portionStatus(log, round, k, today, start = START) {
  if (isDone(log, round, k)) return "done";
  const d = portionDate(round, k, start);
  if (d === today) return "today";
  return d < today ? "missed" : "upcoming";
}
export function canMarkDone(round, k, today, start = START) {
  return portionDate(round, k, start) <= today;
}
export function completedRounds(log) {
  const by = new Map();
  for (const r of log) {
    if (!by.has(r.round)) by.set(r.round, new Set());
    by.get(r.round).add(r.portion);
  }
  let n = 0;
  for (const s of by.values()) if ([1, 2, 3, 4, 5, 6, 7].every(k => s.has(k))) n++;
  return n;
}
export function portionIndices(k) {
  const [a, b] = PORTION_BOUNDS[k - 1];
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/* ===== replay queued writes on top of a snapshot ===== */
export function applyOps(data, ops) {
  const words = data.words.map(w => ({ ...w }));
  const log = data.log.map(r => ({ ...r }));
  for (const op of ops) {
    if (op.op === "fam") {
      const w = words.find(x => x.row === op.row && x.w === op.w);
      if (w) { w.fam = op.fam; w.date = op.date; w.cnt = (w.cnt || 0) + 1; }
    } else if (op.op === "done") {
      log.push({ round: op.round, portion: op.portion, date: op.date, words: op.words, minutes: op.minutes, note: op.note || "" });
    }
  }
  return { ...data, words, log };
}

/* ===== swipe ===== */
export function swipeDecision({ dx, dy, dt, width }) {
  const ax = Math.abs(dx);
  if (ax < Math.abs(dy)) return "cancel";
  const fast = ax > 30 && ax / Math.max(dt, 1) > 0.5;
  if (ax > width * 0.25 || fast) return dx < 0 ? "next" : "prev";
  return "cancel";
}

/* ===== calendar reminder (.ics) ===== */
function icsText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}
export function buildIcs({ url, start = START, stamp = "20260923T000000Z" }) {
  const L = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ielts-vocab-app//ZH-TW", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:雅思單字複習", "X-WR-TIMEZONE:Asia/Taipei",
    "BEGIN:VTIMEZONE", "TZID:Asia/Taipei", "BEGIN:STANDARD", "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "TZNAME:CST", "END:STANDARD", "END:VTIMEZONE",
  ];
  PORTION_SIZES.forEach((n, i) => {
    const k = i + 1;
    const d = portionDate(1, k, start).replace(/-/g, "");
    L.push(
      "BEGIN:VEVENT",
      `UID:ielts-vocab-portion-${k}@ielts-vocab-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Taipei:${d}T080000`,
      "DURATION:PT15M",
      "RRULE:FREQ=DAILY;INTERVAL=7",
      `SUMMARY:${icsText(`雅思 第${k}份（${n}字）`)}`,
      `DESCRIPTION:${icsText("打開複習：" + url)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`雅思 第${k}份`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT",
    );
  });
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npm test`
Expected: 全部 PASS（13 tests）

- [ ] **Step 5: Commit**

```bash
git add logic.js tests/logic.test.mjs
git commit -m "feat: add schedule, status, swipe and ics logic with tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `sync.js` 同步層＋`mock.js` 假後端

**Files:**
- Create: `sync.js`, `mock.js`
- Test: `tests/sync.test.mjs`, `tests/mock.test.mjs`

**Interfaces:**
- Consumes: `applyOps` from `logic.js`
- Produces:
  - `createSync({url, getToken, storage, fetchFn?, newId?, onChange?, onDrop?})` → `{load, cached, enqueue, flush, status}`
    - `storage`: `{get(key) → any|null, set(key, value)}`（JSON 值）
    - `load(): Promise<{words, log}>`：送 `{op:"get"}`；成功時寫入 `iv_cache`，回傳「快取＋未送佇列」合併後資料；失敗 reject，`err.code` 為 `"network"` 或伺服器 error 字串。
    - `cached(): {words, log}|null`
    - `enqueue(op): Promise<void>`：補上 `opId` 後放進 `iv_queue` 並 flush
    - `flush(): Promise<void>`（同時只會跑一個）
    - `status(): {state: "ok"|"pending"|"offline"|"bad_token", pending: number}`
    - `onChange(status)` 在狀態改變時呼叫；`onDrop(op, error)` 在一筆變更被伺服器拒絕（`not_found`、`bad_request`）而丟棄時呼叫。
  - `createMockFetch(seed, token="mock")` → 與 `fetch` 相同簽章 `(url, init) => Promise<{json()}>`；`globalThis.__mockOffline === true` 時丟出 `TypeError("Failed to fetch")`。

- [ ] **Step 1: 寫失敗的測試 `tests/sync.test.mjs`**

```js
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
```

- [ ] **Step 2: 寫失敗的測試 `tests/mock.test.mjs`**

```js
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
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `npm test`
Expected: FAIL，`Cannot find module '.../sync.js'` 與 `'.../mock.js'`

- [ ] **Step 4: 實作 `sync.js`**

```js
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
    const data = { words: res.words, log: res.log };
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
```

- [ ] **Step 5: 實作 `mock.js`**

```js
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
    if (req.op === "done") {
      data.log.push({ round: req.round, portion: req.portion, date: req.date, words: req.words, minutes: req.minutes, note: req.note || "" });
      seen.add(req.opId);
      return reply({ ok: true });
    }
    return reply({ ok: false, error: "bad_request" });
  };
}
```

- [ ] **Step 6: 執行測試確認通過**

Run: `npm test`
Expected: 全部 PASS（logic 13 + sync 9 + mock 6）

- [ ] **Step 7: Commit**

```bash
git add sync.js mock.js tests/sync.test.mjs tests/mock.test.mjs
git commit -m "feat: add sync layer with offline queue and mock backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Apps Script `apps-script/Code.gs`

**Files:**
- Create: `apps-script/Code.gs`

**Interfaces:**
- Produces: 與 `mock.js` 相同的契約（`doPost`：`get` / `fam` / `done`；錯誤 `bad_token` / `not_found` / `bad_request`）。
- 這個檔案要在 Google 環境才能執行，本 task 只做語法檢查；實際驗證在 Task 6。

- [ ] **Step 1: 建立 `apps-script/Code.gs`**

```js
/**
 * 雅思單字複習 — sync endpoint bound to the Google Sheet.
 * Setup: Extensions → Apps Script → paste this file → Project Settings → Script property TOKEN
 *        → Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Every request is a POST whose body is JSON: {token, op, ...}.
 */
const SHEET_WORDS = "單字庫";
const SHEET_LOG = "複習紀錄";
const LOG_START = 14;
const FAM = ["未學習", "學習中", "熟悉", "已掌握"];
const TZ = "Asia/Taipei";
const MAX_OPS = 200; // remembered opIds for idempotent retries (property value limit ~9KB)

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: "bad_request" });
  }
  const token = PropertiesService.getScriptProperties().getProperty("TOKEN");
  if (!token || req.token !== token) return out_({ ok: false, error: "bad_token" });
  if (req.op === "get") return out_(getAll_());

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (req.opId && seenOp_(req.opId)) return out_({ ok: true, dup: true });
    let res;
    if (req.op === "fam") res = setFam_(req);
    else if (req.op === "done") res = addLog_(req);
    else res = { ok: false, error: "bad_request" };
    if (res.ok && req.opId) rememberOp_(req.opId);
    return out_(res);
  } finally {
    lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
  return v ? String(v) : "";
}
function toDate_(s) {
  return Utilities.parseDate(s, TZ, "yyyy-MM-dd");
}
function toNum_(v) {
  const m = String(v == null ? "" : v).match(/\d+/);
  return m ? Number(m[0]) : 0;
}
function isYmd_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

function getAll_() {
  const ss = SpreadsheetApp.getActive();
  const ws = ss.getSheetByName(SHEET_WORDS);
  const last = ws.getLastRow();
  const words = [];
  if (last >= 2) {
    ws.getRange(2, 1, last - 1, 14).getValues().forEach((v, i) => {
      if (!v[2]) return;
      words.push({
        row: i + 2, cat: String(v[1] || ""), w: String(v[2]), pos: String(v[3] || ""),
        zh: String(v[4] || ""), en: String(v[5] || ""), ex: String(v[6] || ""), exzh: String(v[7] || ""),
        syn: String(v[8] || ""), ant: String(v[9] || "-"), fam: Math.max(0, FAM.indexOf(v[10])),
        date: ymd_(v[11]), cnt: Number(v[12]) || 0, note: String(v[13] || ""),
      });
    });
  }
  const lg = ss.getSheetByName(SHEET_LOG);
  const llast = lg.getLastRow();
  const log = [];
  if (llast >= LOG_START) {
    lg.getRange(LOG_START, 1, llast - LOG_START + 1, 6).getValues().forEach(r => {
      if (r[0] === "" && r[1] === "") return;
      log.push({
        round: toNum_(r[0]), portion: toNum_(r[1]), date: ymd_(r[2]),
        words: toNum_(r[3]), minutes: toNum_(r[4]), note: String(r[5] || ""),
      });
    });
  }
  return { ok: true, words: words, log: log };
}

function setFam_(req) {
  const f = Number(req.fam);
  if (!Number.isInteger(f) || f < 0 || f > 3 || !isYmd_(req.date)) return { ok: false, error: "bad_request" };
  const ws = SpreadsheetApp.getActive().getSheetByName(SHEET_WORDS);
  const row = Number(req.row);
  if (!(row >= 2 && row <= ws.getLastRow())) return { ok: false, error: "not_found" };
  if (String(ws.getRange(row, 3).getValue()) !== req.w) return { ok: false, error: "not_found" };
  const cnt = (Number(ws.getRange(row, 13).getValue()) || 0) + 1;
  ws.getRange(row, 11, 1, 3).setValues([[FAM[f], toDate_(req.date), cnt]]);
  return { ok: true, cnt: cnt };
}

function addLog_(req) {
  const round = Number(req.round), portion = Number(req.portion);
  if (!(round >= 1) || !(portion >= 1 && portion <= 7) || !isYmd_(req.date)) return { ok: false, error: "bad_request" };
  const lg = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  const n = Math.max(lg.getLastRow() - LOG_START + 1, 0);
  let row = LOG_START + n;
  if (n) {
    const vals = lg.getRange(LOG_START, 1, n, 2).getValues();
    for (let i = 0; i < n; i++) {
      if (vals[i][0] === "" && vals[i][1] === "") { row = LOG_START + i; break; }
    }
  }
  lg.getRange(row, 1, 1, 6).setValues([[
    round, portion, toDate_(req.date), Number(req.words) || 0, Number(req.minutes) || 0, String(req.note || ""),
  ]]);
  return { ok: true };
}

function opList_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty("OPS") || "[]");
  } catch (e) {
    return [];
  }
}
function seenOp_(id) {
  return opList_().indexOf(id) >= 0;
}
function rememberOp_(id) {
  const a = opList_();
  a.push(id);
  PropertiesService.getScriptProperties().setProperty("OPS", JSON.stringify(a.slice(-MAX_OPS)));
}
```

- [ ] **Step 2: 語法檢查**

node 不認 `.gs` 副檔名，先複製成 `.js` 再檢查（`$SCRATCH` 為本 session 的 scratchpad 目錄）：
```bash
cp apps-script/Code.gs "$SCRATCH/code_check.js" && node --check "$SCRATCH/code_check.js"
```
Expected：無輸出（語法正確）

- [ ] **Step 3: Commit**

```bash
git add apps-script/Code.gs
git commit -m "feat: add Apps Script sync endpoint for the Google Sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 新網頁 UI（`index.html`、`swipe.js`、`export.js`、`app.js`）＋ mock 實測

**Files:**
- Create: `index.html`, `swipe.js`, `export.js`, `app.js`, `tools/make_mock.mjs`, `.claude/launch.json`（gitignored）
- Delete: `app_template.html`（被 `index.html` 取代）、`build.py`

**Interfaces:**
- Consumes: `logic.js` 全部匯出；`createSync`（sync.js）；`createMockFetch`（mock.js）
- Produces:
  - `attachSwipe(el, {onSwipe(dir), onTap(), canSwipe(dir) → boolean})`
  - `exportExcel({words, log}) → Promise<Blob>`
  - `app.js` 常數 `SYNC_URL`（Task 6 填入）、`PAGE_URL`

- [ ] **Step 1: 建立 `swipe.js`**

```js
// Horizontal swipe + tap detection for the flashcard. Vertical drags are left to the browser (touch-action: pan-y).
import { swipeDecision } from "./logic.js";

export function attachSwipe(el, { onSwipe, onTap, canSwipe = () => true }) {
  let sx = 0, sy = 0, st = 0, id = null, axis = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const setX = (x, anim) => {
    el.style.transition = anim ? "transform .18s ease-out" : "none";
    el.style.transform = x ? `translateX(${x}px) rotate(${x * 0.03}deg)` : "";
  };

  el.addEventListener("pointerdown", e => {
    id = null;
    if (e.button !== 0 || e.target.closest("button")) return;
    id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now(); axis = null;
  });
  el.addEventListener("pointermove", e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!axis && Math.hypot(dx, dy) > 8) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") el.setPointerCapture(id);
    }
    if (axis === "x") setX(dx, false);
  });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!axis) { if (e.type === "pointerup") onTap(); return; }
    if (axis !== "x") return;
    const dir = e.type === "pointerup" ? swipeDecision({ dx, dy, dt: performance.now() - st, width: el.offsetWidth }) : "cancel";
    if (dir === "cancel" || !canSwipe(dir)) { setX(0, !reduce); return; }
    if (reduce) { setX(0, false); onSwipe(dir); return; }
    setX((dir === "next" ? -1 : 1) * el.offsetWidth * 1.2, true);
    setTimeout(() => { setX(0, false); onSwipe(dir); }, 180);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
```

- [ ] **Step 2: 建立 `export.js`**（由 `app_template.html:412-487` 改寫：資料改由參數傳入、日誌改為物件、說明文字改為新流程、移除 claude.ai downloads）

```js
// Backup export: builds the same three-sheet workbook as the Google Sheet. ExcelJS is loaded on demand.
import { FAM } from "./logic.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error(src));
    document.head.appendChild(s);
  });
}
async function ensureExcelJS() {
  if (window.ExcelJS) return;
  try { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"); } catch (e) {}
  if (!window.ExcelJS) await loadScript("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js");
  if (!window.ExcelJS) throw new Error("ExcelJS 載入失敗");
}
const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E5395" } };
const THIN = { style: "thin", color: { argb: "FFD9D9D9" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const toDate = s => (s ? new Date(s + "T00:00:00") : null);
function hdrRow(ws, rowNo, labels) {
  const r = ws.getRow(rowNo);
  labels.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h; c.fill = HDR; c.border = BORDER;
    c.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

export async function exportExcel({ words, log }) {
  await ensureExcelJS();
  const wb = new ExcelJS.Workbook();

  /* --- 單字庫 --- */
  const ws = wb.addWorksheet("單字庫", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  hdrRow(ws, 1, ["編號", "分類", "單字", "詞性", "中文解釋", "英文解釋", "例句 (IELTS 7.0)", "例句中文", "同義詞", "反義詞", "熟悉度", "上次複習日期", "複習次數", "備註"]);
  ws.columns = [6, 14, 22, 8, 16, 38, 42, 34, 22, 20, 10, 14, 10, 20].map(width => ({ width }));
  words.forEach((w, i) => {
    const r = ws.getRow(i + 2);
    const vals = [i + 1, w.cat, w.w, w.pos, w.zh, w.en, w.ex, w.exzh, w.syn, w.ant, FAM[w.fam], toDate(w.date), w.cnt || 0, w.note || null];
    vals.forEach((v, k) => {
      const c = r.getCell(k + 1);
      c.value = v; c.font = { name: "Arial", size: 10 }; c.border = BORDER;
      if ([5, 6, 7, 8].includes(k + 1)) c.alignment = { wrapText: true, vertical: "top" };
      else if ([1, 4, 11, 13].includes(k + 1)) c.alignment = { horizontal: "center", vertical: "top" };
      else c.alignment = { vertical: "top", wrapText: true };
      if (k + 1 === 12) c.numFmt = "yyyy-mm-dd";
    });
  });
  const last = words.length + 1, rng = `K2:K${last + 500}`;
  ws.autoFilter = `A1:N${last}`;
  ws.dataValidations.add(rng, { type: "list", allowBlank: true, formulae: ['"未學習,學習中,熟悉,已掌握"'], showErrorMessage: true, errorTitle: "輸入錯誤", error: "請從清單選擇：未學習／學習中／熟悉／已掌握" });
  const fill = a => ({ type: "pattern", pattern: "solid", bgColor: { argb: a } });
  ws.addConditionalFormatting({ ref: rng, rules: [
    { type: "cellIs", operator: "equal", formulae: ['"未學習"'], style: { fill: fill("FFFCE4E4") } },
    { type: "cellIs", operator: "equal", formulae: ['"學習中"'], style: { fill: fill("FFFFF2CC") } },
    { type: "cellIs", operator: "equal", formulae: ['"熟悉"'], style: { fill: fill("FFDDEBF7") } },
    { type: "cellIs", operator: "equal", formulae: ['"已掌握"'], style: { fill: fill("FFD9EAD3") } },
  ] });

  /* --- 複習紀錄 --- */
  const w2 = wb.addWorksheet("複習紀錄");
  const end = last + 500;
  const L = (r, a, b) => {
    w2.getCell(r, 1).value = a; w2.getCell(r, 1).font = { name: "Arial", size: 10, bold: true };
    const c = w2.getCell(r, 2);
    c.value = b; c.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF2E5395" } }; c.alignment = { horizontal: "center" };
  };
  w2.getCell(1, 1).value = "單字進步系統儀表板";
  w2.getCell(1, 1).font = { name: "Arial", size: 14, bold: true, color: { argb: "FF2E5395" } };
  w2.mergeCells("A1:E1");
  L(3, "總單字數", { formula: `COUNTA('單字庫'!C2:C${end})` });
  L(4, "未學習", { formula: `COUNTIF('單字庫'!K2:K${end},"未學習")` });
  L(5, "學習中", { formula: `COUNTIF('單字庫'!K2:K${end},"學習中")` });
  L(6, "熟悉", { formula: `COUNTIF('單字庫'!K2:K${end},"熟悉")` });
  L(7, "已掌握", { formula: `COUNTIF('單字庫'!K2:K${end},"已掌握")` });
  L(8, "掌握率（已掌握 / 總單字數）", { formula: "IFERROR(B7/B3,0)" });
  w2.getCell(8, 2).numFmt = "0.0%";
  w2.getCell(10, 1).value = "網頁點熟悉度會即時寫入 Google 試算表；這份檔案是備份。";
  w2.getCell(10, 1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF808080" } };
  w2.mergeCells("A10:G10");
  w2.getCell(12, 1).value = "7 份輪替複習紀錄（327 字分 7 份，一天一份；7 份跑完＝1 輪）";
  w2.getCell(12, 1).font = { name: "Arial", size: 11, bold: true };
  w2.mergeCells("A12:G12");
  hdrRow(w2, 13, ["輪次", "份數（1–7）", "日期", "本次複習單字數", "花費時間（分鐘）", "備註"]);
  for (let i = 0; i < Math.max(20, log.length); i++) {
    const r = w2.getRow(14 + i), e = log[i];
    const src = e ? [e.round, e.portion, toDate(e.date), e.words, e.minutes, e.note || null] : [];
    for (let c = 1; c <= 6; c++) {
      const cell = r.getCell(c);
      cell.value = src[c - 1] ?? null; cell.font = { name: "Arial", size: 10 }; cell.border = BORDER;
      if (c === 3) cell.numFmt = "yyyy-mm-dd";
    }
  }
  w2.columns = [28, 16, 12, 16, 16, 30].map(width => ({ width }));

  /* --- 使用說明 --- */
  const w3 = wb.addWorksheet("使用說明");
  w3.columns = [{ width: 100 }];
  const lines = [
    ["單字進步系統 — 使用說明", { size: 14, bold: true, color: { argb: "FF2E5395" } }], [""],
    ["【工作表說明】", { bold: true }],
    [`1. 單字庫：${words.length} 個單字（來自《Pin IELTS 雅思單字本》），含詞性、中英文解釋、例句、同義詞、反義詞、熟悉度、上次複習日期、複習次數。`],
    ["2. 複習紀錄：自動統計各熟悉度單字數量與掌握率，並附 7 份輪替的複習紀錄表。"],
    ["3. 使用說明：本頁。"], [""],
    ["【複習方式（7 份輪替，依日曆固定）】", { bold: true }],
    ["・327 字依順序切成 7 份（每份 46–47 字）。從 2026-09-23 起，第 1 天第 1 份、第 2 天第 2 份……7 天一輪。"],
    ["・原則是快速、大量、多次：每個字不要過度糾結，輪替次數越多印象越深。"], [""],
    ["【與網頁同步】", { bold: true }],
    ["・在網頁點熟悉度，會即時寫入這份試算表（熟悉度、上次複習日期、複習次數 +1）。"],
    ["・網頁上按「標記完成」會在「複習紀錄」新增一列。"],
    ["・新增單字：在單字庫最後一列加入，網頁重新整理即可看到（不在 7 份輪替內，可在篩選列表複習）。"],
    ["・請勿重新排序單字庫的列；網頁以列號對應單字。"],
  ];
  lines.forEach((l, i) => {
    const c = w3.getCell(i + 1, 1);
    c.value = l[0]; c.font = { name: "Arial", size: 10, ...(l[1] || {}) }; c.alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
```

- [ ] **Step 3: 建立 `index.html`**（沿用 `app_template.html:11-151` 的色票與元件樣式，新增首頁、份數格、卡片頁、完成畫面、設定頁）

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>雅思單字複習</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#EAE3F5; --surface:#FFFFFF; --ink:#1E1D24; --muted:#7B7A87; --line:#E9E6F0;
  --dark:#1C1B21; --dark-ink:#FFFFFF;
  --lilac:#DCD1F2; --mint:#D6E9E3; --lemon:#FBE6A3; --sky:#C9D3EF;
  --f0:#EDEBF3; --f1:#FBE6A3; --f2:#C9D3EF; --f3:#CFE8DE;
  --f0-ink:#5A5966; --f1-ink:#5A4300; --f2-ink:#2B3A6B; --f3-ink:#1F5A45;
  --miss:#F6D6D6; --miss-ink:#8A2B2B;
  --shadow:0 10px 30px rgba(60,40,110,.10);
  --sans:"Poppins","Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
  box-sizing:border-box;
  padding-top:env(safe-area-inset-top,0px); padding-bottom:env(safe-area-inset-bottom,0px);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#1B1826; --surface:#26223A; --ink:#F1EEF8; --muted:#A39FB5; --line:#352F4B;
    --dark:#F1EEF8; --dark-ink:#1B1826;
    --lilac:#3E3560; --mint:#2B4A43; --lemon:#5E4E1E; --sky:#2F3A5E;
    --f0:#332F45; --f1:#5E4E1E; --f2:#2F3A5E; --f3:#2B4A43;
    --f0-ink:#D8D4E6; --f1-ink:#F7E3A1; --f2-ink:#C8D6F5; --f3-ink:#BFEAD6;
    --miss:#4E2A31; --miss-ink:#F3C9CF;
    --shadow:0 10px 30px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  --bg:#1B1826; --surface:#26223A; --ink:#F1EEF8; --muted:#A39FB5; --line:#352F4B;
  --dark:#F1EEF8; --dark-ink:#1B1826;
  --lilac:#3E3560; --mint:#2B4A43; --lemon:#5E4E1E; --sky:#2F3A5E;
  --f0:#332F45; --f1:#5E4E1E; --f2:#2F3A5E; --f3:#2B4A43;
  --f0-ink:#D8D4E6; --f1-ink:#F7E3A1; --f2-ink:#C8D6F5; --f3-ink:#BFEAD6;
  --miss:#4E2A31; --miss-ink:#F3C9CF;
  --shadow:0 10px 30px rgba(0,0,0,.35);
}
*,*::before,*::after{box-sizing:inherit}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
select,input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:9px 14px;min-height:42px}
.wrap{max-width:560px;margin:0 auto;padding:14px 16px 40px}
.hidden{display:none !important}

/* header + tabs */
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 0 6px}
.brand{font-size:26px;font-weight:600;line-height:1.2;letter-spacing:-.01em}
.brand small{display:block;font-size:12px;color:var(--muted);font-weight:500;margin-top:2px}
.icon-btn{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line);background:var(--surface);font-size:18px}
.tabs{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px;margin:10px 0 14px}
.tab{padding:8px 16px;border-radius:999px;color:var(--muted);font-weight:500}
.tab[aria-selected="true"]{background:var(--dark);color:var(--dark-ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:10px 18px;min-height:44px;font-weight:500}
.btn.primary{background:var(--dark);color:var(--dark-ink);border-color:var(--dark)}
.btn:disabled{opacity:.45;cursor:default}
.hint{color:var(--muted);font-size:13px}
.sync{font-size:12px;color:var(--muted);font-weight:500;white-space:nowrap}

/* home */
.today{position:relative;background:var(--lilac);border-radius:28px;padding:20px 20px 18px;margin-bottom:14px;overflow:hidden}
.today::after{content:"✦";position:absolute;right:18px;top:12px;font-size:24px;color:rgba(255,255,255,.75)}
.today::before{content:"✦";position:absolute;right:48px;top:40px;font-size:11px;color:rgba(255,255,255,.8)}
.t-date{font-size:14px;font-weight:500;opacity:.75}
.t-main{font-size:30px;font-weight:600;line-height:1.2;margin:4px 0 2px;letter-spacing:-.01em}
.t-sub{font-size:13px;opacity:.72;margin-bottom:14px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.tile{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 10px;border-radius:20px;background:var(--surface);border:2px solid transparent;text-align:left;min-height:88px}
.tile b{font-size:14px;font-weight:600}
.tile span{font-size:12px;color:var(--muted)}
.tile em{font-style:normal;font-size:12px;font-weight:500;margin-top:auto;padding:2px 8px;border-radius:999px;background:var(--f0);color:var(--f0-ink)}
.st-today{border-color:var(--ink)}
.st-today em{background:var(--lemon);color:var(--f1-ink)}
.st-done em{background:var(--f3);color:var(--f3-ink)}
.st-missed em{background:var(--miss);color:var(--miss-ink)}
.st-upcoming{opacity:.72}
.home-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--muted);font-size:13px;font-weight:500}

/* cards */
.cards-top{display:flex;align-items:center;gap:10px;padding:8px 0 4px}
.cards-top b{flex:1;min-width:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbar{height:8px;background:var(--surface);border-radius:999px;margin:8px 0 14px;overflow:hidden}
.cbar i{display:block;height:100%;background:var(--dark);border-radius:999px;width:0;transition:width .25s ease}
.swipe{touch-action:pan-y;user-select:none;-webkit-user-select:none;margin-bottom:12px}
.stage{perspective:1400px}
.card{display:grid;min-height:320px;transform-style:preserve-3d;transition:transform .45s cubic-bezier(.2,.7,.2,1)}
.card.flipped{transform:rotateY(180deg)}
@media (prefers-reduced-motion: reduce){.card{transition:none}}
.face{grid-area:1/1;position:relative;min-height:320px;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:var(--surface);border-radius:28px;padding:22px 22px 20px;display:flex;flex-direction:column;cursor:pointer;box-shadow:var(--shadow)}
.face.back{transform:rotateY(180deg);background:var(--mint)}
.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--muted);font-size:13px;font-weight:500}
.meta .cat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.word{font-size:34px;line-height:1.15;font-weight:600;margin:18px 0 2px;word-break:break-word;letter-spacing:-.01em}
.pos{color:var(--muted);font-size:15px;font-weight:500}
.ex{margin-top:auto;padding-top:16px;border-top:1px dashed var(--line);font-size:17px;line-height:1.5;font-weight:500}
.ex-zh{color:var(--muted);font-size:14px;margin-top:6px}
.speak{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;margin-top:10px;padding:8px 14px;border-radius:999px;background:var(--lemon);align-self:flex-start}
.zh{font-size:26px;font-weight:600;margin:14px 0 4px}
.def{font-size:15px;line-height:1.55}
.bex{margin-top:14px;padding-top:12px;border-top:1px dashed rgba(0,0,0,.12);font-size:14px;line-height:1.5}
.bex span{display:block;opacity:.6;font-size:12px;font-weight:500;margin-bottom:2px}
.face.back .ex-zh{color:var(--ink);opacity:.75;margin-top:2px}
.pairs{margin-top:auto;padding-top:14px;border-top:1px dashed rgba(0,0,0,.12);display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px}
.pairs span{display:block;opacity:.6;font-size:12px;margin-bottom:2px;font-weight:500}
.fam-tag{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.fam-0{background:var(--f0);color:var(--f0-ink)} .fam-1{background:var(--f1);color:var(--f1-ink)}
.fam-2{background:var(--f2);color:var(--f2-ink)} .fam-3{background:var(--f3);color:var(--f3-ink)}
.rate{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
.rate button{border-radius:18px;padding:12px 4px;min-height:52px;font-size:14px;font-weight:500;border:2px solid transparent}
.rate .r0{background:var(--f0);color:var(--f0-ink)} .rate .r1{background:var(--f1);color:var(--f1-ink)}
.rate .r2{background:var(--f2);color:var(--f2-ink)} .rate .r3{background:var(--f3);color:var(--f3-ink)}
.rate button.on{border-color:var(--ink)}
.nav{display:flex;justify-content:center;align-items:center;gap:8px}
.nav .btn{display:none}
.pos-ind{color:var(--muted);font-size:13px;font-weight:500}
.kbd{display:none;color:var(--muted);font-size:12px;margin-top:10px;text-align:center}
@media (min-width:768px){.nav{justify-content:space-between}.nav .btn{display:inline-flex}.kbd{display:block}}
.done-card{background:var(--mint);border-radius:28px;padding:32px 22px;text-align:center;box-shadow:var(--shadow)}
.done-card h2{font-size:26px;margin:0 0 6px;font-weight:600}
.done-card p{opacity:.72;margin:0 0 18px}
.done-card .btn{width:100%;margin-top:8px}

/* list */
.list-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.list-tools input,.list-tools .btn{grid-column:1/-1}
.count{color:var(--muted);font-size:13px;font-weight:500;margin-bottom:8px}
.tbl{width:100%;border-collapse:separate;border-spacing:0 8px}
.tbl td{padding:12px 14px;background:var(--surface);vertical-align:top}
.tbl td:first-child{border-radius:20px 0 0 20px}
.tbl td:last-child{border-radius:0 20px 20px 0}
.tbl .w{font-size:17px;font-weight:600}
.tbl .w i{color:var(--muted);font-size:13px;margin-left:6px;font-style:normal;font-weight:500}
.tbl .z{color:var(--muted);font-size:14px}
.tbl select{min-height:36px;padding:5px 12px;font-size:13px}
.tbl .c{color:var(--muted);font-size:12px}
.empty{padding:32px;text-align:center;color:var(--muted);border-radius:20px !important}

/* setup, settings sheet, toast */
.setup{background:var(--surface);border-radius:28px;padding:24px 20px;margin-top:40px;box-shadow:var(--shadow)}
.setup h1{font-size:22px;margin:0 0 6px;font-weight:600}
.setup input{width:100%;margin:12px 0}
.setup .btn{width:100%}
.msg{color:var(--miss-ink);font-size:14px;min-height:20px;margin-top:8px}
.sheet{position:fixed;inset:0;background:rgba(30,20,60,.45);display:none;align-items:flex-end;justify-content:center;z-index:20}
.sheet.open{display:flex}
.panel{background:var(--surface);border-radius:28px 28px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));width:100%;max-width:560px;max-height:85vh;overflow:auto}
.panel h2{font-size:20px;margin:0 0 10px;font-weight:600}
.panel p{margin:8px 0;font-size:13px;color:var(--muted)}
.opt{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line)}
.opt input{flex:1;min-width:0}
.full{width:100%;margin-top:12px}
.status{font-size:14px;margin-top:10px;min-height:20px}
.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--dark);color:var(--dark-ink);padding:10px 18px;border-radius:999px;font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:30;white-space:nowrap}
.toast.show{opacity:1}
@media (max-width:430px){
  .wrap{padding:10px 16px 32px}
  .brand{font-size:22px}
  .t-main{font-size:26px}
  .tiles{gap:6px}
  .tile{padding:10px 8px;min-height:80px}
  .face{padding:18px 18px 16px;border-radius:24px}
  .word{font-size:28px;margin:14px 0 2px}
  .ex{font-size:16px;padding-top:14px}
  .zh{font-size:22px}
  .rate button{font-size:13px;padding:10px 2px;min-height:48px}
}
</style>
</head>
<body>
<div class="wrap">

  <!-- ===== first-run / error: enter sync code ===== -->
  <section id="viewSetup" class="setup hidden">
    <h1>輸入同步碼</h1>
    <p class="hint">同步碼是你在 Apps Script「指令碼屬性」設定的 TOKEN。只會存在這台裝置。</p>
    <input id="setupIn" type="password" autocomplete="off" placeholder="同步碼" aria-label="同步碼">
    <button class="btn primary" id="btnSetup">開始使用</button>
    <div class="msg" id="setupMsg"></div>
  </section>

  <!-- ===== home + list ===== -->
  <div id="main" class="hidden">
    <div class="top">
      <div class="brand">雅思單字<small id="brandCount"></small></div>
      <button class="icon-btn" id="btnSettings" title="設定" aria-label="設定">⚙︎</button>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" id="tabHome" aria-selected="true">首頁</button>
      <button class="tab" role="tab" id="tabList" aria-selected="false">篩選列表</button>
    </div>

    <section id="viewHome">
      <div class="today">
        <div class="t-date" id="tDate"></div>
        <div class="t-main" id="tMain"></div>
        <div class="t-sub" id="tSub"></div>
        <button class="btn primary" id="btnStart">開始 →</button>
      </div>
      <div class="tiles" id="tiles"></div>
      <div class="home-foot"><span id="roundsDone"></span><span class="sync" id="syncHome"></span></div>
    </section>

    <section id="viewList" class="hidden">
      <div class="list-tools">
        <input id="q" type="search" placeholder="搜尋單字或中文" aria-label="搜尋">
        <select id="fCatSel" aria-label="分類"></select>
        <select id="fFamSel" aria-label="熟悉度">
          <option value="">全部熟悉度</option>
          <option value="0">未學習</option><option value="1">學習中</option>
          <option value="2">熟悉</option><option value="3">已掌握</option>
        </select>
        <button class="btn primary" id="btnFilterDeck"></button>
      </div>
      <div class="count" id="listCount"></div>
      <table class="tbl" id="tbl"></table>
    </section>
  </div>

  <!-- ===== cards ===== -->
  <section id="viewCards" class="hidden">
    <div class="cards-top">
      <button class="btn" id="btnBack">← 返回</button>
      <b id="cTitle"></b>
      <span class="sync" id="syncCards"></span>
    </div>
    <div class="cbar"><i id="cBar"></i></div>

    <div id="cardArea">
      <div class="swipe" id="swipe">
        <div class="stage">
          <div class="card" id="card">
            <div class="face front">
              <div class="meta"><span class="cat" id="fCat"></span><span class="fam-tag" id="fFam"></span></div>
              <div class="word" id="fWord"></div>
              <div class="pos" id="fPos"></div>
              <button class="speak" id="btnSpeak" type="button">🔊 念一次</button>
              <div class="ex" id="fEx"></div>
              <div class="ex-zh" id="fExZh"></div>
            </div>
            <div class="face back">
              <div class="meta"><span class="cat" id="bWord"></span><span class="fam-tag" id="bFam"></span></div>
              <div class="zh" id="bZh"></div>
              <div class="def" id="bDef"></div>
              <div class="bex"><span>例句</span><div id="bEx"></div><div class="ex-zh" id="bExZh"></div></div>
              <div class="pairs">
                <div><span>同義詞</span><div id="bSyn"></div></div>
                <div><span>反義詞</span><div id="bAnt"></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="rate" id="rate">
        <button class="r0" data-f="0">未學習</button>
        <button class="r1" data-f="1">學習中</button>
        <button class="r2" data-f="2">熟悉</button>
        <button class="r3" data-f="3">已掌握</button>
      </div>
      <div class="nav">
        <button class="btn" id="btnPrev">上一張</button>
        <span class="pos-ind" id="posInd"></span>
        <button class="btn primary" id="btnNext">下一張 →</button>
      </div>
      <div class="kbd">空白鍵翻面 · ← → 換張 · 1–4 熟悉度 · Esc 返回</div>
    </div>

    <div id="doneArea" class="hidden">
      <div class="done-card">
        <h2 id="dTitle"></h2>
        <p id="dSub"></p>
        <button class="btn primary" id="btnMark"></button>
        <button class="btn" id="btnDoneBack">← 回到最後一張</button>
      </div>
    </div>
  </section>
</div>

<!-- ===== settings ===== -->
<div class="sheet" id="sheet">
  <div class="panel">
    <h2>設定</h2>
    <div class="opt"><span>同步狀態</span><span class="sync" id="syncSettings"></span><button class="btn" id="btnRetry">重新同步</button></div>
    <div class="opt"><input id="tokenIn" type="password" autocomplete="off" placeholder="同步碼" aria-label="同步碼"><button class="btn" id="btnSaveToken">更新</button></div>
    <div class="opt"><span>發音口音</span>
      <select id="accentSel"><option value="en-GB">英式 (UK)</option><option value="en-US">美式 (US)</option></select>
    </div>
    <button class="btn primary full" id="btnIcs">加入行事曆（每天 8:00 提醒）</button>
    <p>下載後用 Google 日曆「設定 → 匯入」。若到時間沒跳通知，到該日曆的設定把「預設通知」改成活動開始時。</p>
    <button class="btn full" id="btnExport">匯出 Excel（備份）</button>
    <div class="status" id="exportStatus"></div>
    <button class="btn full" id="btnClose">關閉</button>
  </div>
</div>
<div class="toast" id="toast"></div>

<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: 建立 `app.js`**

```js
import {
  FAM, PORTION_SIZES, ymd, addDays, fmtMD, fmtMDW, schedule, portionDate, portionStatus,
  canMarkDone, isDone, completedRounds, portionIndices, buildIcs,
} from "./logic.js";
import { createSync } from "./sync.js";
import { createMockFetch } from "./mock.js";
import { attachSwipe } from "./swipe.js";
import { exportExcel } from "./export.js";

const SYNC_URL = ""; // Apps Script Web App URL (filled in after deployment)
const PAGE_URL = "https://sammi0217.github.io/ielts-vocab-app/";
const MOCK = new URLSearchParams(location.search).has("mock");

const $ = id => document.getElementById(id);
const storage = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const prefs = storage.get("iv_prefs") || { accent: "en-GB" };
let token = MOCK ? "mock" : storage.get("iv_token") || "";
let data = { words: [], log: [] };
let sess = null; // current card session
let listRows = [];

let fetchFn = (...a) => fetch(...a);
if (MOCK) fetchFn = createMockFetch(await (await fetch("mock/data.json")).json());

const sync = createSync({
  url: MOCK ? "mock" : SYNC_URL,
  getToken: () => token,
  storage,
  fetchFn,
  onChange: renderSync,
  onDrop: (op, err) => toast(err === "not_found" ? "試算表列序變了，請重新整理" : "有一筆變更無法寫入，已略過"),
});

const today = () => ymd(new Date());
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])); }
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ===== sync badge ===== */
function renderSync(s = sync.status()) {
  const t = s.state === "bad_token" ? "⚠ 同步碼錯誤"
    : s.pending ? `⟳ ${s.pending} 筆未同步`
    : s.state === "offline" ? "⚠ 離線"
    : "✓ 已同步";
  ["syncHome", "syncCards", "syncSettings"].forEach(id => { $(id).textContent = t; });
}

/* ===== boot ===== */
function showSetup(msg = "") {
  $("main").classList.add("hidden");
  $("viewCards").classList.add("hidden");
  $("viewSetup").classList.remove("hidden");
  $("setupMsg").textContent = msg;
}
function showMain() {
  $("viewSetup").classList.add("hidden");
  $("brandCount").textContent = `${data.words.length} 字`;
  buildCatSel();
  if (sess) { renderCard(); return; }
  $("main").classList.remove("hidden");
  renderHome();
  if (!$("viewList").classList.contains("hidden")) renderList();
}
async function boot() {
  if (!MOCK && !SYNC_URL) { showSetup("網頁還沒設定 Apps Script 網址（SYNC_URL）。"); return; }
  if (!token) { showSetup(); return; }
  const c = sync.cached();
  if (c) { data = c; showMain(); }
  try {
    await sync.flush();
    data = await sync.load();
    showMain();
  } catch (e) {
    if (e.code === "bad_token") { showSetup("同步碼不對，請重新輸入。"); return; }
    if (!c) { showSetup("讀不到試算表，確認網路後再按一次。"); return; }
    toast("目前離線，先用上次的資料");
  }
  renderSync();
}
$("btnSetup").onclick = () => {
  const v = $("setupIn").value.trim();
  if (!v) return;
  token = v; storage.set("iv_token", v); boot();
};

/* ===== tabs ===== */
function showTab(t) {
  $("tabHome").setAttribute("aria-selected", t === "home");
  $("tabList").setAttribute("aria-selected", t === "list");
  $("viewHome").classList.toggle("hidden", t !== "home");
  $("viewList").classList.toggle("hidden", t !== "list");
  if (t === "list") renderList(); else renderHome();
}
$("tabHome").onclick = () => showTab("home");
$("tabList").onclick = () => showTab("list");

/* ===== home ===== */
const LABEL = { done: "已完成 ✓", today: "今天", missed: "錯過", upcoming: "之後" };
function renderHome() {
  const t = today(), s = schedule(t), log = data.log;
  $("tDate").textContent = fmtMDW(t);
  if (portionStatus(log, s.round, s.portion, t) === "done") {
    const tm = addDays(t, 1);
    $("tMain").textContent = "今天完成了 ✓";
    $("tSub").textContent = `明天 ${fmtMD(tm)} 做第 ${schedule(tm).portion} 份`;
    $("btnStart").textContent = `再看一次第 ${s.portion} 份`;
  } else {
    $("tMain").textContent = `今天做 第 ${s.portion} 份`;
    $("tSub").textContent = `第 ${s.round} 輪 · 第 ${s.portion}/7 天 · ${PORTION_SIZES[s.portion - 1]} 字`;
    $("btnStart").textContent = "開始 →";
  }
  $("btnStart").onclick = () => startPortion(s.round, s.portion);
  $("tiles").innerHTML = [1, 2, 3, 4, 5, 6, 7].map(k => {
    const st = portionStatus(log, s.round, k, t);
    return `<button class="tile st-${st}" data-k="${k}"><b>第 ${k} 份</b><span>${fmtMD(portionDate(s.round, k))}</span><em>${LABEL[st]}</em></button>`;
  }).join("");
  $("tiles").querySelectorAll(".tile").forEach(b => { b.onclick = () => startPortion(s.round, +b.dataset.k); });
  $("roundsDone").textContent = `已完整輪替 ${completedRounds(log)} 次`;
}

/* ===== cards ===== */
function startPortion(round, portion) {
  openDeck({ mode: "portion", round, portion, deck: portionIndices(portion), title: `第 ${portion} 份` });
}
function openDeck(o) {
  sess = { ...o, pos: 0, flipped: false, seen: new Set(), startedAt: Date.now() };
  $("main").classList.add("hidden");
  $("viewCards").classList.remove("hidden");
  window.scrollTo(0, 0);
  renderCard();
}
function closeDeck() {
  const wasFilter = sess && sess.mode === "filter";
  sess = null;
  window.speechSynthesis?.cancel();
  $("viewCards").classList.add("hidden");
  $("main").classList.remove("hidden");
  showTab(wasFilter ? "list" : "home");
}
function famTag(el, f) { el.textContent = FAM[f]; el.className = "fam-tag fam-" + f; }
function renderCard() {
  const n = sess.deck.length, atEnd = sess.pos >= n;
  if (!atEnd) sess.seen.add(sess.deck[sess.pos]);
  $("cTitle").textContent = `${sess.title} · ${Math.min(sess.pos + 1, n)} / ${n}`;
  $("cBar").style.width = Math.round((sess.seen.size / n) * 100) + "%";
  $("cardArea").classList.toggle("hidden", atEnd);
  $("doneArea").classList.toggle("hidden", !atEnd);
  if (atEnd) { renderDone(); return; }
  const w = data.words[sess.deck[sess.pos]];
  $("card").classList.toggle("flipped", sess.flipped);
  $("fCat").textContent = w.cat; famTag($("fFam"), w.fam);
  $("fWord").textContent = w.w; $("fPos").textContent = w.pos; $("fEx").textContent = w.ex; $("fExZh").textContent = w.exzh;
  $("bWord").textContent = w.w; famTag($("bFam"), w.fam);
  $("bZh").textContent = w.zh; $("bDef").textContent = w.en; $("bEx").textContent = w.ex; $("bExZh").textContent = w.exzh;
  $("bSyn").textContent = w.syn || "—";
  $("bAnt").textContent = w.ant && w.ant !== "-" ? w.ant : "—";
  $("posInd").textContent = `${sess.pos + 1} / ${n}`;
  $("btnPrev").disabled = sess.pos === 0;
  document.querySelectorAll("#rate button").forEach(b => b.classList.toggle("on", +b.dataset.f === w.fam));
}
function renderDone() {
  const n = sess.seen.size;
  const mins = Math.max(1, Math.round((Date.now() - sess.startedAt) / 60000));
  const b = $("btnMark");
  b.disabled = false;
  if (sess.mode !== "portion") {
    $("dTitle").textContent = "看完了";
    $("dSub").textContent = `共 ${n} 字`;
    b.textContent = "回列表"; b.onclick = closeDeck;
    return;
  }
  const t = today(), { round, portion } = sess;
  $("dTitle").textContent = `第 ${portion} 份完成！`;
  $("dSub").textContent = `看了 ${n} 字 · ${mins} 分鐘`;
  if (isDone(data.log, round, portion)) {
    b.textContent = "本輪已標記過 ✓ 回首頁"; b.onclick = closeDeck;
  } else if (!canMarkDone(round, portion, t)) {
    b.textContent = `${fmtMD(portionDate(round, portion))} 當天再標記`; b.disabled = true;
  } else {
    b.textContent = "標記完成";
    b.onclick = () => {
      const note = t > portionDate(round, portion) ? "補做" : "";
      const entry = { round, portion, date: t, words: n, minutes: mins, note };
      data.log.push(entry);
      sync.enqueue({ op: "done", ...entry });
      toast(`第 ${portion} 份已記錄`);
      closeDeck();
    };
  }
}
function go(d) {
  if (!sess) return;
  const np = sess.pos + d;
  if (np < 0 || np > sess.deck.length) return;
  sess.pos = np; sess.flipped = false;
  renderCard();
}
function flip() {
  if (!sess || sess.pos >= sess.deck.length) return;
  sess.flipped = !sess.flipped;
  $("card").classList.toggle("flipped", sess.flipped);
}
function setFam(i, f) {
  const w = data.words[i], t = today();
  w.fam = f; w.date = t; w.cnt = (w.cnt || 0) + 1;
  sync.enqueue({ op: "fam", row: w.row, w: w.w, fam: f, date: t });
}
function rate(f) {
  if (!sess || sess.pos >= sess.deck.length) return;
  const at = sess.pos;
  setFam(sess.deck[at], f);
  renderCard();
  setTimeout(() => { if (sess && sess.pos === at) go(1); }, 160);
}
attachSwipe($("swipe"), {
  onTap: flip,
  onSwipe: dir => go(dir === "next" ? 1 : -1),
  canSwipe: dir => !!sess && (dir === "next" || sess.pos > 0),
});
document.querySelectorAll("#rate button").forEach(b => { b.onclick = () => rate(+b.dataset.f); });
$("btnPrev").onclick = () => go(-1);
$("btnNext").onclick = () => go(1);
$("btnBack").onclick = closeDeck;
$("btnDoneBack").onclick = () => go(-1);
document.addEventListener("keydown", e => {
  if (!sess || $("sheet").classList.contains("open") || e.target.matches("input,select")) return;
  if (e.key === " ") { e.preventDefault(); flip(); }
  else if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "ArrowRight") go(1);
  else if (e.key === "Escape") closeDeck();
  else if (/^[1-4]$/.test(e.key)) rate(+e.key - 1);
});

/* ===== speech ===== */
let voices = [];
if ("speechSynthesis" in window) {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load(); speechSynthesis.onvoiceschanged = load;
} else {
  $("btnSpeak").classList.add("hidden");
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = prefs.accent; u.rate = 0.92;
  const pick = voices.find(v => v.lang.replace("_", "-") === prefs.accent) || voices.find(v => v.lang.startsWith("en"));
  if (pick) u.voice = pick;
  speechSynthesis.speak(u);
}
$("btnSpeak").onclick = e => { e.stopPropagation(); if (sess && sess.pos < sess.deck.length) speak(data.words[sess.deck[sess.pos]].w); };

/* ===== list ===== */
function buildCatSel() {
  const s = $("fCatSel"), cur = s.value;
  const cats = [...new Set(data.words.flatMap(w => w.cat.split("、")).filter(Boolean))];
  s.innerHTML = '<option value="">全部分類</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  s.value = cur;
}
function renderList() {
  const q = $("q").value.trim().toLowerCase(), c = $("fCatSel").value, f = $("fFamSel").value;
  listRows = [];
  data.words.forEach((w, i) => {
    if (c && !w.cat.split("、").includes(c)) return;
    if (f !== "" && w.fam !== +f) return;
    if (q && !(w.w.toLowerCase().includes(q) || w.zh.includes(q) || w.syn.toLowerCase().includes(q))) return;
    listRows.push(i);
  });
  $("listCount").textContent = `${listRows.length} 字`;
  $("btnFilterDeck").textContent = `用卡片複習這 ${listRows.length} 字`;
  $("btnFilterDeck").disabled = !listRows.length;
  const t = $("tbl");
  if (!listRows.length) { t.innerHTML = '<tr><td class="empty">沒有符合的單字，換個關鍵字或條件試試。</td></tr>'; return; }
  t.innerHTML = listRows.map(i => {
    const w = data.words[i];
    return `<tr>
      <td><div class="w">${esc(w.w)}<i>${esc(w.pos)}</i></div><div class="z">${esc(w.zh)}</div><div class="c">${esc(w.cat)}</div></td>
      <td style="width:110px;text-align:right"><select data-i="${i}" aria-label="熟悉度">${FAM.map((n, k) => `<option value="${k}"${k === w.fam ? " selected" : ""}>${n}</option>`).join("")}</select>
        <div class="c">${esc(w.date)}</div></td></tr>`;
  }).join("");
  t.querySelectorAll("select").forEach(s => { s.onchange = () => { setFam(+s.dataset.i, +s.value); renderList(); }; });
}
["q", "fCatSel", "fFamSel"].forEach(id => $(id).addEventListener("input", renderList));
$("btnFilterDeck").onclick = () => openDeck({ mode: "filter", deck: listRows.slice(), title: $("fCatSel").value || "篩選結果" });

/* ===== settings ===== */
$("btnSettings").onclick = () => {
  $("tokenIn").value = MOCK ? "" : token;
  $("accentSel").value = prefs.accent;
  $("exportStatus").textContent = "";
  renderSync();
  $("sheet").classList.add("open");
};
$("btnClose").onclick = () => $("sheet").classList.remove("open");
$("sheet").addEventListener("click", e => { if (e.target === $("sheet")) $("sheet").classList.remove("open"); });
$("accentSel").onchange = () => { prefs.accent = $("accentSel").value; storage.set("iv_prefs", prefs); };
$("btnSaveToken").onclick = () => {
  const v = $("tokenIn").value.trim();
  if (!v || MOCK) return;
  token = v; storage.set("iv_token", v);
  $("sheet").classList.remove("open");
  boot();
};
$("btnRetry").onclick = async () => {
  await sync.flush();
  try { data = await sync.load(); showMain(); toast("已重新同步"); }
  catch (e) { toast(e.code === "bad_token" ? "同步碼不對" : "還是連不上"); }
};
$("btnIcs").onclick = () => download("雅思單字複習.ics", new Blob([buildIcs({ url: PAGE_URL })], { type: "text/calendar;charset=utf-8" }));
$("btnExport").onclick = async () => {
  const st = $("exportStatus");
  st.textContent = "正在產生檔案…";
  try { download("雅思單字進步系統.xlsx", await exportExcel(data)); st.textContent = "已匯出（備份用）。"; }
  catch (e) { st.textContent = "匯出失敗：" + (e?.message || "未知錯誤"); }
};

/* ===== lifecycle ===== */
window.addEventListener("online", () => sync.flush());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  sync.flush();
  if (!sess && !$("main").classList.contains("hidden") && !$("viewHome").classList.contains("hidden")) renderHome();
});
boot();
```

- [ ] **Step 5: 建立 `tools/make_mock.mjs` 並產生本機假資料**

```js
// Builds mock/data.json (gitignored) from the old local build so the UI can be tested without the Sheet.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const m = html.match(/const WORDS = (\[.*?\]);\n/s);
if (!m) throw new Error("WORDS not found in dist/index.html");
const words = JSON.parse(m[1]).map((w, i) => ({ row: i + 2, ...w }));
mkdirSync("mock", { recursive: true });
writeFileSync("mock/data.json", JSON.stringify({ words, log: [] }));
console.log(`mock/data.json: ${words.length} words`);
```

Run: `node tools/make_mock.mjs`
Expected: `mock/data.json: 327 words`

- [ ] **Step 6: 建立 `.claude/launch.json` 並啟動本機伺服器**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "static", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "8000"], "port": 8000 }
  ]
}
```
用 `preview_start`（name: `static`），再 navigate 到 `http://localhost:8000/?mock=1`，viewport 用 `mobile` preset。

- [ ] **Step 7: 瀏覽器實測（mock 模式，逐項確認）**

1. 首頁：今日卡顯示 `9/23（三）`、`今天做 第 1 份`、`第 1 輪 · 第 1/7 天 · 47 字`；7 格中第 1 格「今天」有外框，第 2–7 格顯示 9/24–9/29、「之後」；底部 `已完整輪替 0 次`、`✓ 已同步`。
2. 按［開始 →］：卡片頁標題 `第 1 份 · 1 / 47`、進度條 > 0。
3. 點卡片 → 翻面；再點 → 翻回。按 🔊 不會翻面。
4. 用 `computer` 的 `left_click_drag` 從卡片中央往左拖約 200px → 換到 `2 / 47`；往右拖 → 回 `1 / 47`；在第 1 張往右拖 → 彈回、不換張；只拖 30px 慢慢放 → 彈回。
5. 點「熟悉」→ 按鈕有外框，0.16 秒後跳下一張；`javascript_tool` 讀 `JSON.parse(localStorage.iv_cache).words[0].fam` → `2`，`iv_queue` 為 `[]`。
6. 離線測試：`javascript_tool` 設 `globalThis.__mockOffline = true`，點一個熟悉度 → 頂部徽章 `⟳ 1 筆未同步`；再設 `false` 並 `dispatchEvent(new Event("online"))` → `✓ 已同步`。
7. 按鍵盤 → 或拖曳一路到第 47 張之後 → 完成畫面「第 1 份完成！看了 N 字 · M 分鐘」與［標記完成］；按下 → 回首頁、toast「第 1 份已記錄」、今日卡改為「今天完成了 ✓ 明天 9/24 做第 2 份」、第 1 格「已完成 ✓」。
8. 點第 3 格（之後）→ 走到最後 → 按鈕顯示「9/25 當天再標記」且 disabled。
9. 篩選列表：選一個分類 → 按鈕「用卡片複習這 N 字」→ 卡片頁標題為分類名；走到最後 → 「看完了」［回列表］→ 回到篩選列表分頁。
10. 列表下拉改熟悉度 → 日期欄變今天；`iv_cache` 對應字更新。
11. 設定：`javascript_tool` 執行 `(await import("./logic.js")).buildIcs({url:"x"}).split("BEGIN:VEVENT").length - 1` → `7`（不實際下載檔案）。
12. `read_console_messages` onlyErrors → 無錯誤。
13. `resize_window` 寬 1024：上一張／下一張按鈕與鍵盤提示出現；結束後 `preset: desktop` 還原。
14. 深色模式：`resize_window` colorScheme `dark`，截圖確認首頁與卡片可讀。

任何一項不符 → 修正後重跑該項。

- [ ] **Step 8: 刪除舊檔並 commit**

```bash
git rm app_template.html build.py
git add index.html app.js swipe.js export.js tools/make_mock.mjs
git status --short   # 確認沒有 mock/ 或 .claude/
git commit -m "feat: portion home, swipeable cards, live sync UI and calendar export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 部署 Apps Script（Sammi 操作）並接上網址

**Files:**
- Modify: `app.js`（`SYNC_URL` 常數）

- [ ] **Step 1: Sammi 在試算表部署 Apps Script**（我提供逐步說明，由 Sammi 操作）

1. 開啟 Google 試算表 →「檔案 → 設定」確認時區是 `(GMT+08:00) 台北`。
2. 「擴充功能 → Apps Script」→ 刪掉預設程式 → 貼上 `apps-script/Code.gs` 全文 → 儲存。
3. 左側齒輪「專案設定」→「指令碼屬性」→ 新增 `TOKEN`，值自己設一組 20 字元以上的亂碼（可在終端機跑 `openssl rand -hex 16` 產生）。**不要貼給 Claude**。
4. 右上「部署 → 新增部署作業」→ 類型「網頁應用程式」→ 執行身分「我」→ 誰可以存取「所有人」→ 部署 → 授權 → 複製「網頁應用程式網址」（`https://script.google.com/macros/s/.../exec`），把網址給 Claude。

- [ ] **Step 2: Sammi 用 curl 驗證（token 只在 Sammi 自己的終端機）**

```bash
read -s TOKEN
```
```bash
curl -sL --data "{\"token\":\"$TOKEN\",\"op\":\"get\"}" "<SYNC_URL>" | head -c 300
```
Expected：`{"ok":true,"words":[{"row":2,...`
```bash
curl -sL --data '{"token":"wrong","op":"get"}' "<SYNC_URL>"
```
Expected：`{"ok":false,"error":"bad_token"}`

（`--data` 不加 `-X POST`：curl 會在 Google 的 302 轉址後改用 GET 取回結果，這是 Apps Script 的正常行為。）

- [ ] **Step 3: 填入 `SYNC_URL`**

`app.js` 中：
```js
const SYNC_URL = "<Sammi 提供的 /exec 網址>"; // Apps Script Web App URL
```

- [ ] **Step 4: 本機連真實試算表實測**

開 `http://localhost:8000/`（不加 mock）→ 出現「輸入同步碼」→ **由 Sammi 在畫面上輸入 TOKEN**（Claude 不代填）→ 首頁出現 327 字。
Sammi 在第 1 份任一字點「學習中」→ 到試算表確認該列 K=學習中、L=今天、M+1。

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "chore: point the app at the deployed Apps Script endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README、清理、GitHub repo 與 Pages 上線

**Files:**
- Create: `README.md`（重寫，不含 Sheet ID）
- Delete（本機）：`dist/`

- [ ] **Step 1: 重寫 `README.md`**

````markdown
# 雅思單字複習 (IELTS vocab review)

手機優先的單字卡網頁。Google 試算表是唯一資料源，網頁透過 Apps Script 即時讀寫。
線上版：https://sammi0217.github.io/ielts-vocab-app/

> 這個 repo 是 public，**不含任何單字內容**（出自《Pin IELTS 雅思單字本》）。單字只在執行時從試算表讀取。`data/`、`dist/`、`mock/` 已 gitignore。

## 檔案
```
index.html          結構與樣式
app.js              開機、首頁、卡片、列表、設定（SYNC_URL 在這裡）
logic.js            純函式：排程、狀態、滑動判定、.ics
sync.js             API 呼叫 + 離線佇列（localStorage iv_queue / iv_cache）
mock.js             與 Apps Script 同契約的假後端（?mock=1）
swipe.js            卡片左右滑
export.js           匯出 Excel 備份
apps-script/Code.gs 貼到試算表的 Apps Script
tests/              node:test 單元測試
tools/make_mock.mjs 產生本機假資料
```

## 複習邏輯
- 327 字依試算表順序切 7 份：47/47/47/47/47/46/46。
- 依日曆固定：2026-09-23 起，第 1 天第 1 份……第 7 天第 7 份，7 天一輪（`START` 在 `logic.js`）。
- 完成一份 → 「複習紀錄」新增一列；某輪 7 份都有紀錄＝完整輪替 1 次。
- 錯過的份數可補做（備註「補做」）；未來的份數可預習，但要到當天才能標記完成。

## 資料流
- 點熟悉度 → 立即 POST 到 Apps Script → 寫入該列 K 熟悉度 / L 日期 / M 次數+1。
- 離線時先存本機佇列，恢復連線後補送；`opId` 保證重送不會重複 +1。
- 單字以「列號＋單字」對應：**不要重新排序單字庫的列**。新增單字請加在最後一列。

## API（Apps Script，全部 POST，body 為 JSON）
| op | 參數 | 回傳 |
|---|---|---|
| `get` | – | `{ok, words[], log[]}` |
| `fam` | `row, w, fam(0–3), date, opId` | `{ok, cnt}` |
| `done` | `round, portion, date, words, minutes, note, opId` | `{ok}` |
錯誤：`bad_token`、`not_found`、`bad_request`。

## 部署 Apps Script
1. 試算表「檔案 → 設定」時區設為台北。
2. 擴充功能 → Apps Script → 貼上 `apps-script/Code.gs`。
3. 專案設定 → 指令碼屬性 → `TOKEN`＝自訂亂碼（`openssl rand -hex 16`）。
4. 部署 → 網頁應用程式（執行身分：我；存取：所有人）→ 網址填入 `app.js` 的 `SYNC_URL`。
5. 改過 Code.gs 後要「管理部署作業 → 編輯 → 新版本」，網址不變。

## 開發
```
npm test                       # 單元測試
node tools/make_mock.mjs       # 需要本機舊版 dist/index.html；產生 mock/data.json
python3 -m http.server 8000    # 開 http://localhost:8000/?mock=1
```
ES modules 需透過 http 開啟，不能直接雙擊 index.html。

## 行事曆提醒
設定 → 加入行事曆 → 匯入 Google 日曆。每份每 7 天重複、08:00。若沒跳通知，將該日曆的預設通知設為「活動開始時」。
````

- [ ] **Step 2: 刪除本機 `dist/`（mock 資料已產生，不再需要）**

先確認 `mock/data.json` 存在，再：
```bash
rm -r dist
```

- [ ] **Step 3: 跑全部測試**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the live-sync architecture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 建 public repo、推送、開 Pages**（執行前再跟 Sammi 確認一次：這會公開發布）

```bash
git ls-files | grep -E '^(data|dist|mock)/' && echo "STOP: data files tracked" || echo "clean"
gh repo create ielts-vocab-app --public --source . --push
gh api -X POST repos/sammi0217/ielts-vocab-app/pages -f "source[branch]=main" -f "source[path]=/"
```
Expected：`clean`；repo 建立並推送；Pages API 回傳 JSON 含 `"html_url": "https://sammi0217.github.io/ielts-vocab-app/"`。

- [ ] **Step 6: 線上驗證**

等 Pages 建置完成（`gh api repos/sammi0217/ielts-vocab-app/pages/builds/latest --jq .status` 為 `built`），再開 `https://sammi0217.github.io/ielts-vocab-app/`：
- 出現「輸入同步碼」→ Sammi 在手機與電腦各輸入一次 TOKEN。
- 手機上左右滑、點熟悉度 → 電腦重新整理後看到相同熟悉度；試算表同步更新。
- 設定 → 加入行事曆 → 下載 `.ics` → Sammi 匯入 Google 日曆，確認 9/24 08:00 有「雅思 第2份（47字）」。

- [ ] **Step 7: 舊 claude.ai artifact**

問 Sammi 是否刪除舊版 artifact（`https://claude.ai/artifact/QuppshUTjxt1dcKxGbbDhA`）；刪除需 Sammi 明確同意。

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

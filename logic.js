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
/* A word counts as rated for a portion when it was touched on/after `since` with a level above 未學習. */
export function ratedSince(round, k, today, start = START) {
  const d = portionDate(round, k, start);
  return d <= today ? d : today;
}
export function isRated(w, since) {
  return w.fam >= 1 && !!w.date && w.date >= since;
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
    } else if (op.op === "spell") {
      const w = words.find(x => x.row === op.row && x.w === op.w);
      if (w) { w.spell = op.ok ? "對" : "錯"; if (!op.ok) w.miss = (w.miss || 0) + 1; }
    } else if (op.op === "done") {
      log.push({ round: op.round, portion: op.portion, date: op.date, words: op.words, minutes: op.minutes, note: op.note || "" });
    }
  }
  return { ...data, words, log };
}

/* ===== dashboard stats ===== */
export function roundDates(today, start = START) {
  const { round } = schedule(today, start);
  return [1, 2, 3, 4, 5, 6, 7].map(k => portionDate(round, k, start));
}
export function lastDays(today, n) {
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}
// Consecutive days (ending today, or yesterday if today isn't done yet) with at least one portion marked done.
export function streak(log, today) {
  const days = new Set(log.map(r => r.date));
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
// Contribution-style grid: `weeks` columns (Mon..Sun). It starts at the week of `start` so the first months
// show the whole plan ahead; once today passes the last column it scrolls to end with the current week.
// Each cell: { date, state: "pre" | "future" | "done" | "missed" | "today", n } where n = portions marked done that day.
export function heatmap(log, today, weeks, start = START) {
  const count = {};
  for (const r of log) count[r.date] = (count[r.date] || 0) + 1;
  const mondayOf = d => addDays(d, -((parseYmd(d).getDay() + 6) % 7));
  const trailing = addDays(mondayOf(today), -(weeks - 1) * 7), anchored = mondayOf(start);
  const first = trailing > anchored ? trailing : anchored;
  return Array.from({ length: weeks }, (_, c) => Array.from({ length: 7 }, (_, r) => {
    const date = addDays(first, c * 7 + r), n = count[date] || 0;
    const state = date < start ? "pre" : date > today ? "future" : n ? "done" : date === today ? "today" : "missed";
    return { date, state, n };
  }));
}
export function famCounts(words) {
  const c = [0, 0, 0, 0];
  for (const w of words) c[w.fam] = (c[w.fam] || 0) + 1;
  return c;
}

/* ===== spelling ===== */
// Answer key: drop "(AI)"-style parentheses, ignore case, treat hyphens as spaces, collapse spaces.
const loose = s => String(s).replace(/-/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
export function spellTarget(word) {
  return loose(String(word).replace(/\([^)]*\)/g, " "));
}
// Per-letter marks from an edit-distance alignment: ok / bad (wrong letter) / miss (left out) / extra (typed too much).
export function checkSpelling(word, input) {
  const a = spellTarget(word), b = loose(input), n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    dp[i][j] = Math.min(dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
  const marks = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { marks.push({ ch: a[--i], t: "ok" }); j--; }
    else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { marks.push({ ch: a[--i], t: "bad" }); j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) marks.push({ ch: a[--i], t: "miss" });
    else marks.push({ ch: b[--j], t: "extra" });
  }
  return { ok: a === b, marks: marks.reverse(), target: a };
}
// Live feedback while copying a word: each target letter is ok / bad / todo by position.
export function typeProgress(word, input) {
  const target = spellTarget(word), typed = String(input).replace(/-/g, " ").toLowerCase();
  const marks = [...target].map((ch, i) => ({ ch, t: i >= typed.length ? "todo" : typed[i] === ch ? "ok" : "bad" }));
  return { marks, complete: loose(typed) === target };
}
export function hintPattern(word) {
  return spellTarget(word).split(" ")
    .map((part, wi) => [...part].map((c, ci) => (wi === 0 && ci === 0 ? c : "_")).join(" ")).join("   ");
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

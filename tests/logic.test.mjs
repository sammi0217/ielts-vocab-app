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

test("ratedSince: portion date once reached, otherwise today (preview)", () => {
  assert.equal(L.ratedSince(1, 1, "2026-09-24"), "2026-09-23");
  assert.equal(L.ratedSince(1, 2, "2026-09-24"), "2026-09-24");
  assert.equal(L.ratedSince(1, 5, "2026-09-24"), "2026-09-24");
  assert.equal(L.ratedSince(2, 1, "2026-10-01"), "2026-09-30");
});

test("isRated: touched on/after since and not 未學習", () => {
  const since = "2026-09-23";
  assert.equal(L.isRated({ fam: 1, date: "2026-09-23" }, since), true);
  assert.equal(L.isRated({ fam: 3, date: "2026-09-25" }, since), true);
  assert.equal(L.isRated({ fam: 0, date: "2026-09-23" }, since), false);
  assert.equal(L.isRated({ fam: 2, date: "2026-09-22" }, since), false);
  assert.equal(L.isRated({ fam: 2, date: "" }, since), false);
});

test("roundDates: the 7 dates of the round containing today", () => {
  assert.deepEqual(L.roundDates("2026-09-24"), ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
  assert.equal(L.roundDates("2026-09-30")[0], "2026-09-30");
});

test("streak counts consecutive days with a done entry, today optional", () => {
  const log = [{ date: "2026-09-23" }, { date: "2026-09-24" }, { date: "2026-09-26" }];
  assert.equal(L.streak(log, "2026-09-24"), 2);
  assert.equal(L.streak(log, "2026-09-25"), 2);
  assert.equal(L.streak(log, "2026-09-26"), 1);
  assert.equal(L.streak(log, "2026-09-28"), 0);
  assert.equal(L.streak([], "2026-09-24"), 0);
});

test("famCounts tallies the four levels", () => {
  assert.deepEqual(L.famCounts([{ fam: 0 }, { fam: 3 }, { fam: 3 }, { fam: 1 }]), [1, 1, 0, 2]);
});

test("lastDays lists n days ending today", () => {
  assert.deepEqual(L.lastDays("2026-10-01", 3), ["2026-09-29", "2026-09-30", "2026-10-01"]);
});

test("heatmap: Monday-first weeks anchored at the start week, with day states", () => {
  // 2026-09-25 is a Friday; start week begins Mon 9/21 -> 2 weeks = 9/21 .. 10/4
  const log = [{ date: "2026-09-23" }, { date: "2026-09-25" }, { date: "2026-09-25" }];
  const g = L.heatmap(log, "2026-09-25", 2);
  assert.equal(g.length, 2);
  assert.equal(g[0][0].date, "2026-09-21");
  assert.equal(g[1][6].date, "2026-10-04");
  assert.equal(g[1][0].state, "future");
  const at = d => g.flat().find(c => c.date === d);
  assert.equal(at("2026-09-22").state, "pre");
  assert.deepEqual(at("2026-09-23"), { date: "2026-09-23", state: "done", n: 1 });
  assert.equal(at("2026-09-24").state, "missed");
  assert.deepEqual(at("2026-09-25"), { date: "2026-09-25", state: "done", n: 2 });
  assert.equal(at("2026-09-26").state, "future");
  assert.equal(L.heatmap([], "2026-09-25", 1).flat().find(c => c.date === "2026-09-25").state, "today");
  // after the anchored window is used up, it ends with the current week
  const late = L.heatmap([], "2026-12-30", 2);
  assert.equal(late[1][0].date, "2026-12-28");
  assert.equal(late[0][0].date, "2026-12-21");
});

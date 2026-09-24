import {
  FAM, PORTION_SIZES, ymd, addDays, fmtMD, fmtMDW, schedule, portionDate, portionStatus,
  canMarkDone, isDone, completedRounds, portionIndices, buildIcs, ratedSince, isRated,
  roundDates, lastDays, dailySeries, streak, famCounts,
} from "./logic.js";
import { icon } from "./icons.js";
import { createSync } from "./sync.js";
import { createMockFetch } from "./mock.js";
import { attachSwipe } from "./swipe.js";
import { exportExcel } from "./export.js";

const SYNC_URL = "https://script.google.com/macros/s/AKfycbzGSSab2jHFWL7D8LQCEaUNaIAHx5-XBKCe9aUPlaN6I2dEDcMxbbQjZYXc4fxy3sOIbg/exec"; // Apps Script Web App URL
const PAGE_URL = "https://sammi0217.github.io/ielts-vocab-app/";
const MOCK = new URLSearchParams(location.search).has("mock");

const $ = id => document.getElementById(id);
const storage = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const prefs = storage.get("iv_prefs") || { accent: "en-GB" };
let token = MOCK ? "mock" : storage.get("iv_token") || "";
let data = { words: [], log: [], daily: {} };
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
  const [ic, t] = s.state === "bad_token" ? ["warning", "同步碼錯誤"]
    : s.pending ? ["sync", `${s.pending} 筆未同步`]
    : s.state === "offline" ? ["warning", "離線"]
    : ["check", "已同步"];
  ["syncHome", "syncCards", "syncSettings"].forEach(id => { $(id).innerHTML = icon(ic) + t; });
}

/* ===== boot ===== */
function showSetup(msg = "") {
  sess = null;
  window.speechSynthesis?.cancel();
  $("main").classList.add("hidden");
  $("viewCards").classList.add("hidden");
  $("viewSetup").classList.remove("hidden");
  $("setupMsg").textContent = msg;
  if (!MOCK) $("setupIn").value = token;
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
  if (!v) { if (token) boot(); return; }
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
let selDay = null;        // date picked in the week strip (null = today)
let chartRange = "week";  // "week" = this round, "month" = last 30 days
let entered = false;
const wd = d => fmtMDW(d).match(/（(.)）/)[1];
const PILL = { done: "已完成", today: "今天", missed: "錯過", upcoming: "" };
const FAM_COLORS = ["var(--f0)", "var(--f1)", "var(--f2)", "var(--f3)"];
function portionProgress(round, k, t) {
  const deck = portionIndices(k).filter(i => i < data.words.length);
  const since = ratedSince(round, k, t);
  return { deck, done: deck.filter(i => isRated(data.words[i], since)).length, since };
}
function renderHome() {
  const t = today(), s = schedule(t), dates = roundDates(t), log = data.log;
  const sel = dates.includes(selDay) ? selDay : t;
  if (!entered) { $("viewHome").classList.add("enter"); entered = true; }

  $("week").innerHTML = dates.map((d, i) => {
    const st = portionStatus(log, s.round, i + 1, t);
    const cls = `day st-${st}${d === t ? " is-today" : ""}${d === sel ? " is-sel" : ""}`;
    return `<button class="${cls}" data-d="${d}" aria-pressed="${d === sel}" aria-label="${fmtMDW(d)} 第 ${i + 1} 份"><small>${wd(d)}</small><b>${Number(d.slice(8))}</b><i></i></button>`;
  }).join("");
  $("week").querySelectorAll(".day").forEach(b => { b.onclick = () => { selDay = b.dataset.d; renderHome(); }; });

  const k = dates.indexOf(sel) + 1, st = portionStatus(log, s.round, k, t);
  const { deck, done } = portionProgress(s.round, k, t), n = deck.length;
  $("hNo").textContent = String(k).padStart(2, "0");
  $("hLabel").textContent = `第 ${k} 份 · ${fmtMDW(sel)}`;
  $("hPill").textContent = PILL[st];
  $("hPill").className = `pill st-${st}${PILL[st] ? "" : " hidden"}`;
  $("hNum").textContent = done;
  $("hDen").textContent = `/ ${n}`;
  $("hBar").style.width = n ? Math.round((done / n) * 100) + "%" : "0";
  $("btnStart").innerHTML = st === "done" ? "再看一次" : done ? "繼續 →" : "開始 →";
  $("btnStart").onclick = () => startPortion(s.round, k);

  const c = famCounts(data.words), total = data.words.length || 1;
  $("sStreak").textContent = streak(log, t);
  $("sMastery").textContent = Math.round((c[3] / total) * 100);
  $("sWeek").textContent = dailySeries(data.daily || {}, dates).reduce((a, x) => a + x.n, 0);

  $("distTotal").textContent = `${data.words.length} 字`;
  $("dist").innerHTML = c.map((v, f) => v ? `<i style="flex:${v};background:${FAM_COLORS[f]}"></i>` : "").join("");
  $("legend").innerHTML = c.map((v, f) => `<span style="--c:${FAM_COLORS[f]}"><b>${v}</b>${FAM[f]}</span>`).join("");

  renderChart(t, dates);
  $("roundsDone").textContent = `第 ${s.round} 輪 · 已完整輪替 ${completedRounds(log)} 次`;
}
function renderChart(t, dates) {
  const days = chartRange === "week" ? dates : lastDays(t, 30);
  const series = dailySeries(data.daily || {}, days);
  const goal = PORTION_SIZES[0], max = Math.max(goal, ...series.map(x => x.n)) * 1.1;
  const week = chartRange === "week";
  const ch = $("chart");
  ch.style.setProperty("--gap", week ? "10px" : "3px");
  ch.innerHTML = `<div class="goal" style="bottom:calc(20px + (100% - 38px) * ${goal / max})"><span>目標 ${goal}</span></div>` +
    series.map((x, i) => {
      const label = week ? wd(x.date) : (i % 5 === 4 ? Number(x.date.slice(8)) : "");
      const future = x.date > t;
      const h = future ? 0 : Math.max(4, (x.n / max) * 100), inside = h > 28;
      const val = week && x.n ? `<em>${x.n}</em>` : "";
      return `<div class="bar${x.n ? "" : " zero"}${x.date === t ? " is-today" : ""}" title="${fmtMD(x.date)}：${x.n} 次">` +
        (inside ? "" : val) +
        `<i style="height:${h}%;${future ? "min-height:0" : ""}">${inside ? val : ""}</i><small>${label}</small></div>`;
    }).join("");
}
$("rngWeek").onclick = () => { chartRange = "week"; $("rngWeek").setAttribute("aria-pressed", "true"); $("rngMonth").setAttribute("aria-pressed", "false"); renderHome(); };
$("rngMonth").onclick = () => { chartRange = "month"; $("rngMonth").setAttribute("aria-pressed", "true"); $("rngWeek").setAttribute("aria-pressed", "false"); renderHome(); };

/* ===== cards ===== */
function startPortion(round, portion) {
  const deck = portionIndices(portion).filter(i => i < data.words.length);
  if (!deck.length) { toast("這一份目前沒有單字"); return; }
  openDeck({ mode: "portion", round, portion, deck, title: `第 ${portion} 份` });
  const first = sess.deck.findIndex(i => !isRated(data.words[i], sess.since));
  if (first > 0) { sess.pos = first; renderCard(); }
}
function openDeck(o) {
  // `since`: a word touched on/after this date counts as rated in this session; `prev` keeps each word's level before this session.
  const since = o.mode === "portion" ? ratedSince(o.round, o.portion, today()) : today();
  sess = { ...o, since, prev: new Map(), pos: 0, flipped: false, startedAt: Date.now() };
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
const ratedCount = () => sess.deck.filter(i => isRated(data.words[i], sess.since)).length;
function renderCard() {
  const n = sess.deck.length, atEnd = sess.pos >= n, done = ratedCount();
  $("cTitle").textContent = `${sess.title} · ${Math.min(sess.pos + 1, n)} / ${n}`;
  $("cBar").style.width = Math.round((done / n) * 100) + "%";
  $("cardArea").classList.toggle("hidden", atEnd);
  $("doneArea").classList.toggle("hidden", !atEnd);
  if (atEnd) { renderDone(); return; }
  const i = sess.deck[sess.pos], w = data.words[i];
  if (!sess.prev.has(i)) sess.prev.set(i, w.date ? FAM[w.fam] : "—");
  const card = $("card");
  card.classList.add("no-anim");
  card.classList.toggle("flipped", sess.flipped);
  void card.offsetWidth;
  card.classList.remove("no-anim");
  $("fCat").textContent = w.cat;
  $("fWord").textContent = w.w; $("fPos").textContent = w.pos; $("fEx").textContent = w.ex; $("fExZh").textContent = w.exzh;
  $("bWord").textContent = w.w;
  $("bZh").textContent = w.zh; $("bDef").textContent = w.en; $("bEx").textContent = w.ex; $("bExZh").textContent = w.exzh;
  $("bSyn").textContent = w.syn || "—";
  $("bAnt").textContent = w.ant && w.ant !== "-" ? w.ant : "—";
  $("posInd").textContent = `${sess.pos + 1} / ${n}`;
  $("btnPrev").disabled = sess.pos === 0;
  const touched = !!w.date && w.date >= sess.since, rated = isRated(w, sess.since);
  document.querySelectorAll("#rate button").forEach(b => b.classList.toggle("on", touched && +b.dataset.f === w.fam));
  $("rLast").textContent = `上次：${sess.prev.get(i)}`;
  const st = $("rState");
  st.classList.toggle("is-rated", rated);
  st.innerHTML = icon(rated ? "rated" : "unrated") + `${rated ? "已評" : "未評"} · ${done}/${n}`;
}
function renderDone() {
  const n = sess.deck.length, done = ratedCount(), left = n - done;
  const mins = Math.max(1, Math.round((Date.now() - sess.startedAt) / 60000));
  const b = $("btnMark"), jump = $("btnJump");
  b.disabled = false;
  jump.classList.toggle("hidden", !left);
  if (sess.mode !== "portion") {
    $("dTitle").textContent = "看完了";
    $("dSub").textContent = `已評 ${done} / ${n}`;
    b.textContent = "回列表"; b.onclick = closeDeck;
    return;
  }
  const t = today(), { round, portion } = sess;
  $("dTitle").textContent = left ? `第 ${portion} 份還沒評完` : `第 ${portion} 份完成！`;
  $("dSub").textContent = `已評 ${done} / ${n} · ${mins} 分鐘`;
  if (isDone(data.log, round, portion)) {
    b.innerHTML = "本輪已標記過 " + icon("check") + " 回首頁"; b.onclick = closeDeck;
  } else if (left) {
    b.textContent = `還有 ${left} 張沒評`; b.disabled = true;
  } else if (!canMarkDone(round, portion, t)) {
    b.textContent = `${fmtMD(portionDate(round, portion))} 當天再標記`; b.disabled = true;
  } else {
    b.textContent = "標記完成";
    b.onclick = () => {
      const note = t > portionDate(round, portion) ? "補做" : "";
      const entry = { round, portion, date: t, words: done, minutes: mins, note };
      data.log.push(entry);
      sync.enqueue({ op: "done", ...entry });
      toast(`第 ${portion} 份已記錄`);
      closeDeck();
    };
  }
}
function go(d) {
  if (!sess) return;
  sess.lock = false;
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
  data.daily = { ...data.daily, [t]: (data.daily?.[t] || 0) + 1 };
  sync.enqueue({ op: "fam", row: w.row, w: w.w, fam: f, date: t });
}
function rate(f) {
  if (!sess || sess.pos >= sess.deck.length || sess.lock) return;
  sess.lock = true;
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
$("btnJump").onclick = () => {
  const k = sess.deck.findIndex(i => !isRated(data.words[i], sess.since));
  if (k >= 0) { sess.pos = k; sess.flipped = false; renderCard(); }
};
document.addEventListener("keydown", e => {
  if (!sess || $("sheet").classList.contains("open") || e.target.matches?.("input,select")) return;
  if (e.repeat && /^[1-4]$/.test(e.key)) return;
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
document.querySelectorAll("[data-icon]").forEach(el => { el.outerHTML = icon(el.dataset.icon); });
window.addEventListener("online", () => sync.flush());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  sync.flush();
  if (!sess && !$("main").classList.contains("hidden") && !$("viewHome").classList.contains("hidden")) renderHome();
});
boot();

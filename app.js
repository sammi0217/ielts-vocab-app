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

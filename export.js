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
  hdrRow(ws, 1, ["編號", "分類", "單字", "詞性", "中文解釋", "英文解釋", "例句 (IELTS 7.0)", "例句中文", "同義詞", "反義詞", "熟悉度", "上次複習日期", "複習次數", "備註", "最近拼字", "拼錯次數"]);
  ws.columns = [6, 14, 22, 8, 16, 38, 42, 34, 22, 20, 10, 14, 10, 20, 10, 10].map(width => ({ width }));
  words.forEach((w, i) => {
    const r = ws.getRow(i + 2);
    const vals = [i + 1, w.cat, w.w, w.pos, w.zh, w.en, w.ex, w.exzh, w.syn, w.ant, FAM[w.fam], toDate(w.date), w.cnt || 0, w.note || null, w.spell || null, w.miss || 0];
    vals.forEach((v, k) => {
      const c = r.getCell(k + 1);
      c.value = v; c.font = { name: "Arial", size: 10 }; c.border = BORDER;
      if ([5, 6, 7, 8].includes(k + 1)) c.alignment = { wrapText: true, vertical: "top" };
      else if ([1, 4, 11, 13, 15, 16].includes(k + 1)) c.alignment = { horizontal: "center", vertical: "top" };
      else c.alignment = { vertical: "top", wrapText: true };
      if (k + 1 === 12) c.numFmt = "yyyy-mm-dd";
    });
  });
  const last = words.length + 1, rng = `K2:K${last + 500}`;
  ws.autoFilter = `A1:P${last}`;
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

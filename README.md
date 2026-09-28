# 雅思單字複習 (IELTS vocab review)

手機優先的單字卡網頁。Google 試算表是唯一資料源，網頁透過 Apps Script 即時讀寫。
線上版：https://sammi0217.github.io/ielts-vocab-app/ （可加到主畫面，以全螢幕 App 模式開啟）

> 這個 repo 是 public，**不含任何單字內容**（出自《Pin IELTS 雅思單字本》）。單字只在執行時從試算表讀取。`data/`、`dist/`、`mock/` 已 gitignore。

## 功能
- **首頁**：本輪 7 天日期條、選到那一份的已評進度、連續完成天數（熱度格子）、掌握率與熟悉度分布。
- **單字卡**：點擊翻面、左右滑換卡、單字與例句發音、四段熟悉度；按鈕下方可照著單字打一遍（純練習，不記錄）。
- **拼字（聽寫）**：聽發音拼出單字，兩段提示，逐字母標出錯誤；拼錯的字進「拼錯清單」，可只練錯的。入口：首頁大卡、翻卡完成畫面、「拼字」分頁。
- **篩選列表**：依分類／熟悉度／關鍵字篩選，逐字改熟悉度，或把篩選結果當成卡片組複習。
- **設定**：同步碼、發音口音、聽寫自動念、加入行事曆、匯出 Excel 備份。

## 檔案
```
index.html          結構與樣式（含摺疊外螢幕的短螢幕模式）
app.js              開機、首頁、卡片、拼字、列表、設定（SYNC_URL 在這裡）
logic.js            純函式：排程、狀態、熱度格子、拼字比對、.ics
sync.js             API 呼叫 + 離線佇列（localStorage iv_queue / iv_cache）
mock.js             與 Apps Script 同契約的假後端（?mock=1）
swipe.js            卡片左右滑
export.js           匯出 Excel 備份
icons.js            內嵌的 Ant Design Icons（MIT）
manifest.webmanifest, img/   PWA 設定與主畫面圖示
apps-script/Code.gs 貼到試算表的 Apps Script
tests/              node:test 單元測試
tools/make_mock.mjs 產生本機假資料
```

## 複習邏輯
- 327 字依試算表順序切 7 份：47/47/47/47/47/46/46。
- 依日曆固定：2026-09-23 起，第 1 天第 1 份……第 7 天第 7 份，7 天一輪（`START` 在 `logic.js`）。
- 一份要「每個字都在這一輪評過（學習中以上）」才能標記完成；沒評完可用「只看沒評的」補評。
- 完成一份 → 「複習紀錄」新增一列；某輪 7 份都有紀錄＝完整輪替 1 次。連續完成天數以複習紀錄計算。
- 錯過的份數可補做（備註「補做」）；未來的份數可預習，但要到當天才能標記完成。
- 拼字結果**不影響**熟悉度與完成判斷。

## 資料流
- 點熟悉度 → 立即 POST 到 Apps Script → 寫入該列 K 熟悉度 / L 日期 / M 次數+1。
- 拼字送出 → 寫入 O 最近拼字（對／錯）/ P 拼錯次數（首次使用時自動補標題）。
- 離線時先存本機佇列，恢復連線後補送；`opId` 保證重送不會重複 +1。
- 單字以「列號＋單字」對應：**不要重新排序單字庫的列**。新增單字請加在最後一列。
- 第一次「標記完成」時，Apps Script 會把「複習紀錄」第 12–13 列改成新版標題。

## API（Apps Script，全部 POST，body 為 JSON）
| op | 參數 | 回傳 |
|---|---|---|
| `get` | – | `{ok, words[], log[]}`（word 含 `spell`、`miss`） |
| `fam` | `row, w, fam(0–3), date, opId` | `{ok, cnt}` |
| `done` | `round, portion, date, words, minutes, note, opId` | `{ok}` |
| `spell` | `row, w, ok, opId` | `{ok}` |

錯誤：`bad_token`、`not_found`、`bad_request`。token 一律放在 body，不放網址。

## 部署 Apps Script
1. 試算表「檔案 → 設定」時區設為台北。
2. 擴充功能 → Apps Script → 貼上 `apps-script/Code.gs`。
3. 專案設定 → 指令碼屬性 → `TOKEN`＝自訂 20 字元以上亂碼（`openssl rand -hex 16`）。
4. 部署 → 網頁應用程式（執行身分：我；存取：所有人）→ 網址填入 `app.js` 的 `SYNC_URL`。
5. 改過 Code.gs 後要「管理部署作業 → 編輯 → 新版本」，網址不變。改 `TOKEN` 不用重新部署，但每台裝置要在設定裡更新同步碼。

## 響應式
- 手機直式為主；≥768px 顯示上一張／下一張按鈕與鍵盤提示。
- **摺疊外螢幕模式**（高與寬都 ≤480px，如 Galaxy Z Flip 摺起來）：卡片填滿畫面、正面只留單字、熟悉度按鈕貼底、隱藏隨手打。設定裡可看「視窗尺寸」。

## 開發
```
npm test                       # 單元測試
node tools/make_mock.mjs       # 需要本機舊版 dist/index.html；產生 mock/data.json
```
ES modules 需透過 http 開啟（任何靜態伺服器皆可），測試用 `http://localhost:8000/?mock=1`，不能直接雙擊 index.html。

## 行事曆提醒
設定 → 加入行事曆 → 匯入 Google 日曆。每份每 7 天重複、08:00。若沒跳通知，將該日曆的預設通知設為「活動開始時」。

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
- 第一次「標記完成」時，Apps Script 會把「複習紀錄」第 12–13 列改成新版標題。

## API（Apps Script，全部 POST，body 為 JSON）
| op | 參數 | 回傳 |
|---|---|---|
| `get` | – | `{ok, words[], log[]}` |
| `fam` | `row, w, fam(0–3), date, opId` | `{ok, cnt}` |
| `done` | `round, portion, date, words, minutes, note, opId` | `{ok}` |

錯誤：`bad_token`、`not_found`、`bad_request`。token 一律放在 body，不放網址。

## 部署 Apps Script
1. 試算表「檔案 → 設定」時區設為台北。
2. 擴充功能 → Apps Script → 貼上 `apps-script/Code.gs`。
3. 專案設定 → 指令碼屬性 → `TOKEN`＝自訂 20 字元以上亂碼（`openssl rand -hex 16`）。
4. 部署 → 網頁應用程式（執行身分：我；存取：所有人）→ 網址填入 `app.js` 的 `SYNC_URL`。
5. 改過 Code.gs 後要「管理部署作業 → 編輯 → 新版本」，網址不變。

## 開發
```
npm test                       # 單元測試
node tools/make_mock.mjs       # 需要本機舊版 dist/index.html；產生 mock/data.json
```
ES modules 需透過 http 開啟（任何靜態伺服器皆可），測試用 `http://localhost:8000/?mock=1`，不能直接雙擊 index.html。

## 行事曆提醒
設定 → 加入行事曆 → 匯入 Google 日曆。每份每 7 天重複、08:00。若沒跳通知，將該日曆的預設通知設為「活動開始時」。

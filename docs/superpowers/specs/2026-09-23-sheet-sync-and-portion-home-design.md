# 設計：試算表即時同步 + 份數首頁 + 卡片滑動 + 行事曆提醒

日期：2026-09-23　狀態：待 Sammi 審閱

## 目標
1. 點熟悉度 → 立即寫入 Google 試算表（熟悉度、上次複習日期、複習次數 +1）。
2. 首頁（第一層）＝選第幾份；一打開就知道「今天幾月幾號、做第幾份」。
3. 單字卡可左右滑動換張。
4. 每天早上 8:00 行事曆通知「今天做第 N 份」。
5. 保留「依分類」複習。

## 非目標
- 不做帳號系統、多使用者。
- 不做 PWA 推播通知（用行事曆取代）。
- 不改單字內容編輯流程（新增單字仍在試算表直接加列）。

---

## 1. 架構與資料流

```
Google 試算表 ──(Apps Script Web App: GET / POST, 需 token)── 網頁 (GitHub Pages)
                                                           └─ localStorage：快取、待送佇列、token、偏好
```

- **試算表是唯一正式紀錄**。網頁開啟時 `GET` 取得最新單字庫＋複習紀錄；不再需要 build.py / 下載 xlsx。
- **repo 不含任何單字內容**（出自《Pin IELTS 雅思單字本》，public repo 不應公開）。單字只在執行期從試算表讀取。`data/` 加入 `.gitignore`。
- **token**：Apps Script 的 Script Properties 存一組 `TOKEN`；網頁第一次開啟時在設定頁輸入，存在該裝置 localStorage。GET、POST 都要 token，因此公開網址＋公開原始碼都不會洩漏單字或被寫入。
- Script 網址（`SYNC_URL`）寫在網頁設定常數中（公開無妨，沒 token 無作用）。

## 2. Apps Script（`apps-script/Code.gs`，綁定在試算表）

部署：擴充功能 → Apps Script → 貼上 → 專案設定加 Script Property `TOKEN` → 部署為 Web App（以「我」的身分執行、存取權「任何人」）。

### 讀取（`op:"get"`）
回傳：
```json
{ "ok": true,
  "words": [{"id":1,"cat":"","w":"","pos":"","zh":"","en":"","ex":"","exzh":"","syn":"","ant":"","fam":0,"date":"2026-09-23","cnt":3,"note":""}],
  "log": [{"round":1,"portion":1,"date":"2026-09-23","words":47,"minutes":18,"note":""}] }
```
- `words` 來自「單字庫」A–N 欄（第 2 列起，C 欄空白略過）；以 `row`（試算表列號）識別，不用 A 欄編號（A 欄可能空白或重複）。`fam` 以 0–3 表示。
- `log` 來自「複習紀錄」第 14 列起 A–F 欄；輪次/份數欄若是文字（如「第1輪」）取其中數字。

### POST（body 為 JSON 字串，`Content-Type: text/plain` 以避開 CORS preflight）
- `{"token","op":"get"}` → 回傳上方 GET 內容（讀取也走 POST，token 不放在網址參數）。
- `{"token","op":"fam","opId","row","w","fam","date"}`
  → 以 `row` 找列，並確認 C 欄 = `w`（不符則回 `not_found`，避免試算表列序被改後寫錯字）。
  → 寫 K=熟悉度文字、L=`date`（使用者實際點選那天，離線補送也正確）、M=原值+1。回傳 `{ok, cnt}`。
- `{"token","op":"done","opId","round","portion","date","words","minutes","note"}`
  → 在「複習紀錄」A14 起第一個空列寫入。回傳 `{ok}`。
- **冪等**：`opId`（客戶端產生的隨機 id）記錄在 Script Properties 最近 300 筆；重送同一筆直接回 `{ok, dup:true}`，不會重複 +1。
- 以 `LockService` 包住寫入，避免兩台裝置同時寫。
- 錯誤回 `{ok:false, error:"bad_token"|"not_found"|"bad_request"}`。

## 3. 前端同步層

- **載入**：先用 localStorage `iv_cache` 立即畫面，背景 `GET` 更新後重畫。無 token → 顯示「輸入同步碼」畫面。無快取且 GET 失敗 → 顯示錯誤＋重試。
- **寫入**：樂觀更新（本機記錄先改 fam/date/cnt+1）→ 放入 `iv_queue` → 依序送出。成功移出佇列；網路錯誤保留，於 `online` 事件、下次開啟、下次寫入時重試；`bad_token` 停止重試並提示重新輸入。
- **狀態徽章**（首頁底部＋卡片頁頂部小字）：`✓ 已同步`／`⟳ N 筆未同步`／`⚠ 同步碼錯誤`。
- 「匯出 Excel」保留在設定頁當備份（沿用現有 ExcelJS 程式，資料來源改為目前記錄）。
- 移除：`iv_overrides_*` 機制、「清除熟悉度更動」按鈕（試算表才是正本，無需本機覆寫層）。

## 4. 排程邏輯（依日曆固定）

- `START = 2026-09-23`（第 1 輪第 1 份）。以裝置本地日期計算。
- `d = 今天 − START（天）`；`round = floor(d/7)+1`；`portion = d mod 7 + 1`。
- 本輪第 k 份的日期 = `START + (round−1)*7 + (k−1)`。
- 某份狀態（僅看本輪）：
  - **已完成 ✓**：`log` 中有 `round, portion` 相符的列
  - **今天**：k = 今日 portion 且未完成
  - **錯過**：日期 < 今天且未完成（可點進去補做；補做寫入原本的 round，`note`＝「補做」）
  - **之後**：日期 > 今天（仍可點進去預習，但完成紀錄只在該份日期當天或之後才可標記）
- **已完整輪替次數** ＝ `log` 中 7 份都齊全的 round 數。

## 5. UI

### 分頁
「首頁」／「篩選列表」。

### 首頁（第一層）
- **今日卡**（大、lilac 底）：`9/23（三）`、`今天做 第 1 份`、`第 1 輪 · 第 1/7 天`、按鈕［開始 →］。今日那份已完成時改顯示「今天完成了 ✓ 明天 9/24 做第 2 份」。
- **7 格份數**：每格顯示份數、該份日期、狀態（今天／✓／錯過／之後），配色區分。整格可點 → 進入該份卡片。
- 底部：`已完整輪替 N 次`、同步狀態徽章。

### 卡片頁（第二層）
- 頂部：`← 返回`、`第 1 份 · 12 / 47`、進度條。
- 卡片：點擊翻面（不變）；**左右滑**：
  - Pointer Events；移動 > 8px 後鎖定軸向，只在橫向為主時接管（卡片 `touch-action: pan-y`，不影響上下捲動）。
  - 拖曳中卡片跟手 `translateX(dx) rotate(dx·0.03deg)`。
  - 放開：`|dx| > 卡寬 25%` 或速度 > 0.5 px/ms → 飛出並換張（左滑＝下一張、右滑＝上一張）；否則彈回。
  - 有拖曳就不觸發翻面。`prefers-reduced-motion` 時不做動畫直接換。
- 熟悉度四鍵：點擊 → 同步層寫入 → 0.16s 後下一張（同現行）。鍵盤 ←/→/空白/1–4 保留。
- 上一張／下一張按鈕：僅寬螢幕（≥ 768px）顯示。
- **不再循環**：第一張不能往前、最後一張之後進入**完成畫面**：
  - 份數模式：「第 1 份完成！看了 47 字 · 18 分鐘」［標記完成］→ 送 `done`（words＝本次看過字數、minutes＝進入到按下的分鐘數）→ 回首頁。若該份日期在未來，按鈕停用並顯示「9/25 當天再標記」。
  - 分類模式：「看完了」［回列表］，不寫複習紀錄。

### 篩選列表
- 沿用現有搜尋／分類／熟悉度篩選與逐字熟悉度下拉（下拉變更同樣走同步層）。
- 新增按鈕［用卡片複習這 N 字］→ 以目前篩選結果開啟卡片頁（分類模式）。這取代原本下拉選單裡的「依分類」。

### 設定（⚙︎）
- 同步碼（token）輸入／更換、同步狀態、立即重試。
- 發音口音（不變）。
- **加入行事曆**：下載 `雅思單字複習.ics`。
- 匯出 Excel（備份）。

## 6. 行事曆提醒（`.ics`）
- 前端產生，7 個 VEVENT：第 k 份 DTSTART＝2026-09-(22+k) 08:00 Asia/Taipei（第 1 份 `20260923T080000`…第 7 份 `20260929T080000`）、15 分鐘、`RRULE:FREQ=DAILY;INTERVAL=7`、`SUMMARY:雅思 第k份（47字）`、`DESCRIPTION` 附網頁網址、`VALARM` 觸發 0 分鐘；含 Asia/Taipei `VTIMEZONE`。
- 限制：Google 日曆匯入 .ics 時通常忽略 VALARM，改用該日曆的預設通知；說明文字會提醒「匯入後若沒跳通知，到該日曆設定預設通知為『活動開始時』」。
- 因為排程是依日曆固定，事件永遠正確，不需隨進度更新。

## 7. 檔案結構（GitHub Pages，repo 根目錄發布）

```
index.html          UI 結構＋樣式（由 app_template.html 改寫，無佔位符）
logic.js            純函式（ES module）：排程、狀態、ics 產生、log 解析 —— 可用 node 測試
app.js              DOM、滑動、同步層、匯出
apps-script/Code.gs Apps Script 原始碼（貼到試算表用）
tests/logic.test.mjs  node:test 單元測試
README.md           更新：新資料流、部署 Apps Script 步驟、token 設定
.gitignore          加入 data/、dist/
```
- `build.py`、`app_template.html`、`dist/` 不再使用 → 刪除（`data/` 保留在本機但不進 repo）。

## 8. 錯誤處理摘要
| 情境 | 行為 |
|---|---|
| 無 token | 顯示輸入同步碼畫面 |
| GET 失敗、有快取 | 用快取，徽章顯示離線 |
| GET 失敗、無快取 | 錯誤訊息＋重試 |
| POST 網路錯誤 | 留在佇列，稍後重送（opId 保證不重複 +1） |
| `bad_token` | 停止重送，提示重新輸入 |
| `not_found`（id 與單字不符） | 丟棄該筆、toast 提示「試算表列序變了，請重新整理」 |

## 9. 測試與驗證
- `node --test tests/`：排程計算（跨月、第 8 天進第 2 輪）、狀態判定、完整輪數、log 文字數字解析、ics 內容（7 事件、日期、RRULE）。
- Apps Script：部署後以 curl 打 GET/POST（含錯 token、重複 opId）。
- UI：在內建瀏覽器以 mobile 尺寸實測首頁、滑動、完成流程、離線佇列（本機 mock 模式：`?mock=1` 讀取本機 gitignored 的 JSON，不打 Script）。

## 10. 需要 Sammi 動手的部分
1. 在試算表貼上 Apps Script、設 `TOKEN`、部署（我會寫逐步說明）。
2. 建 GitHub public repo 並開 Pages（可由我用 gh 代做，需你確認 repo 名稱）。
3. 匯入 `.ics` 到 Google 日曆。

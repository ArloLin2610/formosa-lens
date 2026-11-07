# 福爾摩沙透鏡 Formosa Lens v2

台股決策工作台：以官方開放資料比較全部上市（TWSE）與上櫃（TPEx）普通股，並提供個股的互動技術線圖、進出場時機、盤中明細與國發會景氣信號。

前端 React 19 + Vite + TypeScript，資料代理為 Netlify Functions，觀察清單與設定存在瀏覽器（可匯出／匯入），不需要登入。

## 功能

- **排名**：六種透鏡（均衡、價值、成長、動能、低本益比、高殖利率）重新加權五個因子分數；可依市場、產業、最低分數篩選，依任一欄排序，分頁顯示。
- **個股透鏡**：價格與基本面（本益比、股價淨值比、殖利率、營收年增／月增／累計）、因子分數、綜合判讀。
- **技術線圖**：1 日（5 分 K）、1 週、日 K、週 K、月 K；**拖曳平移、滾輪／雙指縮放、十字線與價格標籤**、點選 K 棒看明細；MA5／10／20、顧比 CBL 支撐壓力、量柱型態（高／低／倍／平／縮／增）、反轉 K 線（十字線、長下影、長上影）。
- **進出場時機**：建議進場區、停損、第一目標、風險報酬比、RSI、均線、動能、波動與資料信心。
- **盤中明細**：當日 1 分鐘行情，開盤時段每 30 秒合併官方最新成交。
- **本週精選**：每日收盤後掃描全部上市櫃股票近 5 年日收盤，依規則列出進場候選、出場／減碼候選與長期持有（近 1／3／5 年年化價格報酬），並附同樣規則過去 5 年的回測。統計篩選，不是投資建議。
- **景氣對策信號**：國發會最新燈號、分數與近 12 個月趨勢。
- 繁中／英文、淺色／深色、手機版面、`/` 快捷鍵聚焦搜尋。

## 本機開發

需要 Node.js 20.19 以上。

```bash
npm install
npm run dev:full      # 同時啟動本機 API（http://127.0.0.1:8787）與 Vite（http://127.0.0.1:5173）
```

或分開跑：`npm run dev:api` 與 `VITE_API_PROXY=http://127.0.0.1:8787 npm run dev`。

若已安裝 Netlify CLI，`npm run dev:netlify` 會用 Netlify 自己的方式服務 Functions（含 Netlify Blobs 快取）。

```bash
npm test              # Vitest 單元測試（資料解析、評分、技術指標、時機分析、視窗計算）
npm run typecheck     # TypeScript
npm run build         # 型別檢查 + 產生 dist/
```

## 部署：GitHub Actions → Netlify

每日資料（全市場快照、掃描與回測、景氣燈號）由 **GitHub Actions** 產生成 `public/data/*.json`，再把建好的網站整包部署到 Netlify；Netlify 上不跑排程、不用 build minutes，只有即時行情等少數函式在有人瀏覽時才執行。

1. 把這個資料夾推到 GitHub 倉庫（分支 `main`）。
2. 在倉庫 Settings → Secrets and variables → Actions 新增兩個 secret：
   - `NETLIFY_AUTH_TOKEN`：Netlify 個人存取權杖（app.netlify.com → User settings → Applications → Personal access tokens → New access token）
   - `NETLIFY_SITE_ID`：Netlify 站台的 Site ID（Site configuration → General → Site details）
3. 之後每次推上 `main`，以及每個平日台北 16:00 與 07:00，`.github/workflows/deploy.yml` 會自動：跑測試 → `npm run data:build` → `npm run build` → `netlify deploy --prod`。也可在 Actions 頁手動觸發（Run workflow）。

本機要產生同一份資料：`npm run data:build`（約 10 秒，輸出到 `public/data/`，已在 `.gitignore`）。沒有這些檔案時，前端會退回呼叫 `/api/*` 函式，功能相同但較慢。

`部署到Netlify.cmd` 仍可用來手動部署（會用 Netlify 的 build）。

## 資料來源與備援

| 資料 | 主要來源 | 備援 |
| --- | --- | --- |
| 上市日成交、本益比／殖利率／淨值比、月營收、公司基本資料 | TWSE OpenAPI | 內建 `fallback-market.json`（標示為備援資料） |
| 上櫃同上 | TPEx OpenAPI | 同上 |
| 全市場最新成交 | TWSE 市場資訊系統（MIS，含上櫃） | 無（顯示收盤資料） |
| 上市日 K 歷史 | TWSE `afterTrading/STOCK_DAY` | Yahoo Finance `.TW` |
| 上櫃日 K 歷史、盤中 1 分 K | Yahoo Finance `.TWO` / `.TW` | — |
| 景氣對策信號 | 國發會開放資料 zip | 內建最後驗證資料 |
| 全市場掃描與回測（近 5 年日收盤） | Yahoo Finance spark（每次 20 檔） | 前一天的靜態檔 |

`npm run refresh:fallback` 會用最新官方資料重建備援檔。

## 本週精選規則

- **進場候選**：MA20 ≥ MA60、股價在 MA20 附近（-1.5% 到 +8%）、RSI ≤ 70；分數由綜合分、與均線距離、RSI 區間、近三個月報酬組成，波動過高扣分。
- **出場／減碼候選**：股價跌破 MA20 且 MA20 < MA60（趨勢轉弱），或 RSI > 75 ／ 偏離 MA20 超過 12%（過熱）；跌幅、回撤與距高點距離越大分數越高。
- **長期持有**：所選期間年化價格報酬 × 回撤折扣 × 連續正報酬年數加權 + 殖利率。報酬不含股息。
- 三張表都先套用成交值門檻（預設 ≥ 1 億）排除流動性不足的股票。

## 評分方法

每檔股票五個 0–100 因子：

- **估值**：本益比（70%）與股價淨值比（30%）；沒有本益比（虧損或未公布）給中低分而非零分。
- **成長**：營收年增（55%）、累計年增（30%）、月增（15%）。
- **動能**：當日漲跌、收盤在今日區間的位置、開盤跳空。
- **品質**：有無獲利、成交值、成交筆數、資料完整度。
- **殖利率**。

各透鏡的權重在 `src/lib/scoring.ts`。綜合分數是同一天全市場的相對比較，不是買賣訊號。

## 專案結構

```
netlify/functions/      Netlify Functions（quotes, history, intraday, market-pulse；market / screen / ndc-signal 為靜態檔缺席時的備援）
netlify/functions/_shared  共用工具、快照建置與備援資料
src/lib/                純邏輯：資料建置、評分、技術指標、時機、盤中、國發會、視窗、格式、儲存
src/api/                前端 fetch
src/hooks/              市場資料輪詢、個股歷史／盤中、設定
src/components/         排名表、個股透鏡、技術線圖、側欄
src/i18n/copy.ts        繁中／英文文案
src/styles/app.css      設計 token 與樣式（淺色／深色）
scripts/                本機 API、每日資料管線（pipeline/build-data.ts）、備援資料更新、截圖
.github/workflows/      每日資料產生與部署
tests/                  Vitest
```

本工具僅供研究與教育用途，不構成投資建議。

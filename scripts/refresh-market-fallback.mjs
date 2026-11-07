// Rebuilds netlify/functions/_shared/fallback-market.json from the official
// open data. The functions serve this file only when a live source fails, and
// the UI labels it as stale. Usage: node scripts/refresh-market-fallback.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The library is TypeScript; load it through esbuild (installed with Vite).
const { transformSync } = require('esbuild');
const { readFileSync } = require('node:fs');
const source = readFileSync(resolve(here, '../src/lib/market.ts'), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
const market = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const headers = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/136.0 Safari/537.36' };
const get = async (url) => { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.json(); };
const twseBase = 'https://openapi.twse.com.tw/v1/';
const tpexBase = 'https://www.tpex.org.tw/openapi/v1/';
const [daily, valuations, revenue, companies, tDaily, tValuations, tRevenue, tCompanies] = await Promise.all([
  get(twseBase + 'exchangeReport/STOCK_DAY_ALL'), get(twseBase + 'exchangeReport/BWIBBU_ALL'), get(twseBase + 'opendata/t187ap05_L'), get(twseBase + 'opendata/t187ap03_L'),
  get(tpexBase + 'tpex_mainboard_daily_close_quotes'), get(tpexBase + 'tpex_mainboard_peratio_analysis'), get(tpexBase + 'mopsfin_t187ap05_O'), get(tpexBase + 'mopsfin_t187ap03_O'),
]);
const payload = {
  generatedAt: new Date().toISOString(),
  TWSE: { stocks: market.buildTwseStocks({ daily, valuations, revenue, companies }), marketDate: market.datasetDate(daily), revenuePeriod: market.datasetRevenuePeriod(revenue) },
  TPEx: { stocks: market.buildTpexStocks({ daily: tDaily, valuations: tValuations, revenue: tRevenue, companies: tCompanies }), marketDate: market.datasetDate(tDaily), revenuePeriod: market.datasetRevenuePeriod(tRevenue) },
};
const output = resolve(here, '../netlify/functions/_shared/fallback-market.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(payload));
console.log(`Saved ${payload.TWSE.stocks.length} TWSE + ${payload.TPEx.stocks.length} TPEx stocks (${payload.TWSE.marketDate}) to ${output}`);

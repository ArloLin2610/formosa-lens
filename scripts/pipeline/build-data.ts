// Daily data pipeline, run by GitHub Actions (or locally with `npm run data:build`).
// Produces the static JSON the site reads first, so the heavy work never runs
// inside a 10-second serverless function:
//   public/data/market.json      combined TWSE + TPEx snapshot
//   public/data/screen.json      market-wide metrics + rule backtest (full pass)
//   public/data/ndc-signal.json  business-cycle signal
//   public/data/manifest.json    generation time + row counts

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMarketSnapshot } from '../../netlify/functions/_shared/snapshot';
import { advanceScreen, getScreenPayload } from '../../netlify/functions/_shared/screen-store';
import ndcSignal from '../../netlify/functions/ndc-signal.mts';

const outDir = resolve(process.cwd(), 'public/data');
const started = Date.now();
const log = (message: string) => console.log(`[data] ${message} (${((Date.now() - started) / 1000).toFixed(1)}s)`);

await mkdir(outDir, { recursive: true });

// 1. Market snapshot: fresh download of the exchange files, with the deployed
// site as a mirror for sources this network cannot reach (FORMOSA_MIRROR_URL).
const market = await getMarketSnapshot({ refresh: true });
if (market.meta.stale.length) throw new Error(`Refusing to publish stale market data for ${market.meta.stale.join(', ')}`);
await writeFile(resolve(outDir, 'market.json'), JSON.stringify(market));
log(`market.json: ${market.stocks.length} stocks, trading day ${market.meta.marketDate}`);

// 2. Full market screen + backtest in one pass (no time limit here).
let state = await advanceScreen(Number.MAX_SAFE_INTEGER);
if (state.cursor !== 0) state = await advanceScreen(Number.MAX_SAFE_INTEGER); // defensive: finish the pass
const screen = await getScreenPayload();
if (!screen.meta.completedAt || screen.meta.covered < screen.meta.universe * 0.95) {
  throw new Error(`Screen pass incomplete: ${screen.meta.covered}/${screen.meta.universe}`);
}
await writeFile(resolve(outDir, 'screen.json'), JSON.stringify(screen));
log(`screen.json: ${screen.meta.covered}/${screen.meta.universe} stocks, backtest ${screen.backtest?.weeks ?? 0} weeks`);

// 3. Business-cycle signal.
const signalResponse = await ndcSignal();
const signal = await signalResponse.json();
await writeFile(resolve(outDir, 'ndc-signal.json'), JSON.stringify(signal));
log(`ndc-signal.json: ${signal.latest?.month} (${signal.meta?.status})`);

await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  marketDate: market.meta.marketDate,
  stocks: market.stocks.length,
  screened: screen.meta.covered,
  backtestWeeks: screen.backtest?.weeks ?? 0,
  signalMonth: signal.latest?.month ?? null,
}, null, 2));
log('done');

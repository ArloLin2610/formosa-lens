// Daily data pipeline, run by GitHub Actions (or locally with `npm run data:build`).
// Produces the static JSON the site reads first, so the heavy work never runs
// inside a 10-second serverless function:
//   public/data/market.json      combined TWSE + TPEx snapshot
//   public/data/screen.json      market-wide metrics + rule backtest (full pass)
//   public/data/ndc-signal.json  business-cycle signal
//   public/data/track.json       forward test: frozen weekly lists and what happened next
//   public/data/manifest.json    generation time + row counts
// It also freezes this week's lists into track/<ISO week>.json (CI only; the
// workflow commits that file, which is what makes the forward test tamper-evident).

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMarketSnapshot } from '../../netlify/functions/_shared/snapshot';
import { advanceScreen, fetchCloses, getScreenPayload } from '../../netlify/functions/_shared/screen-store';
import { buildSnapshot, forwardReturns, signalDateFor, summarizeForward, tradingCalendar, upsertSnapshot, type ForwardReturns, type ForwardSnapshot } from '../../src/lib/forward';
import { rocToIso } from '../../src/lib/market';
import type { ClosePoint } from '../../src/lib/screen';
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

// Forward test, part 1: load the weekly snapshots recorded so far. The screen
// pass below downloads every price series anyway, so we keep the slice of each
// one that starts shortly before the earliest signal date.
const trackDir = resolve(process.cwd(), 'track');
await mkdir(trackDir, { recursive: true });
const stored: ForwardSnapshot[] = [];
for (const file of (await readdir(trackDir)).filter((name) => /^\d{4}-W\d{2}\.json$/.test(name)).sort()) {
  stored.push(JSON.parse(await readFile(resolve(trackDir, file), 'utf8')) as ForwardSnapshot);
}
const marketDate = rocToIso(market.meta.marketDate);
const earliestSignal = [marketDate, ...stored.map((snapshot) => snapshot.signalDate)].sort()[0];
const keepFrom = Date.parse(`${earliestSignal}T00:00:00Z`) - 15 * 86_400_000;
const recentSeries = new Map<string, ClosePoint[]>();
const collect = (item: { ticker: string; market: string }, series: ClosePoint[]) => {
  recentSeries.set(`${item.market}:${item.ticker}`, series.filter((point) => point.t >= keepFrom));
};

// 2. Full market screen + backtest in one pass (no time limit here).
let state = await advanceScreen(Number.MAX_SAFE_INTEGER, collect);
if (state.cursor !== 0) state = await advanceScreen(Number.MAX_SAFE_INTEGER, collect); // defensive: finish the pass
const screen = await getScreenPayload();
if (!screen.meta.completedAt || screen.meta.covered < screen.meta.universe * 0.95) {
  throw new Error(`Screen pass incomplete: ${screen.meta.covered}/${screen.meta.universe}`);
}
await writeFile(resolve(outDir, 'screen.json'), JSON.stringify(screen));
log(`screen.json: ${screen.meta.covered}/${screen.meta.universe} stocks, backtest ${screen.backtest?.weeks ?? 0} weeks`);

// Forward test, part 2: freeze this week's lists, then score every snapshot
// against the prices that followed.
const signalDate = signalDateFor(marketDate, screen.entries);
const fresh = buildSnapshot(market.stocks, screen.entries, signalDate);
const { snapshots, changed } = upsertSnapshot(stored, fresh);
// Only CI writes the permanent record, so a local run can never leave a stray snapshot to be committed by accident.
const record = Boolean(process.env.CI || process.env.FORMOSA_TRACK_RECORD);
if (changed && record) {
  await writeFile(resolve(trackDir, `${fresh.week}.json`), `${JSON.stringify(fresh)}\n`);
  log(`track/${fresh.week}.json: lists frozen as of ${signalDate} (entry ${fresh.lists.entry.length}, exit ${fresh.lists.exit.length}, long-term ${fresh.lists.longTerm.length})`);
}
const taiex = await fetchCloses(['^TWII']).then((map) => map.get('^TWII') ?? null).catch(() => null);
if (!taiex?.length) console.warn('[data] TAIEX series unavailable; the forward test will omit the index column');
const calendar = tradingCalendar(recentSeries.values());
const cache = new Map<string, ForwardReturns | null>();
const lookup = (date: string, key: string) => {
  const id = `${date}|${key}`;
  if (!cache.has(id)) cache.set(id, forwardReturns(recentSeries.get(key) ?? [], date, calendar));
  return cache.get(id);
};
const latestDate = calendar[calendar.length - 1] ?? signalDate;
const track = summarizeForward(snapshots, lookup, (date) => (taiex ? forwardReturns(taiex, date, calendar) : null), latestDate > signalDate ? latestDate : signalDate);
await writeFile(resolve(outDir, 'track.json'), JSON.stringify(track));
log(`track.json: ${track.weeks} weekly snapshots since ${track.startedOn ?? 'n/a'}, latest ${track.latestSignal ?? 'n/a'}`);

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
  trackedWeeks: track.weeks,
  signalMonth: signal.latest?.month ?? null,
}, null, 2));
log('done');

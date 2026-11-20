// Daily data pipeline, run by GitHub Actions (or locally with `npm run data:build`).
// Produces the static JSON the site reads first, so the heavy work never runs
// inside a 10-second serverless function:
//   public/data/market.json      combined TWSE + TPEx snapshot
//   public/data/screen.json      market-wide metrics + rule backtest (full pass)
//   public/data/ndc-signal.json  business-cycle signal
//   public/data/track.json       forward test: frozen weekly lists and what happened next
//   public/data/market-pulse.json  index levels, six months of TAIEX, institutional flows, turnover
//   public/data/h/<ticker>.json  about one year of daily candles per stock (the chart)
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
import marketPulse from '../../netlify/functions/market-pulse.mts';
import { fetchJson, mapWithConcurrency, withRetry } from '../../netlify/functions/_shared/http';
import { yahooDailyCandles } from '../../src/lib/intraday';
import type { Candle } from '../../src/lib/types';

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

// 4. Market backdrop. The site is static, so this is computed here instead of by a server
// function; index levels are as of this run (the close, for the after-market run).
// The copy already published on the site is the fallback when a source is unreachable.
const published = (process.env.FORMOSA_PUBLISHED_URL ?? 'https://arlolin2610.github.io/formosa-lens').replace(/\/$/, '');
const publishedCopy = async <T,>(name: string): Promise<T | null> => {
  try {
    const response = await fetch(`${published}/data/${name}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const text = await response.text();
    return text.trimStart().startsWith('<') ? null : (JSON.parse(text) as T);
  } catch { return null; }
};
interface Pulse { indices: unknown[]; taiexHistory: unknown[]; flows: { twse: unknown[]; tpex: unknown[] } }
let pulse = await marketPulse().then((response) => (response.ok ? (response.json() as Promise<Pulse>) : null)).catch(() => null);
if (!pulse || (!pulse.indices.length && !pulse.taiexHistory.length && !pulse.flows.twse.length)) {
  console.warn('[data] market backdrop sources unavailable; keeping the published copy');
  pulse = await publishedCopy<Pulse>('market-pulse.json');
}
if (pulse) await writeFile(resolve(outDir, 'market-pulse.json'), JSON.stringify(pulse));
log(`market-pulse.json: ${pulse ? `${pulse.indices.length} indices, ${pulse.taiexHistory.length} TAIEX closes, flows ${pulse.flows.twse.length}/${pulse.flows.tpex.length}` : 'unavailable'}`);

// 5. Daily candles for every stock's chart (Yahoo Finance, one request per stock).
// A stock whose download fails keeps the copy already published on the site.
interface HistoryFile { d: string[]; o: Array<number | null>; h: Array<number | null>; l: Array<number | null>; c: number[]; v: Array<number | null>; source: string; fetchedAt: string }
const historyDir = resolve(outDir, 'h');
await mkdir(historyDir, { recursive: true });
const cents = (value: number | null | undefined): number | null => (value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);
const toFile = (candles: Candle[], source: string): HistoryFile => ({
  d: candles.map((candle) => candle.date), o: candles.map((candle) => cents(candle.open)), h: candles.map((candle) => cents(candle.high)), l: candles.map((candle) => cents(candle.low)),
  c: candles.map((candle) => cents(candle.close) as number), v: candles.map((candle) => candle.volume ?? null), source, fetchedAt: new Date().toISOString(),
});
let historyFresh = 0, historyKept = 0, historyMissing = 0;
await mapWithConcurrency(market.stocks, 6, async (stock) => {
  const symbol = `${stock.ticker}.${stock.market === 'TPEx' ? 'TWO' : 'TW'}`;
  let file: HistoryFile | null = null;
  try {
    const payload = await withRetry(() => fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y&events=history`, { headers: { referer: 'https://finance.yahoo.com/' }, timeoutMs: 15_000 }), { attempts: 2, delayMs: 1_200 });
    // Bars after the exchange's own latest trading day are a session still in progress: leave them out.
    const candles = yahooDailyCandles(payload as Parameters<typeof yahooDailyCandles>[0]).filter((candle) => candle.close != null && Number.isFinite(candle.close) && candle.date <= marketDate);
    if (candles.length >= 5) { file = toFile(candles, `Yahoo Finance (${symbol})`); historyFresh += 1; }
  } catch { /* fall back to the published copy below */ }
  if (!file) {
    file = await publishedCopy<HistoryFile>(`h/${stock.ticker}.json`);
    if (file) historyKept += 1; else { historyMissing += 1; return; }
  }
  await writeFile(resolve(historyDir, `${stock.ticker}.json`), JSON.stringify(file));
});
log(`h/*.json: ${historyFresh} fresh, ${historyKept} kept from the published site, ${historyMissing} missing`);
if (historyFresh + historyKept < market.stocks.length * 0.5) console.warn('[data] fewer than half of the stocks have chart history; charts will be missing on the site');

await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  marketDate: market.meta.marketDate,
  stocks: market.stocks.length,
  screened: screen.meta.covered,
  backtestWeeks: screen.backtest?.weeks ?? 0,
  trackedWeeks: track.weeks,
  signalMonth: signal.latest?.month ?? null,
  histories: historyFresh + historyKept,
}, null, 2));
log('done');

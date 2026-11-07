// Incremental market screen: every scheduled run pulls close history for the
// next chunk of symbols from Yahoo's spark endpoint (20 symbols per request),
// computes ScreenMetrics, and stores the growing map in Netlify Blobs. A full
// pass over ~1,960 symbols completes in about ten runs.

import { accumulateBacktest, mergeAggregates, summarizeBacktest, type BacktestAggregate } from '../../../src/lib/backtest';
import { computeScreenMetrics, type ClosePoint, type ScreenMetrics } from '../../../src/lib/screen';
import type { Market, ScreenPayload } from '../../../src/lib/types';
import { fetchJson, mapWithConcurrency } from './http';
import { getDatasets } from './snapshot';

const SPARK_URL = 'https://query1.finance.yahoo.com/v7/finance/spark';
const SYMBOLS_PER_CALL = 20;
const BLOB_STORE = 'formosa-lens';
const BLOB_KEY = 'screen-v2';
const BACKTEST_MIN_TRADE_VALUE = 3e7; // same tradeability floor as the picks

interface ScreenState {
  version: 2;
  entries: Record<string, ScreenMetrics>;
  cursor: number;
  universe: number;
  updatedAt: string | null;
  completedAt: string | null;
  /** Backtest aggregate of the last completed pass, and the one being built. */
  backtest: BacktestAggregate | null;
  backtestInProgress: BacktestAggregate;
}

interface SparkPayload {
  spark?: { result?: Array<{ symbol: string; response?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> }> | null };
}

let memory: ScreenState | null = null;

async function blobStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: BLOB_STORE, consistency: 'strong' });
  } catch { return null; }
}

const emptyState = (): ScreenState => ({ version: 2, entries: {}, cursor: 0, universe: 0, updatedAt: null, completedAt: null, backtest: null, backtestInProgress: {} });

export async function readScreenState(): Promise<ScreenState> {
  if (memory) return memory;
  const store = await blobStore();
  if (store) {
    try {
      const stored = (await store.get(BLOB_KEY, { type: 'json' })) as ScreenState | null;
      if (stored?.version === 2) { memory = stored; return stored; }
    } catch { /* fall through */ }
  }
  memory = emptyState();
  return memory;
}

async function writeScreenState(state: ScreenState): Promise<void> {
  memory = state;
  const store = await blobStore();
  if (!store) return;
  try { await store.setJSON(BLOB_KEY, state); } catch (error) { console.warn('[screen] blob write failed', error); }
}

const symbolFor = ({ ticker, market }: { ticker: string; market: Market }) => `${ticker}.${market === 'TPEx' ? 'TWO' : 'TW'}`;

async function spark(symbols: string[], range: '1y' | '5y', interval: '1d' | '1mo'): Promise<Map<string, ClosePoint[]>> {
  const url = new URL(SPARK_URL);
  url.search = new URLSearchParams({ symbols: symbols.join(','), range, interval }).toString();
  const payload = await fetchJson<SparkPayload>(url, { headers: { referer: 'https://finance.yahoo.com/' }, timeoutMs: 12_000 });
  const series = new Map<string, ClosePoint[]>();
  for (const result of payload.spark?.result ?? []) {
    const response = result.response?.[0];
    const timestamps = response?.timestamp ?? [];
    const closes = response?.indicators?.quote?.[0]?.close ?? [];
    series.set(result.symbol, timestamps.map((seconds, index) => ({ t: seconds * 1000, c: closes[index] as number })).filter((point) => point.c != null && Number.isFinite(point.c)));
  }
  return series;
}

interface UniverseItem { ticker: string; market: Market; tradeValue: number | null }

async function getUniverse(): Promise<UniverseItem[]> {
  const datasets = await getDatasets();
  return [...datasets.TWSE.stocks, ...datasets.TPEx.stocks].map(({ ticker, market, tradeValue }) => ({ ticker, market, tradeValue }));
}

/** Process the next `batches` × 20 symbols (five years of daily closes) and persist. Returns the state after the run. */
export async function advanceScreen(batches = 20): Promise<ScreenState & { processed: number; universe: number }> {
  const universe = await getUniverse();
  const state = await readScreenState();
  const start = state.cursor >= universe.length ? 0 : state.cursor;
  const slice = universe.slice(start, Number.isFinite(batches) ? start + batches * SYMBOLS_PER_CALL : undefined);
  const groups = Array.from({ length: Math.ceil(slice.length / SYMBOLS_PER_CALL) }, (_, index) => slice.slice(index * SYMBOLS_PER_CALL, (index + 1) * SYMBOLS_PER_CALL));

  const results = await mapWithConcurrency(groups, 5, async (group) => {
    const symbols = group.map(symbolFor);
    const daily = await spark(symbols, '5y', '1d');
    const aggregate: BacktestAggregate = {};
    const metrics = group.map((item) => {
      const series = daily.get(symbolFor(item)) ?? [];
      if ((item.tradeValue ?? 0) >= BACKTEST_MIN_TRADE_VALUE) accumulateBacktest(aggregate, series);
      return computeScreenMetrics(item.ticker, item.market, series);
    });
    return { metrics, aggregate };
  });

  let processed = 0;
  const entries = { ...state.entries };
  const inProgress = start === 0 ? {} : { ...state.backtestInProgress };
  for (const result of results) {
    if (result.status !== 'fulfilled') { console.warn('[screen] spark batch failed', result.reason); continue; }
    mergeAggregates(inProgress, result.value.aggregate);
    for (const metrics of result.value.metrics) {
      if (!metrics) continue;
      entries[`${metrics.market}:${metrics.ticker}`] = metrics;
      processed += 1;
    }
  }
  const nextCursor = start + slice.length;
  const completed = nextCursor >= universe.length;
  const next: ScreenState = {
    version: 2, entries, cursor: completed ? 0 : nextCursor, universe: universe.length,
    updatedAt: new Date().toISOString(), completedAt: completed ? new Date().toISOString() : state.completedAt,
    backtest: completed ? inProgress : state.backtest, backtestInProgress: completed ? {} : inProgress,
  };
  await writeScreenState(next);
  return { ...next, processed, universe: universe.length };
}

/** Read-only view of the stored screen; never triggers a market rebuild. */
export async function getScreenPayload(): Promise<ScreenPayload> {
  const state = await readScreenState();
  const aggregate = state.backtest ?? (Object.keys(state.backtestInProgress).length ? state.backtestInProgress : null);
  return {
    entries: state.entries,
    backtest: aggregate ? summarizeBacktest(aggregate) : null,
    backtestPartial: !state.backtest && !!aggregate,
    meta: { updatedAt: state.updatedAt, completedAt: state.completedAt, covered: Object.keys(state.entries).length, universe: state.universe, cursor: state.cursor, source: 'Yahoo Finance spark (5y daily closes)' },
  };
}

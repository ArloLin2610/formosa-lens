// Fetchers for the static data files. The whole site is static (GitHub Pages):
// the daily pipeline (GitHub Actions) writes every file under data/ and the
// site is republished with them, so there is no server to call. Every fetch has
// a timeout and validates the payload shape before it reaches React state.

import type { ForwardSummary } from '@/lib/forward';
import type { Candle, Market, MarketSnapshot, ScreenPayload, SignalPayload } from '@/lib/types';

/** URL of a file under the site's data folder; relative, so the site works from any path (Pages serves it under /formosa-lens/). */
const dataUrl = (name: string): string => `${import.meta.env.BASE_URL}data/${name}`;

async function getData<T>(name: string, timeoutMs = 25_000): Promise<T> {
  const response = await fetch(dataUrl(name), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${name} returned ${response.status}`);
  const text = await response.text();
  if (text.trimStart().startsWith('<')) throw new Error(`${name} is missing`); // a host's fallback page, not a data file
  return JSON.parse(text) as T;
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const payload = await getData<MarketSnapshot>('market.json', 40_000);
  if (!Array.isArray(payload.stocks) || !payload.stocks.length) throw new Error('Market snapshot was empty');
  return payload;
}

export interface HistoryPayload { candles: Candle[]; meta: { source: string; fetchedAt: string } }
/** Compact per-stock file written by the pipeline: one array per column. */
interface HistoryFile { d: string[]; o: Array<number | null>; h: Array<number | null>; l: Array<number | null>; c: number[]; v: Array<number | null>; source: string; fetchedAt: string }

/** About one year of daily candles for one stock (data/h/<ticker>.json). */
export async function fetchHistory(ticker: string, _market: Market): Promise<HistoryPayload> {
  const file = await getData<HistoryFile>(`h/${ticker}.json`);
  if (!Array.isArray(file.d) || !Array.isArray(file.c)) throw new Error('History payload was invalid');
  const candles: Candle[] = file.d.map((date, index) => ({ date, open: file.o[index] ?? null, high: file.h[index] ?? null, low: file.l[index] ?? null, close: file.c[index], volume: file.v[index] ?? null }));
  return { candles, meta: { source: file.source, fetchedAt: file.fetchedAt } };
}

export async function fetchSignal(): Promise<SignalPayload> {
  const payload = await getData<SignalPayload>('ndc-signal.json');
  if (!Array.isArray(payload.history) || !payload.history.length) throw new Error('Signal payload was invalid');
  return payload;
}

export async function fetchScreen(): Promise<ScreenPayload> {
  const payload = await getData<ScreenPayload>('screen.json', 40_000);
  if (!payload.entries || typeof payload.entries !== 'object') throw new Error('Screen payload was invalid');
  return payload;
}

/** Forward test results (null when absent). */
export async function fetchTrack(): Promise<ForwardSummary | null> {
  try {
    const payload = await getData<ForwardSummary>('track.json', 20_000);
    return Array.isArray(payload.log) && payload.lists ? payload : null;
  } catch { return null; }
}

export interface MarketPulse {
  indices: Array<{ code: string; name: string; value: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; change: number | null; date: string; time: string }>;
  taiexHistory: Array<{ date: string; close: number }>;
  flows: { date: string; twse: Array<{ investor: 'foreign' | 'trust' | 'dealer' | 'total'; net: number }>; tpex: Array<{ investor: 'foreign' | 'trust' | 'dealer' | 'total'; net: number }> };
  turnover: { date: string; tradeValue: number | null; transactions: number | null; taiex: number | null; change: number | null } | null;
  meta: { fetchedAt: string; sources: string[] };
}

export async function fetchMarketPulse(): Promise<MarketPulse> {
  const payload = await getData<MarketPulse>('market-pulse.json', 30_000);
  if (!Array.isArray(payload.indices)) throw new Error('Market pulse payload was invalid');
  return payload;
}

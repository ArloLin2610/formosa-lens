// Thin fetchers for the Netlify Functions. Every call has a timeout and
// validates the payload shape before it reaches React state.

import type { ForwardSummary } from '@/lib/forward';
import type { Candle, IntradayPayload, Market, MarketSnapshot, QuotePayload, ScreenPayload, SignalPayload } from '@/lib/types';

async function getJson<T>(path: string, timeoutMs = 25_000): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `${path} returned ${response.status}`);
  return body;
}

/**
 * Where the daily data lives. The pipeline (GitHub Actions) pushes the JSON files
 * to the repository's `data` branch on every run, so fresh data never needs a
 * Netlify deploy (each production deploy costs Netlify credits). The copy bundled
 * under /data dates from the last deploy and is the first fallback; the function
 * routes are the last one (local development, first deploys).
 */
const REMOTE_DATA: string = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? 'https://raw.githubusercontent.com/ArloLin2610/formosa-lens/data/';

async function getPublished<T>(name: string, timeoutMs: number): Promise<T | null> {
  const sources: Array<[string, number]> = [];
  if (REMOTE_DATA) sources.push([`${REMOTE_DATA}${name}`, Math.min(timeoutMs, 15_000)]);
  sources.push([`/data/${name}`, timeoutMs]);
  for (const [url, timeout] of sources) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.trimStart().startsWith('<')) continue; // the single-page fallback, not a data file
      return JSON.parse(text) as T;
    } catch { /* try the next source */ }
  }
  return null;
}

async function getStaticOrApi<T>(name: string, apiPath: string, timeoutMs: number): Promise<T> {
  return (await getPublished<T>(name, timeoutMs)) ?? getJson<T>(apiPath, timeoutMs);
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const payload = await getStaticOrApi<MarketSnapshot>('market.json', '/api/market', 40_000);
  if (!Array.isArray(payload.stocks) || !payload.stocks.length) throw new Error('Market snapshot was empty');
  return payload;
}

export async function fetchQuotes(): Promise<QuotePayload> {
  const payload = await getJson<QuotePayload>('/api/quotes', 30_000);
  if (!Array.isArray(payload.quotes)) throw new Error('Quote payload was invalid');
  return payload;
}

export interface HistoryPayload { candles: Candle[]; meta: { source: string; fetchedAt: string } }

export async function fetchHistory(ticker: string, market: Market, months = 12): Promise<HistoryPayload> {
  const query = new URLSearchParams({ ticker, market, months: String(months) });
  const payload = await getJson<HistoryPayload>(`/api/history?${query}`);
  if (!Array.isArray(payload.candles)) throw new Error('History payload was invalid');
  return payload;
}

export async function fetchIntraday(ticker: string, market: Market): Promise<IntradayPayload> {
  const query = new URLSearchParams({ ticker, market });
  const payload = await getJson<IntradayPayload>(`/api/intraday?${query}`);
  if (!Array.isArray(payload.candles) || !Array.isArray(payload.points)) throw new Error('Intraday payload was invalid');
  return payload;
}

export async function fetchSignal(): Promise<SignalPayload> {
  const payload = await getStaticOrApi<SignalPayload>('ndc-signal.json', '/api/ndc-signal', 25_000);
  if (!Array.isArray(payload.history) || !payload.history.length) throw new Error('Signal payload was invalid');
  return payload;
}

export async function fetchScreen(): Promise<ScreenPayload> {
  const payload = await getStaticOrApi<ScreenPayload>('screen.json', '/api/screen', 40_000);
  if (!payload.entries || typeof payload.entries !== 'object') throw new Error('Screen payload was invalid');
  return payload;
}

/** Forward test results; published only as a data file by the daily pipeline (null when absent). */
export async function fetchTrack(): Promise<ForwardSummary | null> {
  const payload = await getPublished<ForwardSummary>('track.json', 20_000);
  return payload && Array.isArray(payload.log) && payload.lists ? payload : null;
}

export interface MarketPulse {
  indices: Array<{ code: string; name: string; value: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; change: number | null; date: string; time: string }>;
  taiexHistory: Array<{ date: string; close: number }>;
  flows: { date: string; twse: Array<{ investor: 'foreign' | 'trust' | 'dealer' | 'total'; net: number }>; tpex: Array<{ investor: 'foreign' | 'trust' | 'dealer' | 'total'; net: number }> };
  turnover: { date: string; tradeValue: number | null; transactions: number | null; taiex: number | null; change: number | null } | null;
  meta: { fetchedAt: string; sources: string[] };
}

export async function fetchMarketPulse(): Promise<MarketPulse> {
  const payload = await getJson<MarketPulse>('/api/market-pulse', 30_000);
  if (!Array.isArray(payload.indices)) throw new Error('Market pulse payload was invalid');
  return payload;
}

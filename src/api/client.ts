// Thin fetchers for the Netlify Functions. Every call has a timeout and
// validates the payload shape before it reaches React state.

import type { Candle, IntradayPayload, Market, MarketSnapshot, QuotePayload, ScreenPayload, SignalPayload } from '@/lib/types';

async function getJson<T>(path: string, timeoutMs = 25_000): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `${path} returned ${response.status}`);
  return body;
}

/**
 * The daily pipeline (GitHub Actions) publishes static JSON under /data; the
 * function routes stay as fallbacks for local development and first deploys.
 */
async function getStaticOrApi<T>(staticPath: string, apiPath: string, timeoutMs: number): Promise<T> {
  try {
    const response = await fetch(staticPath, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) return (await response.json()) as T;
  } catch { /* fall through to the function */ }
  return getJson<T>(apiPath, timeoutMs);
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const payload = await getStaticOrApi<MarketSnapshot>('/data/market.json', '/api/market', 40_000);
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
  const payload = await getStaticOrApi<SignalPayload>('/data/ndc-signal.json', '/api/ndc-signal', 25_000);
  if (!Array.isArray(payload.history) || !payload.history.length) throw new Error('Signal payload was invalid');
  return payload;
}

export async function fetchScreen(): Promise<ScreenPayload> {
  const payload = await getStaticOrApi<ScreenPayload>('/data/screen.json', '/api/screen', 40_000);
  if (!payload.entries || typeof payload.entries !== 'object') throw new Error('Screen payload was invalid');
  return payload;
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

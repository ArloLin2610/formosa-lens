import type { Config } from '@netlify/functions';
import { rocToIso, toNumber } from '../../src/lib/market';
import { yahooDailyCandles } from '../../src/lib/intraday';
import type { Candle, Market } from '../../src/lib/types';
import { MemoryCache, TICKER, asMarket, errorResponse, fetchJson, json, mapWithConcurrency } from './_shared/http';

/**
 * GET /api/history?ticker=2330&market=TWSE&months=12 — daily candles.
 * TWSE: the exchange's own monthly STOCK_DAY files (fanned out server-side
 * with bounded concurrency), falling back to Yahoo Finance when the exchange
 * refuses the request. TPEx: Yahoo Finance (.TWO), which is what the TPEx site
 * itself lacks as a stable JSON history API.
 */
const TWSE_HISTORY = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const monthCache = new MemoryCache<Candle[]>(15 * 60_000, 600);
const seriesCache = new MemoryCache<{ candles: Candle[]; source: string }>(15 * 60_000, 300);

interface HistoryPayload { candles: Candle[]; meta: { source: string; fetchedAt: string; ticker: string; market: Market; months: number } }

const monthKeys = (count: number): string[] => {
  const now = new Date(Date.now() + 8 * 3_600_000); // Taipei calendar
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}01`;
  });
};

async function twseMonth(ticker: string, date: string): Promise<Candle[]> {
  const key = `${ticker}:${date}`;
  const cached = monthCache.get(key);
  if (cached) return cached;
  const url = new URL(TWSE_HISTORY);
  url.search = new URLSearchParams({ date, stockNo: ticker, response: 'json' }).toString();
  const payload = await fetchJson<{ stat?: string; data?: string[][] }>(url, { headers: { referer: 'https://www.twse.com.tw/' }, timeoutMs: 12_000 });
  if (payload.stat !== 'OK' || !Array.isArray(payload.data)) return monthCache.set(key, []);
  const candles = payload.data.map((row): Candle | null => {
    const close = toNumber(row[6]);
    const iso = rocToIso(row[0]);
    if (close == null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return { date: iso, open: toNumber(row[3]), high: toNumber(row[4]), low: toNumber(row[5]), close, volume: toNumber(row[1]) };
  }).filter((item): item is Candle => item !== null);
  // Past months never change; the current month is refreshed on the normal TTL.
  const isCurrentMonth = date === monthKeys(1)[0];
  return monthCache.set(key, candles, isCurrentMonth ? 15 * 60_000 : 12 * 3_600_000);
}

async function twseSeries(ticker: string, months: number): Promise<Candle[]> {
  const results = await mapWithConcurrency(monthKeys(months), 3, (date) => twseMonth(ticker, date));
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected && rejected.status === 'rejected') throw rejected.reason;
  const candles = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  return [...new Map(candles.map((item) => [item.date, item])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function yahooSeries(ticker: string, market: Market, months: number): Promise<Candle[]> {
  const url = new URL(`${YAHOO_CHART}${ticker}.${market === 'TPEx' ? 'TWO' : 'TW'}`);
  url.search = new URLSearchParams({ interval: '1d', range: months <= 6 ? '6mo' : months <= 12 ? '1y' : '2y', events: 'history' }).toString();
  const payload = await fetchJson(url, { headers: { referer: 'https://finance.yahoo.com/' }, timeoutMs: 15_000 });
  const candles = yahooDailyCandles(payload as Parameters<typeof yahooDailyCandles>[0]);
  const since = new Date(Date.now() - months * 31 * 86_400_000).toISOString().slice(0, 10);
  return candles.filter((candle) => candle.date >= since);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker') ?? '';
  const market = asMarket(url.searchParams.get('market'));
  const months = Math.min(24, Math.max(3, Number(url.searchParams.get('months')) || 12));
  if (!TICKER.test(ticker)) return json({ error: 'ticker must be a four-digit code' }, { status: 400 });

  const key = `${market}:${ticker}:${months}`;
  const cached = seriesCache.get(key);
  if (cached) return json({ candles: cached.candles, meta: { source: cached.source, fetchedAt: new Date().toISOString(), ticker, market, months } } satisfies HistoryPayload, { maxAge: 900, swr: 600 });

  try {
    let candles: Candle[] = [];
    let source = '';
    if (market === 'TWSE') {
      try {
        candles = await twseSeries(ticker, months);
        source = 'TWSE (afterTrading/STOCK_DAY)';
      } catch (error) {
        console.warn(`[history] TWSE refused ${ticker}: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (!candles.length) {
      candles = await yahooSeries(ticker, market, months);
      source = `Yahoo Finance (${ticker}.${market === 'TPEx' ? 'TWO' : 'TW'})`;
    }
    if (!candles.length) throw new Error('No price history returned');
    seriesCache.set(key, { candles, source });
    return json({ candles, meta: { source, fetchedAt: new Date().toISOString(), ticker, market, months } } satisfies HistoryPayload, { maxAge: 900, swr: 600 });
  } catch (error) {
    return errorResponse(error, 'Price history unavailable');
  }
}

export const config: Config = { path: '/api/history' };

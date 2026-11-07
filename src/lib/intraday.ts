// Intraday series helpers: Yahoo one-minute parsing, merging the official
// latest trade into points/candles, and bucketing for the price table.

import type { Candle, IntradayPoint, Stock } from './types';

export const INTRADAY_MAX_POINTS = 720;
const MINUTE = 60_000;

const finite = (value: unknown): number | null => {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface YahooChartPayload {
  chart?: { result?: Array<{
    meta?: { chartPreviousClose?: number; previousClose?: number; regularMarketPrice?: number };
    timestamp?: number[];
    indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
  }> };
}

export function parseYahooChart(payload: YahooChartPayload): { candles: Candle[]; points: IntradayPoint[]; previousClose: number | null } {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const previousClose = finite(result?.meta?.chartPreviousClose ?? result?.meta?.previousClose);
  if (!quote || !timestamps.length) return { candles: [], points: [], previousClose };

  const candles = timestamps.map((seconds, index): Candle | null => {
    const timestamp = finite(seconds) == null ? null : Number(seconds) * 1000;
    const close = finite(quote.close?.[index]);
    if (!timestamp || close == null) return null;
    const open = finite(quote.open?.[index]) ?? close;
    const high = finite(quote.high?.[index]) ?? Math.max(open, close);
    const low = finite(quote.low?.[index]) ?? Math.min(open, close);
    const volume = finite(quote.volume?.[index]);
    return { date: new Date(timestamp).toISOString(), timestamp, open, high, low, close, volume: volume != null && volume >= 0 ? volume : null };
  }).filter((item): item is Candle => item !== null).sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const points: IntradayPoint[] = candles.map((candle) => ({
    timestamp: candle.timestamp as number,
    price: candle.close,
    dayChange: previousClose ? (candle.close / previousClose - 1) * 100 : 0,
    kind: 'history',
  }));
  return { candles, points, previousClose };
}

/** Yahoo daily bars -> Candle[] with ISO dates (Taipei calendar day). */
export function yahooDailyCandles(payload: YahooChartPayload): Candle[] {
  const { candles } = parseYahooChart(payload);
  return candles.map((candle) => {
    const day = new Date((candle.timestamp as number) + 8 * 3_600_000);
    return { ...candle, timestamp: undefined, date: day.toISOString().slice(0, 10) };
  });
}

const quoteEpoch = (date?: string, time?: string): number | null => {
  if (!/^\d{8}$/.test(String(date ?? '')) || !/^\d{2}:\d{2}:\d{2}$/.test(String(time ?? ''))) return null;
  const value = String(date);
  const parsed = Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${time}+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
};

export function toIntradayPoint(stock: Stock | undefined): IntradayPoint | null {
  if (!stock?.ticker || stock.price == null || !stock.quoteTime) return null;
  const timestamp = stock.quoteTimestamp ?? quoteEpoch(stock.quoteDate, stock.quoteTime);
  if (!timestamp) return null;
  const point: IntradayPoint = { timestamp, price: stock.price, dayChange: stock.dayChange ?? 0, kind: stock.dataKind === 'latest' ? 'trade' : 'close' };
  if (stock.volume != null && stock.volume >= 0) point.volume = stock.volume;
  return point;
}

export function mergeIntradayPoint(points: IntradayPoint[], point: IntradayPoint | null, maxPoints = INTRADAY_MAX_POINTS): IntradayPoint[] {
  if (!point) return points;
  const next = [...points];
  const index = next.findIndex((item) => item.timestamp === point.timestamp);
  if (index >= 0) next[index] = point; else next.push(point);
  next.sort((a, b) => a.timestamp - b.timestamp);
  return next.slice(-maxPoints);
}

/** Keep the last point of each interval bucket (for the price table). */
export function bucketIntradayPoints(points: IntradayPoint[], minutes: number): IntradayPoint[] {
  const interval = Math.max(1, Number(minutes) || 1) * MINUTE;
  const buckets = new Map<number, IntradayPoint>();
  for (const point of points) buckets.set(Math.floor(point.timestamp / interval), point);
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

const stamp = (candle: Candle): number => Number(candle.timestamp ?? Date.parse(candle.date));

export function aggregateIntradayCandles(candles: Candle[] = [], minutes = 5): Candle[] {
  const interval = Math.max(1, Number(minutes) || 5) * MINUTE;
  const buckets = new Map<number, Candle>();
  const clean = candles.map((candle) => ({ ...candle, timestamp: stamp(candle) }))
    .filter((candle) => Number.isFinite(candle.timestamp) && Number.isFinite(candle.close))
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const candle of clean) {
    const bucketTimestamp = Math.floor(candle.timestamp / interval) * interval;
    const open = candle.open ?? candle.close, high = candle.high ?? candle.close, low = candle.low ?? candle.close;
    const volume = candle.volume != null && candle.volume >= 0 ? candle.volume : null;
    const current = buckets.get(bucketTimestamp);
    if (!current) {
      buckets.set(bucketTimestamp, { date: new Date(bucketTimestamp).toISOString(), timestamp: bucketTimestamp, open, high, low, close: candle.close, volume });
      continue;
    }
    current.high = Math.max(current.high ?? current.close, high);
    current.low = Math.min(current.low ?? current.close, low);
    current.close = candle.close;
    if (volume != null) current.volume = (current.volume ?? 0) + volume;
  }
  return [...buckets.values()].sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
}

/** Merge the official latest trade into its minute candle. Price only; interval volume is not estimated. */
export function mergeLatestPointIntoCandles(candles: Candle[] = [], point: IntradayPoint | null, minutes = 1): Candle[] {
  if (!point || !Number.isFinite(point.timestamp) || !Number.isFinite(point.price)) return candles;
  const interval = Math.max(1, Number(minutes) || 1) * MINUTE;
  const bucketTimestamp = Math.floor(point.timestamp / interval) * interval;
  const next = candles.map((candle) => ({ ...candle }));
  const index = next.findIndex((candle) => stamp(candle) === bucketTimestamp);
  if (index >= 0) {
    const candle = next[index];
    candle.high = Math.max(candle.high ?? candle.close, point.price);
    candle.low = Math.min(candle.low ?? candle.close, point.price);
    candle.close = point.price;
  } else {
    next.push({ date: new Date(bucketTimestamp).toISOString(), timestamp: bucketTimestamp, open: point.price, high: point.price, low: point.price, close: point.price, volume: null });
  }
  return next.sort((a, b) => stamp(a) - stamp(b)).slice(-390);
}

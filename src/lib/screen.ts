// Market-wide screen: per-stock metrics computed from close-only history
// (Yahoo spark gives closes for 20 symbols per request), and the ranking
// rules behind the weekly picks: entry candidates, exit candidates, and
// long-term holders. Pure functions, unit tested.

import { clamp } from './scoring';
import { annualizedVolatility, rsi } from './timing';
import type { Market, ScoredStock } from './types';

export interface ClosePoint { t: number; c: number }

export interface ScreenMetrics {
  ticker: string;
  market: Market;
  last: number;
  /** ISO date of the last close in the series. */
  asOf: string;
  days: number;
  ma20: number | null;
  ma60: number | null;
  rsi14: number | null;
  /** Percent returns over calendar windows (price only, dividends excluded). */
  ret1w: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  ret3y: number | null;
  ret5y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  volatility: number | null;
  /** Worst peak-to-trough decline over the last year, percent (negative). */
  maxDrawdown1y: number | null;
  /** Distance of the last close from the 52-week high, percent (negative or zero). */
  fromHigh52w: number | null;
  /** Count of positive calendar years among the last five (monthly series). */
  positiveYears: number | null;
  monthsOfHistory: number;
}

const average = (values: number[]): number | null => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value: number | null, digits = 2): number | null => (value == null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const DAY = 86_400_000;

const returnOver = (points: ClosePoint[], days: number): number | null => {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = last.t - days * DAY;
  // First point at or after the target date; needs at least ~80% of the window covered.
  const index = points.findIndex((point) => point.t >= target);
  if (index < 0 || index === points.length - 1) return null;
  const first = points[index];
  if (last.t - first.t < days * DAY * 0.8) return null;
  return first.c > 0 ? (last.c / first.c - 1) * 100 : null;
};

const cagr = (points: ClosePoint[], years: number): number | null => {
  const total = returnOver(points, years * 365);
  if (total == null) return null;
  return (Math.pow(1 + total / 100, 1 / years) - 1) * 100;
};

export function computeScreenMetrics(ticker: string, market: Market, daily: ClosePoint[], monthly: ClosePoint[] = []): ScreenMetrics | null {
  const all = daily.filter((point) => Number.isFinite(point.c) && point.c > 0 && Number.isFinite(point.t)).sort((a, b) => a.t - b.t);
  if (all.length < 20) return null;
  const lastT = all[all.length - 1].t;
  // Short-window metrics use the last year; long windows use the full history (or a monthly series when supplied).
  const clean = all.filter((point) => point.t >= lastT - 370 * DAY);
  const long = monthly.length ? monthly.filter((point) => Number.isFinite(point.c) && point.c > 0).sort((a, b) => a.t - b.t) : all;
  const closes = clean.map((point) => point.c);
  const last = closes[closes.length - 1];
  const ma20 = closes.length >= 20 ? average(closes.slice(-20)) : null;
  const ma60 = closes.length >= 60 ? average(closes.slice(-60)) : null;

  let peak = closes[0], drawdown = 0;
  for (const close of closes) { peak = Math.max(peak, close); drawdown = Math.min(drawdown, (close / peak - 1) * 100); }
  const high52 = Math.max(...closes);

  let positiveYears: number | null = null;
  if (long.length >= 24) {
    const byYear = new Map<number, { first: number; last: number }>();
    for (const point of long) {
      const year = new Date(point.t).getUTCFullYear();
      const entry = byYear.get(year);
      if (!entry) byYear.set(year, { first: point.c, last: point.c }); else entry.last = point.c;
    }
    const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).slice(-6, -1); // completed years only
    positiveYears = years.filter(([, entry]) => entry.last > entry.first).length;
  }
  const monthsOfHistory = Math.round((long[long.length - 1].t - long[0].t) / (30.44 * DAY)) + 1;

  return {
    ticker, market, last, asOf: new Date(lastT).toISOString().slice(0, 10), days: clean.length,
    ma20: round(ma20), ma60: round(ma60), rsi14: round(rsi(closes, 14), 1),
    ret1w: round(returnOver(clean, 7)), ret1m: round(returnOver(clean, 30)), ret3m: round(returnOver(clean, 91)), ret6m: round(returnOver(clean, 182)), ret1y: round(returnOver(clean, 365)),
    ret3y: round(returnOver(long, 3 * 365)), ret5y: round(returnOver(long, 5 * 365)),
    cagr3y: round(cagr(long, 3)), cagr5y: round(cagr(long, 5)),
    volatility: round(annualizedVolatility(closes), 1), maxDrawdown1y: round(drawdown, 1), fromHigh52w: round((last / high52 - 1) * 100, 1),
    positiveYears, monthsOfHistory,
  };
}

export type PickKind = 'entry' | 'exit' | 'longTerm';
export type PickReason =
  | 'aboveMa20' | 'bullishTrend' | 'rsiBalanced' | 'pullbackToMa' | 'strongQuarter' | 'nearHigh'
  | 'belowMa20' | 'bearishTrend' | 'rsiHot' | 'extended' | 'weakMonth' | 'deepDrawdown' | 'farFromHigh'
  | 'steadyYears' | 'lowDrawdown' | 'dividend';

export interface Pick {
  ticker: string;
  market: Market;
  kind: PickKind;
  score: number;
  reasons: PickReason[];
  metrics: ScreenMetrics;
  stock: ScoredStock;
}

export interface ScreenOptions {
  /** Minimum average daily turnover (TWD) to keep a stock tradeable; default 30M. */
  minTradeValue?: number;
  limit?: number;
}

const liquid = (stock: ScoredStock, minTradeValue: number) => (stock.tradeValue ?? 0) >= minTradeValue && stock.price >= 5;

/** Entry candidates: intact uptrend, momentum not overheated, pulled back towards the 20-day average. */
export function rankEntries(stocks: ScoredStock[], metrics: Map<string, ScreenMetrics>, { minTradeValue = 3e7, limit = 10 }: ScreenOptions = {}): Pick[] {
  const picks: Pick[] = [];
  for (const stock of stocks) {
    const m = metrics.get(`${stock.market}:${stock.ticker}`);
    if (!m || !liquid(stock, minTradeValue) || m.ma20 == null || m.ma60 == null || m.rsi14 == null) continue;
    const price = stock.price || m.last;
    const aboveMa20 = price >= m.ma20 * 0.985;
    const bullish = m.ma20 >= m.ma60;
    if (!aboveMa20 || !bullish) continue;
    if (m.rsi14 > 70 || price > m.ma20 * 1.08) continue; // chasing
    const reasons: PickReason[] = ['aboveMa20', 'bullishTrend'];
    const distance = (price / m.ma20 - 1) * 100; // 0-8%
    const proximity = clamp(100 - Math.abs(distance - 1.5) * 18); // best ~1-2% above MA20
    const rsiScore = m.rsi14 >= 45 && m.rsi14 <= 62 ? 100 : m.rsi14 < 45 ? clamp(40 + m.rsi14) : clamp(100 - (m.rsi14 - 62) * 6);
    if (m.rsi14 >= 45 && m.rsi14 <= 65) reasons.push('rsiBalanced');
    if (distance <= 3) reasons.push('pullbackToMa');
    const quarter = m.ret3m ?? 0;
    const trendScore = clamp(50 + quarter * 1.5);
    if (quarter >= 10) reasons.push('strongQuarter');
    if ((m.fromHigh52w ?? -100) >= -8) reasons.push('nearHigh');
    const volPenalty = Math.max(0, (m.volatility ?? 30) - 45) * 0.6;
    const score = Math.round(clamp(stock.total * 0.3 + proximity * 0.25 + rsiScore * 0.2 + trendScore * 0.25 - volPenalty));
    picks.push({ ticker: stock.ticker, market: stock.market, kind: 'entry', score, reasons, metrics: m, stock });
  }
  return picks.sort((a, b) => b.score - a.score || b.stock.total - a.stock.total).slice(0, limit);
}

/** Exit / reduce candidates: broken trend with fading momentum, or extended and overheated. */
export function rankExits(stocks: ScoredStock[], metrics: Map<string, ScreenMetrics>, { minTradeValue = 3e7, limit = 10 }: ScreenOptions = {}): Pick[] {
  const picks: Pick[] = [];
  for (const stock of stocks) {
    const m = metrics.get(`${stock.market}:${stock.ticker}`);
    if (!m || !liquid(stock, minTradeValue) || m.ma20 == null || m.ma60 == null || m.rsi14 == null) continue;
    const price = stock.price || m.last;
    const reasons: PickReason[] = [];
    let score = 0;
    const broken = price < m.ma20 && m.ma20 < m.ma60;
    const overheated = m.rsi14 > 75 || price > m.ma20 * 1.12;
    if (!broken && !overheated) continue;
    if (broken) {
      reasons.push('belowMa20', 'bearishTrend');
      // Continuous components so the list has a real order instead of ties.
      score += 30 + clamp((m.ma20 / price - 1) * 100 * 1.5, 0, 25);
      if ((m.ret1m ?? 0) <= -5) reasons.push('weakMonth');
      score += clamp(-(m.ret1m ?? 0) * 0.6, 0, 20);
      if ((m.maxDrawdown1y ?? 0) <= -25) reasons.push('deepDrawdown');
      score += clamp(-(m.maxDrawdown1y ?? 0) / 6, 0, 10);
      if ((m.fromHigh52w ?? 0) <= -20) reasons.push('farFromHigh');
      score += clamp(-(m.fromHigh52w ?? 0) / 6, 0, 10);
    }
    if (overheated) {
      if (m.rsi14 > 75) reasons.push('rsiHot');
      if (price > m.ma20 * 1.12) reasons.push('extended');
      score += 30 + clamp((m.rsi14 - 70) * 1.5, 0, 25) + clamp((price / m.ma20 - 1.1) * 100 * 1.5, 0, 20);
    }
    picks.push({ ticker: stock.ticker, market: stock.market, kind: 'exit', score: Math.round(clamp(score)), reasons, metrics: m, stock });
  }
  return picks.sort((a, b) => b.score - a.score || (a.metrics.ret1m ?? 0) - (b.metrics.ret1m ?? 0)).slice(0, limit);
}

export type Horizon = '1y' | '3y' | '5y';

/** Long-term holders: highest compounded price return over the horizon, with a consistency and drawdown lens. */
export function rankLongTerm(stocks: ScoredStock[], metrics: Map<string, ScreenMetrics>, horizon: Horizon = '3y', { minTradeValue = 3e7, limit = 10 }: ScreenOptions = {}): Pick[] {
  const picks: Pick[] = [];
  for (const stock of stocks) {
    const m = metrics.get(`${stock.market}:${stock.ticker}`);
    if (!m || !liquid(stock, minTradeValue)) continue;
    const annual = horizon === '1y' ? m.ret1y : horizon === '3y' ? m.cagr3y : m.cagr5y;
    if (annual == null) continue;
    const reasons: PickReason[] = [];
    if ((m.positiveYears ?? 0) >= 4) reasons.push('steadyYears');
    if ((m.maxDrawdown1y ?? -100) >= -15) reasons.push('lowDrawdown');
    if ((stock.dividendYield ?? 0) >= 3) reasons.push('dividend');
    if (m.ma20 != null && m.ma60 != null && m.ma20 >= m.ma60) reasons.push('bullishTrend');
    // Score = annualized return, discounted by how much of it was given back in
    // the worst drawdown and by consistency, so a single spike does not top the list.
    const drawdownFactor = 1 - 0.6 * Math.min(1, -(m.maxDrawdown1y ?? -30) / 100);
    const consistency = 0.8 + 0.05 * (m.positiveYears ?? 2);
    const score = annual * drawdownFactor * consistency + (stock.dividendYield ?? 0);
    picks.push({ ticker: stock.ticker, market: stock.market, kind: 'longTerm', score: Math.round(score * 10) / 10, reasons, metrics: m, stock });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, limit);
}

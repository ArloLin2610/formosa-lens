// Technical analysis helpers: timeframe aggregation, moving averages, volume
// bar classification, reversal candle shapes, and Guppy count-back lines.

import type { Candle } from './types';

export type Timeframe = 'day' | 'week' | 'month';

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const isoWeekKey = (value: string): string => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil((((date.getTime() - yearStart) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const periodKey = (date: string, timeframe: Timeframe): string =>
  timeframe === 'week' ? isoWeekKey(date) : timeframe === 'month' ? date.slice(0, 7) : date;

export interface PeriodCandle extends Candle {
  period?: string;
}

/** Group daily candles into weekly or monthly bars: first open, extrema, last close, summed volume. */
export function aggregateCandles(candles: Candle[] = [], timeframe: Timeframe = 'day'): PeriodCandle[] {
  const clean = candles
    .filter((item) => item?.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (timeframe === 'day') return clean.map((item) => ({ ...item }));

  const periods = new Map<string, PeriodCandle>();
  for (const candle of clean) {
    const key = periodKey(candle.date, timeframe);
    const current = periods.get(key);
    if (!current) {
      periods.set(key, {
        date: candle.date, period: key,
        open: candle.open ?? candle.close, high: candle.high ?? candle.close, low: candle.low ?? candle.close,
        close: candle.close, volume: candle.volume ?? 0,
      });
      continue;
    }
    current.date = candle.date;
    current.high = Math.max(current.high ?? candle.close, candle.high ?? candle.close);
    current.low = Math.min(current.low ?? candle.close, candle.low ?? candle.close);
    current.close = candle.close;
    current.volume = (current.volume ?? 0) + (candle.volume ?? 0);
  }
  return [...periods.values()];
}

export interface LinePoint { date: string; value: number }

/** Simple moving average aligned to the bar that completes the window. */
export function movingAverage(candles: Candle[] = [], period = 5): Array<LinePoint | null> {
  let sum = 0;
  return candles.map((candle, index) => {
    sum += candle.close;
    if (index >= period) sum -= candles[index - period].close;
    if (index + 1 < period) return null;
    return { date: candle.date, value: sum / period };
  });
}

export type VolumeType = 'high' | 'low' | 'double' | 'flat' | 'shrink' | 'increase';
const VOLUME_PRIORITY: VolumeType[] = ['double', 'high', 'low', 'increase', 'shrink', 'flat'];

export interface VolumeSignal {
  types: VolumeType[];
  primary: VolumeType | null;
  average: number | null;
  previous: number | null;
  averageRatio: number | null;
  previousRatio: number | null;
}

export function classifyVolumeBars(candles: Candle[] = [], {
  averageWindow = 20, highMultiplier = 1.8, lowMultiplier = 0.55, doubleMultiplier = 2,
  flatTolerance = 0.08, shrinkRatio = 0.7, trendStep = 0.08,
} = {}): VolumeSignal[] {
  const volumes = candles.map((candle) => (Number.isFinite(candle?.volume) && (candle.volume as number) > 0 ? (candle.volume as number) : 0));
  return volumes.map((volume, index) => {
    if (!volume) return { types: [], primary: null, average: null, previous: null, averageRatio: null, previousRatio: null };
    const recent = volumes.slice(Math.max(0, index - averageWindow), index).filter((value) => value > 0);
    const recentAverage = recent.length >= 3 ? average(recent) : null;
    const previous = index > 0 && volumes[index - 1] > 0 ? volumes[index - 1] : null;
    const twoBack = index > 1 && volumes[index - 2] > 0 ? volumes[index - 2] : null;
    const high = recentAverage != null && volume >= recentAverage * highMultiplier;
    const low = recentAverage != null && volume <= recentAverage * lowMultiplier;
    const doubled = previous != null && volume >= previous * doubleMultiplier;
    const flat = previous != null && Math.abs(volume - previous) / previous <= flatTolerance;
    const stairShrink = previous != null && twoBack != null && volume <= previous * (1 - trendStep) && previous <= twoBack * (1 - trendStep);
    const shrink = previous != null && (volume <= previous * shrinkRatio || stairShrink);
    const increase = previous != null && twoBack != null && volume >= previous * (1 + trendStep) && previous >= twoBack * (1 + trendStep) && !high && !doubled;
    const types: VolumeType[] = [];
    if (high) types.push('high');
    if (low) types.push('low');
    if (doubled) types.push('double');
    if (flat) types.push('flat');
    if (shrink) types.push('shrink');
    if (increase) types.push('increase');
    return {
      types,
      primary: VOLUME_PRIORITY.find((key) => types.includes(key)) ?? null,
      average: recentAverage,
      previous,
      averageRatio: recentAverage ? volume / recentAverage : null,
      previousRatio: previous ? volume / previous : null,
    };
  });
}

export type CandleType = 'doji' | 'longLower' | 'longUpper';
export type CandleContext = 'afterDecline' | 'afterAdvance' | 'neutral';
export type CandleConfirmation = 'bullish' | 'bearish' | 'pending' | 'unconfirmed' | 'none';

export interface CandleSignal {
  type: CandleType | null;
  context: CandleContext;
  confirmation: CandleConfirmation;
  bodyRatio: number | null;
  upperWickRatio: number | null;
  lowerWickRatio: number | null;
}

const emptyCandleSignal = (): CandleSignal => ({ type: null, context: 'neutral', confirmation: 'none', bodyRatio: null, upperWickRatio: null, lowerWickRatio: null });

export function classifyCandlePatterns(candles: Candle[] = [], {
  dojiBodyRatio = 0.1, dojiMinimumWickRatio = 0.2, dojiWickBalance = 0.35, wickBodyMultiplier = 2,
  longWickRatio = 0.55, oppositeWickRatio = 0.25, maximumBodyRatio = 0.35, contextLookback = 4, trendThreshold = 0.015,
} = {}): CandleSignal[] {
  return candles.map((candle, index) => {
    const { open, high, low, close } = candle ?? {};
    if (![open, high, low, close].every((value) => Number.isFinite(value)) || (high as number) <= (low as number)) return emptyCandleSignal();
    const o = open as number, h = high as number, l = low as number, c = close as number;
    const range = h - l;
    const body = Math.abs(c - o);
    const upperWick = Math.max(0, h - Math.max(o, c));
    const lowerWick = Math.max(0, Math.min(o, c) - l);
    const bodyRatio = body / range, upperWickRatio = upperWick / range, lowerWickRatio = lowerWick / range;
    const doji = bodyRatio <= dojiBodyRatio && upperWickRatio >= dojiMinimumWickRatio && lowerWickRatio >= dojiMinimumWickRatio
      && Math.abs(upperWickRatio - lowerWickRatio) <= dojiWickBalance;
    const longLower = !doji && bodyRatio <= maximumBodyRatio && lowerWick >= body * wickBodyMultiplier && lowerWickRatio >= longWickRatio && upperWickRatio <= oppositeWickRatio;
    const longUpper = !doji && bodyRatio <= maximumBodyRatio && upperWick >= body * wickBodyMultiplier && upperWickRatio >= longWickRatio && lowerWickRatio <= oppositeWickRatio;
    const type: CandleType | null = doji ? 'doji' : longLower ? 'longLower' : longUpper ? 'longUpper' : null;

    const priorClose = candles[Math.max(0, index - contextLookback)]?.close;
    const recentClose = candles[index - 1]?.close;
    const trend = index > 0 && Number.isFinite(priorClose) && priorClose !== 0 && Number.isFinite(recentClose) ? recentClose / priorClose - 1 : 0;
    const context: CandleContext = trend <= -trendThreshold ? 'afterDecline' : trend >= trendThreshold ? 'afterAdvance' : 'neutral';

    const nextClose = candles[index + 1]?.close;
    let confirmation: CandleConfirmation = type ? 'pending' : 'none';
    if (type && Number.isFinite(nextClose)) confirmation = nextClose > h ? 'bullish' : nextClose < l ? 'bearish' : 'unconfirmed';
    return { type, context, confirmation, bodyRatio, upperWickRatio, lowerWickRatio };
  });
}

export interface CountBackLevel {
  value: number;
  startIndex: number;
  anchorIndex: number;
  significantIndexes: number[];
  method: 'cbl' | 'range';
}

const candleValue = (candle: Candle | undefined, key: 'high' | 'low'): number | null => {
  const value = candle?.[key];
  if (Number.isFinite(value)) return value as number;
  return Number.isFinite(candle?.close) ? (candle as Candle).close : null;
};

type Compare = (value: number, extreme: number) => boolean;

const extremeIndex = (candles: Candle[], key: 'high' | 'low', comparison: Compare, startIndex = 0): number => {
  let match = -1;
  let extreme: number | null = null;
  candles.forEach((candle, index) => {
    if (index < startIndex) return;
    const value = candleValue(candle, key);
    if (value == null) return;
    if (extreme == null || comparison(value, extreme) || value === extreme) { extreme = value; match = index; }
  });
  return match;
};

function countBackLevel(candles: Candle[], options: { anchorKey: 'high' | 'low'; anchorComparison: Compare; stepKey: 'high' | 'low'; stepComparison: Compare; anchorLookback: number }): CountBackLevel | null {
  const anchorStart = Math.max(0, candles.length - options.anchorLookback);
  const anchorIndex = extremeIndex(candles, options.anchorKey, options.anchorComparison, anchorStart);
  if (anchorIndex < 0) return null;
  let level = candleValue(candles[anchorIndex], options.stepKey) as number;
  const significantIndexes = [anchorIndex];
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const value = candleValue(candles[index], options.stepKey);
    if (value == null || !options.stepComparison(value, level)) continue;
    level = value;
    significantIndexes.push(index);
    if (significantIndexes.length === 3) return { value: level, startIndex: index, anchorIndex, significantIndexes, method: 'cbl' };
  }
  return null;
}

function recentRangeLevel(candles: Candle[], key: 'high' | 'low', comparison: Compare, lookback: number): CountBackLevel | null {
  const index = extremeIndex(candles, key, comparison, Math.max(0, candles.length - lookback));
  if (index < 0) return null;
  return { value: candleValue(candles[index], key) as number, startIndex: index, anchorIndex: index, significantIndexes: [index], method: 'range' };
}

/**
 * Guppy Count Back Lines: a recent extreme plus two earlier significant bars.
 * They are volatility-aware reference levels, not predictions; a close across
 * the line confirms a break. When three significant bars do not exist the
 * recent range extreme is returned, explicitly labelled as such.
 */
export function countBackLevels(candles: Candle[] = [], { anchorLookback = 20, fallbackLookback = 20 } = {}): { support: CountBackLevel | null; resistance: CountBackLevel | null } {
  const clean = candles.filter((candle) => Number.isFinite(candle?.close));
  const lower: Compare = (value, extreme) => value < extreme;
  const higher: Compare = (value, extreme) => value > extreme;
  return {
    support: countBackLevel(clean, { anchorKey: 'high', anchorComparison: higher, stepKey: 'low', stepComparison: lower, anchorLookback })
      ?? recentRangeLevel(clean, 'low', lower, fallbackLookback),
    resistance: countBackLevel(clean, { anchorKey: 'low', anchorComparison: lower, stepKey: 'high', stepComparison: higher, anchorLookback })
      ?? recentRangeLevel(clean, 'high', higher, fallbackLookback),
  };
}

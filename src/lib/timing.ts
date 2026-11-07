// Entry / exit timing analysis from daily candles. Price zones are estimates
// derived from history; they can fail around earnings, policy, or major news.

import { clamp } from './scoring';
import type { Candle, ScoredStock } from './types';

export type TimingSignal = 'enter' | 'hold' | 'wait' | 'reduce';
export type TimingReason = 'aboveMa20' | 'belowMa20' | 'bullishTrend' | 'bearishTrend' | 'rsiHot' | 'rsiWeak' | 'rsiBalanced' | 'rewardFavorable' | 'highVolatility';

export interface TimingAnalysis {
  signal: TimingSignal;
  efficiency: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  riskReward: number | null;
  ma20: number;
  ma60: number | null;
  rsi14: number | null;
  momentum60: number;
  volatility: number | null;
  current: number;
  reasons: TimingReason[];
  points: Candle[];
  dataDays: number;
  confidence: 'high' | 'medium' | 'low';
}

const average = (values: number[]): number | null => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value: number | null, digits = 1): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const sma = (values: number[], period: number): number | null => (values.length >= period ? average(values.slice(-period)) : null);

/** Wilder-smoothed RSI. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gain += change; else loss -= change;
  }
  gain /= period; loss /= period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (!loss) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function annualizedVolatility(values: number[]): number | null {
  if (values.length < 21) return null;
  const window = values.slice(-61);
  const returns = window.slice(1).map((value, index) => Math.log(value / window[index]));
  const mean = average(returns) as number;
  const variance = average(returns.map((value) => (value - mean) ** 2)) as number;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function analyzeTiming(stock: Pick<ScoredStock, 'total'>, candles: Candle[] = []): TimingAnalysis | null {
  const clean = candles.filter((item) => Number.isFinite(item.close) && item.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 20) return null;

  const closes = clean.map((item) => item.close);
  const current = closes.at(-1) as number;
  const ma20 = sma(closes, 20) as number;
  const ma60 = sma(closes, 60);
  const rsi14 = rsi(closes, 14);
  const volatility = annualizedVolatility(closes);
  const lookback = clean.slice(-20);
  const support = Math.min(...lookback.map((item) => item.low ?? item.close));
  const resistance = Math.max(...lookback.map((item) => item.high ?? item.close));
  const momentum60 = closes.length > 60 ? (current / closes[closes.length - 61] - 1) * 100 : (current / closes[0] - 1) * 100;
  const dailyRisk = Math.max(0.045, Math.min(0.12, ((volatility ?? 28) / Math.sqrt(252) / 100) * 2.2));
  const entryMid = current > ma20 ? ma20 : current;
  const entryLow = current > ma20 ? Math.max(support, entryMid * 0.985) : entryMid * 0.985;
  const entryHigh = current > ma20 ? Math.max(entryLow, Math.min(current, entryMid * 1.018)) : entryMid * 1.018;
  const stop = Math.min(entryLow * 0.965, current * (1 - dailyRisk));
  const target = Math.max(resistance, current * (1 + Math.max(0.06, dailyRisk * 1.7)));
  const upside = (target / current - 1) * 100;
  const downside = (current / stop - 1) * 100;
  const riskReward = downside > 0 ? upside / downside : null;

  let trendScore = current >= ma20 ? 68 : 42;
  if (ma60) trendScore += ma20 >= ma60 ? 17 : -12;
  trendScore += clamp(momentum60, -20, 20) * 0.7;
  const rsiValue = rsi14 ?? 50;
  const rsiScore = rsiValue >= 42 && rsiValue <= 65 ? 82 : rsiValue > 75 ? 25 : rsiValue < 30 ? 48 : 60;
  const riskRewardScore = clamp((riskReward ?? 1) * 35);
  const efficiency = Math.round(clamp(
    stock.total * 0.34 + trendScore * 0.28 + rsiScore * 0.16 + riskRewardScore * 0.22 - Math.max(0, (volatility ?? 25) - 45) * 0.25,
  ));

  let signal: TimingSignal = 'hold';
  if (current < ma20 && ma60 && ma20 < ma60 && momentum60 < 0) signal = 'reduce';
  else if (rsiValue > 70 || current > ma20 * 1.08) signal = 'wait';
  else if (efficiency >= 67 && current >= ma20 * 0.98 && (riskReward ?? 0) >= 1.25) signal = 'enter';

  const reasons: TimingReason[] = [current >= ma20 ? 'aboveMa20' : 'belowMa20'];
  if (ma60) reasons.push(ma20 >= ma60 ? 'bullishTrend' : 'bearishTrend');
  reasons.push(rsiValue > 70 ? 'rsiHot' : rsiValue < 35 ? 'rsiWeak' : 'rsiBalanced');
  if ((riskReward ?? 0) >= 1.5) reasons.push('rewardFavorable');
  if ((volatility ?? 0) > 55) reasons.push('highVolatility');

  return {
    signal, efficiency,
    entryLow: round(entryLow, 2) as number, entryHigh: round(entryHigh, 2) as number,
    stop: round(stop, 2) as number, target: round(target, 2) as number,
    riskReward: round(riskReward, 2), ma20: round(ma20, 2) as number, ma60: round(ma60, 2),
    rsi14: round(rsi14, 1), momentum60: round(momentum60, 1) as number, volatility: round(volatility, 1),
    current: round(current, 2) as number, reasons, points: clean.slice(-120), dataDays: clean.length,
    confidence: clean.length >= 100 ? 'high' : clean.length >= 60 ? 'medium' : 'low',
  };
}

// Factor scores (0-100) and lens weights. Scores are a comparison tool across
// the whole market on one day; they are not trade signals.

import type { Lens, ScoreBreakdown, Stock } from './types';

export const LENSES: Lens[] = ['balanced', 'value', 'growth', 'trading', 'pe', 'yield'];

export const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));

/** Smooth ramp: `center` -> 50, `center ± scale` -> 50 ± 38, saturating towards 0/100. */
const ramp = (value: number, center: number, scale: number, invert = false): number => {
  const z = (value - center) / scale;
  const score = 50 + 50 * Math.tanh(invert ? -z : z);
  return clamp(score);
};

/** Weights per lens: [value, growth, momentum, quality, yield]. Each row sums to 1. */
export const LENS_WEIGHTS: Record<Lens, [number, number, number, number, number]> = {
  balanced: [0.26, 0.26, 0.16, 0.22, 0.10],
  value: [0.44, 0.14, 0.08, 0.22, 0.12],
  growth: [0.14, 0.46, 0.16, 0.20, 0.04],
  trading: [0.10, 0.12, 0.54, 0.20, 0.04],
  pe: [0.58, 0.10, 0.06, 0.18, 0.08],
  yield: [0.22, 0.10, 0.06, 0.20, 0.42],
};

export function valueScore(stock: Pick<Stock, 'pe' | 'pb'>): number {
  // No P/E published means trailing losses or no data: neutral-low, not punished to zero.
  const peScore = stock.pe == null ? 32 : ramp(stock.pe, 20, 12, true);
  const pbScore = stock.pb == null ? 50 : ramp(stock.pb, 2.2, 1.6, true);
  return Math.round(peScore * 0.7 + pbScore * 0.3);
}

export function growthScore(stock: Pick<Stock, 'revenueGrowth' | 'revenueYtd' | 'revenueMoM'>): number {
  if (stock.revenueGrowth == null && stock.revenueYtd == null) return 45;
  const yoy = stock.revenueGrowth == null ? 50 : ramp(stock.revenueGrowth, 8, 25);
  const ytd = stock.revenueYtd == null ? yoy : ramp(stock.revenueYtd, 8, 25);
  const mom = stock.revenueMoM == null ? 50 : ramp(stock.revenueMoM, 0, 20);
  return Math.round(yoy * 0.55 + ytd * 0.3 + mom * 0.15);
}

export function momentumScore(stock: Pick<Stock, 'dayChange' | 'open' | 'high' | 'low' | 'price' | 'previousClose'>): number {
  const move = ramp(stock.dayChange ?? 0, 0, 3);
  // Where the latest price sits inside today's range: closing near the high
  // reads as stronger than the same percentage move that faded from the top.
  const high = stock.high, low = stock.low;
  let position = 50;
  if (high != null && low != null && high > low) position = clamp(((stock.price - low) / (high - low)) * 100);
  const gap = stock.open != null && stock.previousClose ? ramp(((stock.open - stock.previousClose) / stock.previousClose) * 100, 0, 2) : 50;
  return Math.round(move * 0.6 + position * 0.25 + gap * 0.15);
}

export function qualityScore(stock: Pick<Stock, 'pe' | 'tradeValue' | 'transactions' | 'revenueGrowth' | 'nameEn' | 'dividendYield'>): number {
  // Quality here means "how dependable is this record for comparison":
  // profitable (has a P/E), liquid, with complete fundamentals.
  const profitable = stock.pe != null ? 70 : 35;
  const liquidity = stock.tradeValue == null ? 40 : ramp(Math.log10(Math.max(stock.tradeValue, 1)), 8, 1.2); // 1e8 TWD/day -> 50
  const breadth = stock.transactions == null ? 45 : ramp(Math.log10(Math.max(stock.transactions, 1)), 3, 0.8);
  const completeness = 40 + (stock.revenueGrowth != null ? 20 : 0) + (stock.dividendYield != null ? 20 : 0) + (stock.nameEn ? 20 : 0);
  return Math.round(profitable * 0.35 + liquidity * 0.3 + breadth * 0.15 + completeness * 0.2);
}

export function yieldScore(stock: Pick<Stock, 'dividendYield'>): number {
  if (stock.dividendYield == null) return 30;
  return Math.round(ramp(stock.dividendYield, 3.5, 2.5));
}

export function scoreStock(stock: Stock, lens: Lens = 'balanced'): ScoreBreakdown {
  const value = valueScore(stock);
  const growth = growthScore(stock);
  const momentum = momentumScore(stock);
  const quality = qualityScore(stock);
  const yieldValue = yieldScore(stock);
  const [wValue, wGrowth, wMomentum, wQuality, wYield] = LENS_WEIGHTS[lens] ?? LENS_WEIGHTS.balanced;
  const total = value * wValue + growth * wGrowth + momentum * wMomentum + quality * wQuality + yieldValue * wYield;
  return { total: Math.round(clamp(total)), value, growth, momentum, quality, yieldScore: yieldValue };
}

export type SignalLabel = 'strong' | 'watch' | 'cautious';
export const signalLabel = (total: number): SignalLabel => (total >= 70 ? 'strong' : total >= 55 ? 'watch' : 'cautious');

/** Quick efficiency estimate from snapshot data only (the full version needs price history). */
export function estimateEfficiency(stock: Stock & ScoreBreakdown): number {
  const move = stock.dayChange ?? 0;
  const timing = move > 8 ? 30 : move < -8 ? 35 : clamp(62 + move * 2.2);
  return Math.round(clamp(stock.total * 0.55 + stock.value * 0.18 + stock.growth * 0.15 + timing * 0.12));
}

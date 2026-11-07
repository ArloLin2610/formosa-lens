import { describe, expect, test } from 'vitest';
import { accumulateBacktest, entryRule, exitRule, isoWeekKey, mergeAggregates, rsiSeries, summarizeBacktest, type BacktestAggregate } from '@/lib/backtest';
import { rsi } from '@/lib/timing';

const DAY = 86_400_000;
const series = (fn: (index: number) => number, length: number) => Array.from({ length }, (_, index) => ({ t: Date.UTC(2022, 0, 3) + index * DAY * (index % 7 >= 5 ? 1 : 1), c: fn(index) }));

describe('backtest primitives', () => {
  test('rules mirror the screen conditions', () => {
    expect(entryRule(101, 100, 95, 55)).toBe(true);
    expect(entryRule(110, 100, 95, 55)).toBe(false); // chasing
    expect(entryRule(101, 100, 105, 55)).toBe(false); // MA20 below MA60
    expect(exitRule(95, 100, 105, 40)).toBe(true); // broken
    expect(exitRule(115, 100, 95, 60)).toBe(true); // extended
    expect(exitRule(101, 100, 95, 55)).toBe(false);
  });
  test('rsiSeries matches the single-value Wilder RSI at the last bar', () => {
    const closes = Array.from({ length: 80 }, (_, index) => 100 + Math.sin(index / 4) * 5 + index * 0.1);
    const last = rsiSeries(closes).at(-1);
    expect(last).toBeCloseTo(rsi(closes) as number, 6);
    expect(rsiSeries(closes)[13]).toBeNull();
    expect(rsiSeries(closes)[14]).not.toBeNull();
  });
  test('ISO week keys', () => {
    expect(isoWeekKey(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekKey(Date.UTC(2024, 11, 30))).toBe('2025-W01');
  });
});

describe('accumulate + summarize', () => {
  test('a steady uptrend fires the entry rule and forward returns are positive', () => {
    const aggregate: BacktestAggregate = {};
    const evaluations = accumulateBacktest(aggregate, series((index) => 100 * Math.pow(1.0005, index) + Math.sin(index / 3) * 3, 400));
    expect(evaluations).toBeGreaterThan(50);
    const summary = summarizeBacktest(aggregate);
    expect(summary.entry[1].samples).toBeGreaterThan(0);
    expect(summary.entry[1].average).toBeGreaterThan(0);
    expect(summary.entry[1].winRate).toBeGreaterThan(50);
    // A single stock is (almost) its own benchmark; weeks with two evaluation days can differ slightly.
    expect(Math.abs(summary.entry[1].excess as number)).toBeLessThan(1);
    expect(summary.byYear.length).toBeGreaterThan(0);
  });
  test('benchmark is the equal-weight average across stocks on the same weeks', () => {
    const aggregate: BacktestAggregate = {};
    accumulateBacktest(aggregate, series((index) => 100 * Math.pow(1.0005, index) + Math.sin(index / 3) * 3, 300)); // gentle uptrend, fires entry
    accumulateBacktest(aggregate, series((index) => 100 * Math.pow(0.998, index) + Math.sin(index / 3) * 2, 300)); // falling, fires exit
    const summary = summarizeBacktest(aggregate);
    expect(summary.entry[1].excess).toBeGreaterThan(0);
    expect(summary.exit[1].excess).toBeLessThan(0);
    expect(summary.exit[1].average).toBeLessThan(0);
  });
  test('merging aggregates sums buckets', () => {
    const a: BacktestAggregate = {}, b: BacktestAggregate = {};
    accumulateBacktest(a, series((index) => 100 + index, 200));
    accumulateBacktest(b, series((index) => 100 + index, 200));
    const merged = mergeAggregates(a, b);
    const key = Object.keys(merged)[0];
    expect(merged[key].all.n[0]).toBe(2);
  });
  test('too little history is skipped', () => {
    const aggregate: BacktestAggregate = {};
    expect(accumulateBacktest(aggregate, series((index) => 100 + index, 40))).toBe(0);
  });
});

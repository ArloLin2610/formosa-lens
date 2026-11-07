import { describe, expect, test } from 'vitest';
import { aggregateCandles, classifyCandlePatterns, classifyVolumeBars, countBackLevels, movingAverage } from '@/lib/technical';
import type { Candle } from '@/lib/types';

const candles: Candle[] = [
  { date: '2026-07-27', open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { date: '2026-07-28', open: 11, high: 14, low: 10, close: 13, volume: 200 },
  { date: '2026-08-03', open: 13, high: 15, low: 12, close: 14, volume: 300 },
  { date: '2026-08-04', open: 14, high: 16, low: 13, close: 15, volume: 400 },
];

describe('aggregateCandles', () => {
  test('weekly candles keep first open, extrema, last close and summed volume', () => {
    const weekly = aggregateCandles(candles, 'week');
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toEqual({ date: '2026-07-28', period: '2026-W31', open: 10, high: 14, low: 9, close: 13, volume: 300 });
    expect(weekly[1]).toEqual({ date: '2026-08-04', period: '2026-W32', open: 13, high: 16, low: 12, close: 15, volume: 700 });
  });
  test('monthly candles aggregate across calendar months', () => {
    expect(aggregateCandles(candles, 'month').map((item) => [item.period, item.open, item.close])).toEqual([['2026-07', 10, 13], ['2026-08', 13, 15]]);
  });
});

test('moving average aligns to the bar completing the window', () => {
  expect(movingAverage(candles, 3).map((item) => item?.value ?? null)).toEqual([null, null, 12.666666666666666, 14]);
});

describe('classifyVolumeBars', () => {
  const volumes = (values: number[]): Candle[] => values.map((volume, index) => ({ date: `2026-08-${String(index + 1).padStart(2, '0')}`, open: 10, high: 10, low: 10, close: 10, volume }));
  test('detects high, low, double, flat, shrink and increasing bars', () => {
    expect(classifyVolumeBars(volumes([100, 100, 100, 190]))[3].primary).toBe('high');
    const low = classifyVolumeBars(volumes([100, 100, 100, 50]))[3];
    expect(low.types).toContain('low');
    expect(low.types).toContain('shrink');
    expect(low.primary).toBe('low');
    const doubled = classifyVolumeBars(volumes([100, 100, 100, 205]))[3];
    expect(doubled.types).toEqual(expect.arrayContaining(['high', 'double']));
    expect(doubled.primary).toBe('double');
    expect(classifyVolumeBars(volumes([100, 104]))[1].primary).toBe('flat');
    expect(classifyVolumeBars(volumes([100, 60]))[1].primary).toBe('shrink');
    expect(classifyVolumeBars(volumes([100, 110, 121]))[2].primary).toBe('increase');
  });
  test('ignores missing volume', () => {
    expect(classifyVolumeBars([{ date: '2026-08-01', open: 10, high: 10, low: 10, close: 10, volume: 0 }])[0].primary).toBeNull();
  });
});

describe('classifyCandlePatterns', () => {
  test('detects a doji and waits for a directional close', () => {
    const signals = classifyCandlePatterns([
      { date: 'a', open: 100, high: 102, low: 98, close: 100.05, volume: null },
      { date: 'b', open: 100, high: 103, low: 99, close: 102.5, volume: null },
    ]);
    expect(signals[0].type).toBe('doji');
    expect(signals[0].confirmation).toBe('bullish');
    expect(signals[1].confirmation).toBe('none');
  });
  test('reads long lower and upper wicks with trend context', () => {
    const lower = classifyCandlePatterns([
      { date: '1', open: 106, high: 107, low: 104, close: 105, volume: null },
      { date: '2', open: 104, high: 105, low: 102, close: 103, volume: null },
      { date: '3', open: 102, high: 103, low: 98, close: 99, volume: null },
      { date: '4', open: 100, high: 101, low: 90, close: 100.5, volume: null },
      { date: '5', open: 101, high: 104, low: 100, close: 103, volume: null },
    ]);
    expect(lower[3]).toMatchObject({ type: 'longLower', context: 'afterDecline', confirmation: 'bullish' });
    const upper = classifyCandlePatterns([
      { date: '1', open: 94, high: 96, low: 93, close: 95, volume: null },
      { date: '2', open: 96, high: 98, low: 95, close: 97, volume: null },
      { date: '3', open: 98, high: 100, low: 97, close: 99, volume: null },
      { date: '4', open: 99.5, high: 110, low: 99, close: 100, volume: null },
      { date: '5', open: 99, high: 100, low: 96, close: 97, volume: null },
    ]);
    expect(upper[3]).toMatchObject({ type: 'longUpper', context: 'afterAdvance', confirmation: 'bearish' });
  });
  test('ignores flat or incomplete bars', () => {
    expect(classifyCandlePatterns([{ date: 'x', open: null, high: 10, low: 8, close: 9, volume: null }])[0].type).toBeNull();
    expect(classifyCandlePatterns([{ date: 'x', open: 9, high: 9, low: 9, close: 9, volume: null }])[0].type).toBeNull();
  });
});

describe('countBackLevels', () => {
  test('support uses the third significant low from the latest highest high', () => {
    const rising: Candle[] = [
      { date: '2026-08-01', open: 5, high: 8, low: 4, close: 7, volume: null },
      { date: '2026-08-02', open: 6, high: 9, low: 5, close: 8, volume: null },
      { date: '2026-08-03', open: 7, high: 10, low: 6, close: 9, volume: null },
      { date: '2026-08-04', open: 8, high: 11, low: 7, close: 10, volume: null },
      { date: '2026-08-05', open: 9, high: 20, low: 8, close: 18, volume: null },
    ];
    expect(countBackLevels(rising).support).toEqual({ value: 6, startIndex: 2, anchorIndex: 4, significantIndexes: [4, 3, 2], method: 'cbl' });
  });
  test('resistance uses the third significant high from the latest lowest low', () => {
    const falling: Candle[] = [16, 15, 14, 13, 12].map((high, index) => ({ date: `2026-08-0${index + 1}`, open: high - 10, high, low: 5 - index, close: 6 - index, volume: null }));
    expect(countBackLevels(falling).resistance).toEqual({ value: 14, startIndex: 2, anchorIndex: 4, significantIndexes: [4, 3, 2], method: 'cbl' });
  });
  test('falls back to the recent range extreme when three bars are unavailable', () => {
    const short: Candle[] = [
      { date: '2026-08-01', open: 9, high: 10, low: 8, close: 9, volume: null },
      { date: '2026-08-02', open: 10, high: 12, low: 9, close: 11, volume: null },
    ];
    expect(countBackLevels(short).resistance).toEqual({ value: 12, startIndex: 1, anchorIndex: 1, significantIndexes: [1], method: 'range' });
  });
});

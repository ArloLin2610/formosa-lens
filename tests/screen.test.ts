import { describe, expect, test } from 'vitest';
import { computeScreenMetrics, rankEntries, rankExits, rankLongTerm, type ClosePoint, type ScreenMetrics } from '@/lib/screen';
import type { ScoredStock } from '@/lib/types';

const DAY = 86_400_000;
const origin = Date.UTC(2026, 10, 2);
const daily = (fn: (index: number) => number, days = 250): ClosePoint[] => Array.from({ length: days }, (_, index) => ({ t: origin - (days - 1 - index) * DAY, c: fn(index) }));
const monthly = (fn: (index: number) => number, months = 60): ClosePoint[] => Array.from({ length: months }, (_, index) => ({ t: Date.UTC(2021, 11 + index, 1), c: fn(index) })); // Dec 2021 .. Nov 2026

const stock = (overrides: Partial<ScoredStock>): ScoredStock => ({
  ticker: '2330', market: 'TWSE', nameZh: '台積電', nameEn: 'TSMC', sectorZh: '半導體業', price: 100, open: null, high: null, low: null, previousClose: null, dayChange: 0,
  pe: 20, pb: 3, dividendYield: 2, revenueGrowth: 10, revenueMoM: 0, revenueYtd: 10, revenuePeriod: '11509', volume: 1e6, tradeValue: 5e8, transactions: 5000, dataKind: 'daily',
  total: 70, value: 60, growth: 60, momentum: 60, quality: 70, yieldScore: 50, efficiency: 70, ...overrides,
});

describe('computeScreenMetrics', () => {
  test('computes returns, averages and drawdown from a rising series', () => {
    const m = computeScreenMetrics('2330', 'TWSE', daily((index) => 100 + index * 0.5, 400), monthly((index) => 50 + index));
    expect(m).not.toBeNull();
    expect(m!.last).toBe(100 + 399 * 0.5);
    expect(m!.ma20).toBeGreaterThan(m!.ma60 as number);
    expect(m!.ret1m).toBeGreaterThan(0);
    expect(m!.ret1y).toBeCloseTo((299.5 / 117 - 1) * 100, 1);
    expect(m!.maxDrawdown1y).toBe(0);
    expect(m!.fromHigh52w).toBe(0);
    expect(m!.cagr3y).toBeGreaterThan(0);
    expect(m!.cagr5y).toBeGreaterThan(0);
    expect(m!.positiveYears).toBe(4); // 2022-2025 completed and rising; 2021 has a single month
  });
  test('measures the worst drawdown and distance from the high', () => {
    const m = computeScreenMetrics('1101', 'TWSE', daily((index) => (index < 100 ? 100 + index : 200 - (index - 100) * 0.8)));
    expect(m!.maxDrawdown1y).toBeLessThan(-50);
    expect(m!.fromHigh52w).toBeLessThan(-50);
    expect(m!.ret3y).toBeNull();
  });
  test('needs at least 20 closes', () => {
    expect(computeScreenMetrics('1101', 'TWSE', daily(() => 10, 10))).toBeNull();
  });
});

describe('rankings', () => {
  const metric = (overrides: Partial<ScreenMetrics>): ScreenMetrics => ({
    ticker: '2330', market: 'TWSE', last: 100, asOf: '2026-11-02', days: 240, ma20: 98, ma60: 90, rsi14: 55, ret1w: 1, ret1m: 4, ret3m: 15, ret6m: 20, ret1y: 40, ret3y: 90, ret5y: 150,
    cagr3y: 24, cagr5y: 20, volatility: 25, maxDrawdown1y: -12, fromHigh52w: -4, positiveYears: 4, monthsOfHistory: 60, ...overrides,
  });
  const metrics = new Map<string, ScreenMetrics>([
    ['TWSE:2330', metric({})],
    ['TWSE:2317', metric({ ticker: '2317', last: 100, ma20: 110, ma60: 120, rsi14: 30, ret1m: -12, maxDrawdown1y: -30, fromHigh52w: -28 })],
    ['TWSE:2454', metric({ ticker: '2454', last: 100, ma20: 85, ma60: 80, rsi14: 82, ret1m: 25 })],
    ['TPEx:5483', metric({ ticker: '5483', market: 'TPEx', cagr3y: 60, cagr5y: 45, ret1y: 120, maxDrawdown1y: -35, positiveYears: 3 })],
    ['TWSE:9999', metric({ ticker: '9999', rsi14: 50 })],
  ]);
  const stocks = [
    stock({ ticker: '2330', price: 100 }),
    stock({ ticker: '2317', price: 100, total: 55 }),
    stock({ ticker: '2454', price: 100, total: 60 }),
    stock({ ticker: '5483', market: 'TPEx', price: 100, total: 65 }),
    stock({ ticker: '9999', price: 100, tradeValue: 1e6 }), // illiquid
  ];
  test('entry candidates are liquid uptrends near MA20', () => {
    const picks = rankEntries(stocks, metrics);
    expect(picks.map((pick) => pick.ticker)).toEqual(['2330', '5483']);
    expect(picks[0].reasons).toEqual(expect.arrayContaining(['aboveMa20', 'bullishTrend', 'rsiBalanced', 'pullbackToMa']));
  });
  test('exit candidates include broken trends and overheated names', () => {
    const picks = rankExits(stocks, metrics);
    expect(picks.map((pick) => pick.ticker).sort()).toEqual(['2317', '2454']);
    expect(picks.find((pick) => pick.ticker === '2317')!.reasons).toEqual(expect.arrayContaining(['belowMa20', 'bearishTrend', 'weakMonth', 'deepDrawdown', 'farFromHigh']));
    expect(picks.find((pick) => pick.ticker === '2454')!.reasons).toEqual(expect.arrayContaining(['rsiHot', 'extended']));
  });
  test('long-term ranking follows the chosen horizon and skips illiquid names', () => {
    expect(rankLongTerm(stocks, metrics, '3y')[0].ticker).toBe('5483');
    expect(rankLongTerm(stocks, metrics, '1y')[0].ticker).toBe('5483');
    expect(rankLongTerm(stocks, metrics, '5y').map((pick) => pick.ticker)).not.toContain('9999');
    expect(rankLongTerm(stocks, metrics, '5y', { minTradeValue: 1e9 })).toHaveLength(0);
  });
});

import { describe, expect, test } from 'vitest';
import { LENSES, LENS_WEIGHTS, qualityScore, scoreStock, signalLabel, valueScore } from '@/lib/scoring';
import { analyzeTiming, rsi } from '@/lib/timing';
import { FALLBACK_SIGNAL_HISTORY, parseNdcSignalCsv, signalKeyForScore } from '@/lib/ndc';
import { quoteRefreshInterval, sessionPhase } from '@/lib/marketHours';
import { aggregateIntradayCandles, bucketIntradayPoints, mergeIntradayPoint, mergeLatestPointIntoCandles, parseYahooChart, toIntradayPoint, yahooDailyCandles } from '@/lib/intraday';
import { importSettings, sanitizeSettings } from '@/lib/storage';
import type { Candle, Stock } from '@/lib/types';

const stock: Stock = {
  ticker: '2330', market: 'TWSE', nameZh: '台積電', nameEn: 'TSMC', sectorZh: '半導體業', price: 1000, open: 990, high: 1005, low: 985,
  previousClose: 990, dayChange: 1.01, pe: 20, pb: 5, dividendYield: 1.2, revenueGrowth: 30, revenueMoM: 2, revenueYtd: 35,
  revenuePeriod: '11509', volume: 10_000, tradeValue: 1e10, transactions: 20_000, dataKind: 'daily',
};

describe('scoring', () => {
  test('every lens has weights summing to one', () => {
    for (const lens of LENSES) expect(LENS_WEIGHTS[lens].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
  });
  test('scores stay within 0-100 and favour cheaper P/E under the value lens', () => {
    const cheap = scoreStock({ ...stock, pe: 9, pb: 1 }, 'value');
    const dear = scoreStock({ ...stock, pe: 45, pb: 9 }, 'value');
    expect(cheap.total).toBeGreaterThan(dear.total);
    for (const value of Object.values(cheap)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(100); }
  });
  test('missing P/E is neutral-low, not zero', () => {
    expect(valueScore({ pe: null, pb: null })).toBeGreaterThan(20);
    expect(valueScore({ pe: null, pb: null })).toBeLessThan(valueScore({ pe: 15, pb: 1.5 }));
  });
  test('quality rewards liquidity and complete fundamentals', () => {
    expect(qualityScore(stock)).toBeGreaterThan(qualityScore({ ...stock, pe: null, tradeValue: 2e6, transactions: 40, revenueGrowth: null, nameEn: '', dividendYield: null }));
  });
  test('signal labels', () => {
    expect(signalLabel(80)).toBe('strong');
    expect(signalLabel(60)).toBe('watch');
    expect(signalLabel(40)).toBe('cautious');
  });
});

describe('timing', () => {
  const series = (length: number, start = 100, step = 0.5): Candle[] => Array.from({ length }, (_, index) => {
    const close = start + index * step + Math.sin(index / 3) * 2;
    return { date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), open: close - 0.5, high: close + 1.5, low: close - 1.5, close, volume: 1000 };
  });
  test('needs at least 20 bars', () => {
    expect(analyzeTiming({ total: 70 }, series(10))).toBeNull();
  });
  test('produces coherent levels on an uptrend', () => {
    const analysis = analyzeTiming({ total: 72 }, series(140));
    expect(analysis).not.toBeNull();
    expect(analysis!.stop).toBeLessThan(analysis!.entryLow);
    expect(analysis!.entryLow).toBeLessThanOrEqual(analysis!.entryHigh);
    expect(analysis!.target).toBeGreaterThan(analysis!.current);
    expect(analysis!.confidence).toBe('high');
    expect(analysis!.reasons).toContain('aboveMa20');
    expect(analysis!.reasons).toContain('bullishTrend');
  });
  test('Wilder RSI is 100 with no losses and near 50 for a flat alternating series', () => {
    expect(rsi(Array.from({ length: 30 }, (_, index) => index))).toBe(100);
    const alternating = Array.from({ length: 60 }, (_, index) => 100 + (index % 2));
    expect(rsi(alternating)!).toBeGreaterThan(40);
    expect(rsi(alternating)!).toBeLessThan(60);
  });
});

describe('NDC signal', () => {
  const csv = `"Date","領先指標綜合指數","領先指標不含趨勢指數","同時指標綜合指數","同時指標不含趨勢指數","落後指標綜合指數","落後指標不含趨勢指數","景氣對策信號綜合分數","景氣對策信號"
202607,137.7,103.5,139.9,105.1,138.1,103.8,41,紅
202608,140.4,104.1,141.9,105.1,141.5,104.9,40,紅
202609,143.2,104.6,143.9,105.2,144.9,105.9,41,紅
202610,0,0,0,0,0,0,-,-`;
  test('parses the newest published rows and skips unpublished ones', () => {
    const history = parseNdcSignalCsv(csv, 2);
    expect(history.map((record) => record.month)).toEqual(['2026/08', '2026/09']);
    expect(history.at(-1)).toEqual({ month: '2026/09', score: 41, signalKey: 'red', signalZh: '紅' });
  });
  test('fallback history is ascending and ends on the verified release', () => {
    expect(FALLBACK_SIGNAL_HISTORY.at(-1)).toMatchObject({ month: '2026/09', score: 41 });
    expect([...FALLBACK_SIGNAL_HISTORY].sort((a, b) => a.month.localeCompare(b.month))).toEqual(FALLBACK_SIGNAL_HISTORY);
  });
  test('score bands', () => {
    expect(signalKeyForScore(16)).toBe('blue');
    expect(signalKeyForScore(23)).toBe('green');
    expect(signalKeyForScore(37)).toBe('yellowRed');
    expect(signalKeyForScore(38)).toBe('red');
  });
});

describe('market hours (Taipei)', () => {
  const at = (iso: string) => Date.parse(iso);
  test('phases', () => {
    expect(sessionPhase(at('2026-11-02T01:30:00Z'))).toBe('open'); // Mon 09:30 Taipei
    expect(sessionPhase(at('2026-11-02T00:45:00Z'))).toBe('preOpen');
    expect(sessionPhase(at('2026-11-02T06:00:00Z'))).toBe('afterClose');
    expect(sessionPhase(at('2026-11-01T02:00:00Z'))).toBe('closed'); // Sunday
    expect(sessionPhase(at('2026-11-02T14:00:00Z'))).toBe('closed');
  });
  test('polling slows outside the session and when hidden', () => {
    expect(quoteRefreshInterval(at('2026-11-02T01:30:00Z'))).toBe(30_000);
    expect(quoteRefreshInterval(at('2026-11-02T01:30:00Z'), true)).toBe(300_000);
    expect(quoteRefreshInterval(at('2026-11-01T02:00:00Z'))).toBe(1_800_000);
  });
});

describe('intraday', () => {
  test('parses and sorts Yahoo one-minute bars', () => {
    const parsed = parseYahooChart({ chart: { result: [{ meta: { chartPreviousClose: 100 }, timestamp: [20, 10, 30], indicators: { quote: [{ open: [101, 99, null], high: [103, 101, null], low: [100, 98, null], close: [102, 100, null], volume: [200, 100, null] }] } }] } });
    expect(parsed.previousClose).toBe(100);
    expect(parsed.candles.map((item) => item.timestamp)).toEqual([10_000, 20_000]);
    expect(parsed.points.map((item) => item.dayChange)).toEqual([0, 2.0000000000000018]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual({ candles: [], points: [], previousClose: null });
  });
  test('daily Yahoo bars become Taipei calendar dates', () => {
    const candles = yahooDailyCandles({ chart: { result: [{ timestamp: [Date.parse('2026-10-30T01:00:00Z') / 1000], indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [10] }] } }] } });
    expect(candles[0].date).toBe('2026-10-30');
  });
  test('latest quote becomes a trade point and merges into points and candles', () => {
    const point = toIntradayPoint({ ...stock, price: 2410, dayChange: 0.6, quoteDate: '20260812', quoteTime: '09:01:30', quoteTimestamp: 1786496490000, dataKind: 'latest' });
    expect(point).toMatchObject({ timestamp: 1786496490000, price: 2410, kind: 'trade' });
    const merged = mergeIntradayPoint([{ timestamp: 20, price: 2, dayChange: 0, kind: 'history' }, { timestamp: 10, price: 1, dayChange: 0, kind: 'history' }], { timestamp: 20, price: 3, dayChange: 0, kind: 'trade' });
    expect(merged.map((item) => item.price)).toEqual([1, 3]);
    const candles = mergeLatestPointIntoCandles([{ date: '2026-08-17T01:01:00.000Z', timestamp: Date.parse('2026-08-17T09:01:00+08:00'), open: 101, high: 103, low: 100, close: 102, volume: 30 }], { timestamp: Date.parse('2026-08-17T09:01:30+08:00'), price: 104, dayChange: 0, kind: 'trade' }, 1);
    expect(candles[0]).toMatchObject({ open: 101, high: 104, low: 100, close: 104, volume: 30 });
  });
  test('buckets and aggregates by interval', () => {
    const minute = 60_000;
    const points = [1 * minute + 10, 1 * minute + 40, 2 * minute + 20, 6 * minute + 10].map((timestamp, index) => ({ timestamp, price: 100 + index, dayChange: 0, kind: 'history' as const }));
    expect(bucketIntradayPoints(points, 5).map((point) => point.price)).toEqual([102, 103]);
    const candles = aggregateIntradayCandles([
      { date: '', timestamp: Date.parse('2026-08-17T09:00:00+08:00'), open: 100, high: 102, low: 99, close: 101, volume: 20 },
      { date: '', timestamp: Date.parse('2026-08-17T09:01:00+08:00'), open: 101, high: 104, low: 100, close: 103, volume: 30 },
      { date: '', timestamp: Date.parse('2026-08-17T09:05:00+08:00'), open: 103, high: 105, low: 102, close: 104, volume: 40 },
    ], 5);
    expect(candles.map(({ open, high, low, close, volume }) => ({ open, high, low, close, volume }))).toEqual([
      { open: 100, high: 104, low: 99, close: 103, volume: 50 }, { open: 103, high: 105, low: 102, close: 104, volume: 40 },
    ]);
  });
});

describe('settings', () => {
  test('sanitizes untrusted input and migrates legacy guest data', () => {
    const settings = sanitizeSettings({ watchlist: ['2330', 'abc', '2330', '5483'], lang: 'en', lens: 'nope', selectedTicker: '2454', theme: 'dark', pageSize: 7 });
    expect(settings).toMatchObject({ watchlist: ['2330', '5483'], lang: 'en', lens: 'balanced', selectedTicker: '2454', theme: 'dark', pageSize: 50 });
  });
  test('rejects files that are not settings', () => {
    expect(() => importSettings('42')).toThrow();
    expect(importSettings('{"watchlist":["2317"]}').watchlist).toEqual(['2317']);
  });
});

import { describe, expect, test } from 'vitest';
import {
  FORWARD_HORIZONS, RULES_VERSION, buildSnapshot, forwardReturns, signalDateFor, summarizeForward, tradingCalendar, upsertSnapshot,
  type ForwardReturns, type ForwardSnapshot,
} from '@/lib/forward';
import type { ClosePoint, ScreenMetrics } from '@/lib/screen';
import type { Stock } from '@/lib/types';

const DAY = 86_400_000;
/** Weekday bars at 09:00 Taipei starting Monday 2026-01-05. */
const weekdays = (count: number): number[] => {
  const out: number[] = [];
  for (let day = 0; out.length < count; day += 1) {
    const t = Date.UTC(2026, 0, 5, 1) + day * DAY;
    if (![0, 6].includes(new Date(t).getUTCDay())) out.push(t);
  }
  return out;
};
const series = (closes: number[], skip: number[] = []): ClosePoint[] => weekdays(closes.length).map((t, index) => ({ t, c: closes[index] })).filter((_, index) => !skip.includes(index));
const dateAt = (index: number) => new Date(weekdays(index + 1)[index] + 8 * 3_600_000).toISOString().slice(0, 10);

describe('tradingCalendar', () => {
  test('keeps days most series traded on and drops stray ones', () => {
    const full = series(Array.from({ length: 10 }, () => 10));
    const stray: ClosePoint[] = [...full, { t: Date.UTC(2026, 0, 10, 1), c: 10 }]; // a Saturday bar on one series only
    const calendar = tradingCalendar([full, full, full, stray]);
    expect(calendar).toHaveLength(10);
    expect(calendar[0]).toBe('2026-01-05');
    expect(calendar).not.toContain('2026-01-10');
  });
});

describe('forwardReturns', () => {
  const closes = Array.from({ length: 30 }, (_, index) => 100 + index); // +1 a day
  const calendar = tradingCalendar([series(closes), series(closes)]);

  test('measures from the signal close on the shared calendar', () => {
    const result = forwardReturns(series(closes), dateAt(2), calendar) as ForwardReturns;
    expect(result.bars).toBe(27);
    expect(result.at[0]).toBeCloseTo((107 / 102 - 1) * 100, 2); // 5 trading days later
    expect(result.at[1]).toBeCloseTo((123 / 102 - 1) * 100, 2); // 21 trading days later
    expect(result.at[2]).toBeNull(); // 63 days have not passed
    expect(result.toDate).toBeCloseTo((129 / 102 - 1) * 100, 2);
  });
  test('a gap in one series does not shift its horizon', () => {
    // Bars 4 and 5 are missing from this series; day 7 is still day 7.
    const gappy = forwardReturns(series(closes, [4, 5]), dateAt(2), calendar) as ForwardReturns;
    expect(gappy.at[0]).toBeCloseTo((107 / 102 - 1) * 100, 2);
    // When the target day itself is missing, the last close before it is used.
    const missingTarget = forwardReturns(series(closes, [7]), dateAt(2), calendar) as ForwardReturns;
    expect(missingTarget.at[0]).toBeCloseTo((106 / 102 - 1) * 100, 2);
  });
  test('signal on a non-trading day uses the previous close; the signal day itself has no return yet', () => {
    const weekend = forwardReturns(series(closes), '2026-01-11', calendar) as ForwardReturns; // Sunday after bar 4
    expect(weekend.at[0]).toBeCloseTo((109 / 104 - 1) * 100, 2);
    const today = forwardReturns(series(closes), dateAt(29), calendar) as ForwardReturns;
    expect(today.bars).toBe(0);
    expect(today.toDate).toBeNull();
    expect(today.at.every((value) => value === null)).toBe(true);
  });
  test('no price near the signal date, or a stock that stopped trading, gives null', () => {
    expect(forwardReturns(series(closes).slice(20), dateAt(2), calendar)).toBeNull(); // listed later
    expect(forwardReturns([], dateAt(2), calendar)).toBeNull();
    const delisted = forwardReturns(series(closes).slice(0, 5), dateAt(2), calendar) as ForwardReturns; // last bar is day 4
    expect(delisted.at[0]).toBeCloseTo((104 / 102 - 1) * 100, 2); // within a week: last close stands
    expect(delisted.at[1]).toBeNull(); // a month later there is no price
    expect(delisted.toDate).toBeNull();
  });
});

const snapshot = (week: string, signalDate: string, overrides: Partial<ForwardSnapshot> = {}): ForwardSnapshot => ({
  version: 1, week, signalDate, recordedAt: `${signalDate}T10:00:00Z`, rules: RULES_VERSION, settings: { lens: 'balanced', minTradeValue: 1e8, longTermHorizon: '3y' },
  lists: {
    entry: [{ ticker: '1111', market: 'TWSE', name: '甲', nameEn: 'A', score: 80, price: 10 }, { ticker: '2222', market: 'TWSE', name: '乙', nameEn: 'B', score: 70, price: 20 }],
    exit: [{ ticker: '3333', market: 'TPEx', name: '丙', nameEn: 'C', score: 90, price: 30 }],
    longTerm: [],
  },
  universe: { 'TWSE:1111': [80, 1], 'TWSE:2222': [70, 1], 'TPEx:3333': [40, 1], 'TWSE:4444': [60, 1], 'TWSE:5555': [20, 1], 'TWSE:9999': [99, 0] },
  ...overrides,
});

describe('upsertSnapshot', () => {
  const monday = snapshot('2026-W03', '2026-01-12');
  test('a later day in the same week replaces the earlier one', () => {
    const friday = snapshot('2026-W03', '2026-01-16');
    const result = upsertSnapshot([monday], friday);
    expect(result.changed).toBe(true);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].signalDate).toBe('2026-01-16');
  });
  test('a recorded day is never rewritten, and older or empty snapshots are refused', () => {
    const again = snapshot('2026-W03', '2026-01-12', { recordedAt: 'later' });
    expect(upsertSnapshot([monday], again).changed).toBe(false);
    expect(upsertSnapshot([monday], again).snapshots[0].recordedAt).toBe(monday.recordedAt);
    expect(upsertSnapshot([monday], snapshot('2026-W02', '2026-01-09')).changed).toBe(false);
    expect(upsertSnapshot([monday], snapshot('2026-W04', '2026-01-19', { lists: { entry: [], exit: [], longTerm: [] } })).changed).toBe(false);
  });
  test('a new week is appended in order', () => {
    const result = upsertSnapshot([snapshot('2026-W04', '2026-01-23'), monday], snapshot('2026-W05', '2026-01-26'));
    expect(result.snapshots.map((item) => item.week)).toEqual(['2026-W03', '2026-W04', '2026-W05']);
  });
});

describe('summarizeForward', () => {
  // Fixed forward returns per stock, the same from every signal date; only the 1-week and 1-month horizons have settled.
  const table: Record<string, [number, number]> = { 'TWSE:1111': [4, 10], 'TWSE:2222': [2, -2], 'TPEx:3333': [-6, -12], 'TWSE:4444': [1, 3], 'TWSE:5555': [-1, 1], 'TWSE:9999': [50, 50] };
  const returns = (key: string, settled: number): ForwardReturns => ({ bars: 30, toDate: table[key][1], at: FORWARD_HORIZONS.map((_, h) => (h < settled ? table[key][h] : null)) });
  const lookup = (date: string, key: string) => (table[key] ? returns(key, date === '2026-01-16' ? 2 : 1) : null);
  const index = (date: string): ForwardReturns => ({ bars: 30, toDate: 5, at: [1, date === '2026-01-16' ? 2 : null, null, null, null] });
  const snapshots = [snapshot('2026-W03', '2026-01-16'), snapshot('2026-W04', '2026-01-23'), snapshot('2026-W08', '2026-02-18'), snapshot('2025-W50', '2025-12-12', { rules: 'v0' })];
  const summary = summarizeForward(snapshots, lookup, index, '2026-02-18', 'now');

  test('counts only the current rules and marks the running week', () => {
    expect(summary.weeks).toBe(3);
    expect(summary.earlierRules).toBe(1);
    expect(summary.startedOn).toBe('2026-01-16');
    expect(summary.latestSignal).toBe('2026-02-18');
    expect(summary.log.map((week) => week.final)).toEqual([false, true, true]); // newest first
  });
  test('list average, equal-weight market of liquid stocks, excess and weeks ahead', () => {
    const week1 = summary.lists.entry[0];
    expect(week1.weeks).toBe(2); // the running week is not counted
    expect(week1.average).toBe(3); // (4 + 2) / 2
    expect(week1.market).toBe(0); // (4 + 2 - 6 + 1 - 1) / 5, illiquid 9999 excluded
    expect(week1.excess).toBe(3);
    expect(week1.weeksAhead).toBe(2);
    expect(week1.winRate).toBe(100);
    expect(week1.index).toBe(1);
    const month1 = summary.lists.entry[1];
    expect(month1.weeks).toBe(1); // only the first snapshot is a month old
    expect(month1.average).toBe(4); // (10 - 2) / 2
    expect(month1.market).toBe(0);
    expect(month1.winRate).toBe(50);
    expect(summary.lists.entry[2].weeks).toBe(0);
    expect(summary.lists.entry[2].average).toBeNull();
    expect(summary.lists.exit[0].average).toBe(-6);
    expect(summary.lists.exit[0].excess).toBe(-6);
    expect(summary.lists.exit[0].weeksAhead).toBe(0);
    expect(summary.lists.longTerm[0].weeks).toBe(0);
  });
  test('score spread compares the top and bottom fifth of liquid stocks', () => {
    // Five liquid stocks: top fifth = 1111 (score 80), bottom fifth = 5555 (score 20).
    expect(summary.score[0]).toEqual({ bars: 5, weeks: 2, top: 4, bottom: -1, spread: 5 });
  });
});

describe('buildSnapshot', () => {
  const stock = (ticker: string, overrides: Partial<Stock> = {}): Stock => ({
    ticker, market: 'TWSE', nameZh: `股${ticker}`, nameEn: `Co ${ticker}`, sectorZh: '半導體業', price: 100, open: 99, high: 101, low: 98, previousClose: 99, dayChange: 1,
    pe: 15, pb: 2, dividendYield: 3, revenueGrowth: 12, revenueMoM: 1, revenueYtd: 10, revenuePeriod: '11509', volume: 5e6, tradeValue: 5e8, transactions: 4000, dataKind: 'daily', ...overrides,
  } as Stock);
  const metric = (ticker: string, overrides: Partial<ScreenMetrics> = {}): ScreenMetrics => ({
    ticker, market: 'TWSE', last: 100, asOf: '2026-11-11', days: 240, ma20: 98, ma60: 90, rsi14: 55, ret1w: 1, ret1m: 4, ret3m: 15, ret6m: 20, ret1y: 40, ret3y: 90, ret5y: 150,
    cagr3y: 24, cagr5y: 20, volatility: 25, maxDrawdown1y: -12, fromHigh52w: -4, positiveYears: 4, monthsOfHistory: 60, ...overrides,
  });
  const stocks = [stock('1111'), stock('2222', { price: 80 }), stock('3333', { tradeValue: 2e7 })];
  const metrics = { 'TWSE:1111': metric('1111'), 'TWSE:2222': metric('2222', { last: 80, ma20: 90, ma60: 100, rsi14: 35, ret1m: -9 }), 'TWSE:3333': metric('3333') };

  test('freezes the default lists and flags the liquid universe', () => {
    const frozen = buildSnapshot(stocks, metrics, '2026-11-11', 'now');
    expect(frozen.week).toBe('2026-W46');
    expect(frozen.rules).toBe(RULES_VERSION);
    expect(frozen.lists.entry.map((pick) => pick.ticker)).toEqual(['1111']); // 2222 is in a downtrend, 3333 too thin
    expect(frozen.lists.exit.map((pick) => pick.ticker)).toEqual(['2222']);
    expect(frozen.lists.longTerm.map((pick) => pick.ticker).sort()).toEqual(['1111', '2222']);
    expect(frozen.lists.entry[0]).toMatchObject({ name: '股1111', price: 100 });
    expect(frozen.universe['TWSE:3333'][1]).toBe(0);
    expect(frozen.universe['TWSE:1111'][1]).toBe(1);
  });
  test('the signal date is the later of the exchange date and the price series date', () => {
    expect(signalDateFor('2026-11-10', metrics)).toBe('2026-11-11');
    expect(signalDateFor('2026-11-12', metrics)).toBe('2026-11-12');
  });
});

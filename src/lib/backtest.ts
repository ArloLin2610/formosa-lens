// Rule backtest for the weekly picks. For every stock and every fifth trading
// day in its history we ask "would the entry / exit rule have fired here?" and
// record what the price did over the next 1 week, 1 month and 3 months. The
// equal-weight average of every stock on the same weeks is the benchmark, so
// "excess" says whether the rule picked better than buying everything.
//
// Aggregates are tiny (per ISO week sums) so they can be accumulated chunk by
// chunk on the server and summarized at read time.

import type { ClosePoint } from './screen';

export const HORIZONS = [5, 21, 63] as const;
export type HorizonBars = (typeof HORIZONS)[number];
export type SignalKind = 'all' | 'entry' | 'exit';

/** Per-week sums: n = samples, s = sum of forward returns (%), w = wins (> 0). Index 0/1/2 = 5/21/63 bars. */
export interface WeekBucket { n: [number, number, number]; s: [number, number, number]; w: [number, number, number] }
export type BacktestAggregate = Record<string, Record<SignalKind, WeekBucket>>; // weekKey -> kind -> bucket

export const emptyBucket = (): WeekBucket => ({ n: [0, 0, 0], s: [0, 0, 0], w: [0, 0, 0] });

export const isoWeekKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/** Same conditions as rankEntries / rankExits in screen.ts, evaluated from close-only history. */
export const entryRule = (price: number, ma20: number, ma60: number, rsi: number): boolean =>
  price >= ma20 * 0.985 && ma20 >= ma60 && rsi <= 70 && price <= ma20 * 1.08;
export const exitRule = (price: number, ma20: number, ma60: number, rsi: number): boolean =>
  (price < ma20 && ma20 < ma60) || rsi > 75 || price > ma20 * 1.12;

/** Wilder RSI for every index (null until enough data). */
export function rsiSeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gain += change; else loss -= change;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Accumulate one stock's samples into `aggregate` (mutated). Returns the number of evaluation points. */
export function accumulateBacktest(aggregate: BacktestAggregate, points: ClosePoint[], { step = 5, warmup = 60 } = {}): number {
  const clean = points.filter((point) => Number.isFinite(point.c) && point.c > 0).sort((a, b) => a.t - b.t);
  if (clean.length < warmup + HORIZONS[0] + 1) return 0;
  const closes = clean.map((point) => point.c);
  const prefix = new Array<number>(closes.length + 1).fill(0);
  for (let index = 0; index < closes.length; index += 1) prefix[index + 1] = prefix[index] + closes[index];
  const mean = (end: number, length: number) => (prefix[end + 1] - prefix[end + 1 - length]) / length;
  const rsi = rsiSeries(closes);
  let evaluations = 0;

  for (let index = warmup; index + HORIZONS[0] < closes.length; index += step) {
    const price = closes[index], ma20 = mean(index, 20), ma60 = mean(index, 60), r = rsi[index];
    if (r == null) continue;
    const key = isoWeekKey(clean[index].t);
    const week = aggregate[key] ?? (aggregate[key] = { all: emptyBucket(), entry: emptyBucket(), exit: emptyBucket() });
    const kinds: SignalKind[] = ['all'];
    if (entryRule(price, ma20, ma60, r)) kinds.push('entry');
    if (exitRule(price, ma20, ma60, r)) kinds.push('exit');
    HORIZONS.forEach((bars, h) => {
      if (index + bars >= closes.length) return;
      const forward = (closes[index + bars] / price - 1) * 100;
      for (const kind of kinds) {
        const bucket = week[kind];
        bucket.n[h] += 1; bucket.s[h] += forward; if (forward > 0) bucket.w[h] += 1;
      }
    });
    evaluations += 1;
  }
  return evaluations;
}

export function mergeAggregates(target: BacktestAggregate, source: BacktestAggregate): BacktestAggregate {
  for (const [key, week] of Object.entries(source)) {
    const existing = target[key] ?? (target[key] = { all: emptyBucket(), entry: emptyBucket(), exit: emptyBucket() });
    for (const kind of ['all', 'entry', 'exit'] as const) {
      for (let h = 0; h < 3; h += 1) { existing[kind].n[h] += week[kind].n[h]; existing[kind].s[h] += week[kind].s[h]; existing[kind].w[h] += week[kind].w[h]; }
    }
  }
  return target;
}

export interface HorizonStat {
  bars: HorizonBars;
  samples: number;
  /** Average forward return of signalled stocks, percent. */
  average: number | null;
  /** Share of samples with a positive forward return, percent. */
  winRate: number | null;
  /** Equal-weight average of every stock over the same weeks, weighted by signal count. */
  benchmark: number | null;
  excess: number | null;
}

export interface BacktestSummary {
  weeks: number;
  from: string | null;
  to: string | null;
  entry: HorizonStat[];
  exit: HorizonStat[];
  byYear: Array<{ year: string; entry: { samples: number; average: number | null; excess: number | null }; exit: { samples: number; average: number | null; excess: number | null } }>;
}

const stat = (aggregate: BacktestAggregate, kind: 'entry' | 'exit', h: number, weeks: string[]): HorizonStat => {
  let n = 0, s = 0, w = 0, benchmarkWeighted = 0;
  for (const key of weeks) {
    const week = aggregate[key];
    const bucket = week[kind];
    if (!bucket.n[h]) continue;
    n += bucket.n[h]; s += bucket.s[h]; w += bucket.w[h];
    if (week.all.n[h]) benchmarkWeighted += (week.all.s[h] / week.all.n[h]) * bucket.n[h];
  }
  const average = n ? s / n : null;
  const benchmark = n ? benchmarkWeighted / n : null;
  return { bars: HORIZONS[h], samples: n, average, winRate: n ? (w / n) * 100 : null, benchmark, excess: average != null && benchmark != null ? average - benchmark : null };
};

export function summarizeBacktest(aggregate: BacktestAggregate): BacktestSummary {
  const weeks = Object.keys(aggregate).sort();
  const years = Array.from(new Set(weeks.map((key) => key.slice(0, 4)))).sort();
  return {
    weeks: weeks.length,
    from: weeks[0] ?? null,
    to: weeks[weeks.length - 1] ?? null,
    entry: HORIZONS.map((_, h) => stat(aggregate, 'entry', h, weeks)),
    exit: HORIZONS.map((_, h) => stat(aggregate, 'exit', h, weeks)),
    byYear: years.map((year) => {
      const subset = weeks.filter((key) => key.startsWith(year));
      const entry = stat(aggregate, 'entry', 1, subset), exit = stat(aggregate, 'exit', 1, subset); // 1-month horizon
      return { year, entry: { samples: entry.samples, average: entry.average, excess: entry.excess }, exit: { samples: exit.samples, average: exit.average, excess: exit.excess } };
    }),
  };
}

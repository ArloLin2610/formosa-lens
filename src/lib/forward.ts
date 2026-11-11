// Forward (out-of-sample) test of the weekly picks. Once a week the lists the
// site shows are frozen into a snapshot file; every later pipeline run measures
// what prices actually did afterwards. Unlike the backtest, nothing here can be
// tuned in hindsight: a snapshot is written once, committed to the repository,
// and only ever read again.
//
// Pure functions, unit tested. The pipeline (scripts/pipeline/build-data.ts)
// supplies the files and the price series.

import { isoWeekKey } from './backtest';
import { isLiquid, rankEntries, rankExits, rankLongTerm, type ClosePoint, type Pick, type ScreenMetrics } from './screen';
import { estimateEfficiency, scoreStock } from './scoring';
import type { Market, ScoredStock, Stock } from './types';

/**
 * Bump this whenever the pick rules (screen.ts) or the score weights
 * (scoring.ts) change. Results are reported for the current version only, so a
 * rule change restarts the clock instead of silently mixing two systems.
 */
export const RULES_VERSION = 'v1';

/** Trading bars after the signal date: 1 week, 1 month, 3 months, 6 months, 1 year. */
export const FORWARD_HORIZONS = [5, 21, 63, 126, 252] as const;

/** The lists are frozen with the site's default settings. */
export const FORWARD_SETTINGS = { lens: 'balanced', minTradeValue: 1e8, longTermHorizon: '3y', recorded: 20, evaluated: 10 } as const;

export type ListKind = 'entry' | 'exit' | 'longTerm';
export const LIST_KINDS: ListKind[] = ['entry', 'exit', 'longTerm'];

export interface SnapshotPick { ticker: string; market: Market; name: string; nameEn: string; score: number; price: number }

export interface ForwardSnapshot {
  version: 1;
  /** ISO week of the signal date, e.g. "2026-W46". One snapshot per week: the last trading day wins. */
  week: string;
  /** Last trading day whose close is in the data the lists were built from. */
  signalDate: string;
  recordedAt: string;
  rules: string;
  settings: { lens: string; minTradeValue: number; longTermHorizon: string };
  /** Ranked lists, best first (more rows are stored than the site shows). */
  lists: Record<ListKind, SnapshotPick[]>;
  /** Whole market on the signal date: "MARKET:ticker" -> [balanced score, 1 if it passed the liquidity floor]. */
  universe: Record<string, [number, 0 | 1]>;
}

const DAY = 86_400_000;
/** Calendar date in Taipei of a bar timestamp. */
export const taipeiDate = (timestamp: number): string => new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * The date the lists are "as of": the later of the exchange snapshot date and
 * the date most price series end on, so a forward return never starts before
 * data that went into the lists.
 */
export function signalDateFor(marketDate: string, metrics: Record<string, ScreenMetrics>): string {
  const counts = new Map<string, number>();
  for (const entry of Object.values(metrics)) counts.set(entry.asOf, (counts.get(entry.asOf) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? '';
  return common > marketDate ? common : marketDate;
}

export const scoreUniverse = (stocks: Stock[], lens: Parameters<typeof scoreStock>[1] = 'balanced'): ScoredStock[] => stocks.map((stock) => {
  const merged = { ...stock, ...scoreStock(stock, lens), efficiency: 0 };
  return { ...merged, efficiency: estimateEfficiency(merged) };
});

const toSnapshotPick = (pick: Pick): SnapshotPick => ({
  ticker: pick.ticker, market: pick.market, name: pick.stock.nameZh, nameEn: pick.stock.nameEn ?? '', score: pick.score, price: pick.stock.price || pick.metrics.last,
});

/** Freeze today's lists exactly as the picks page shows them by default. */
export function buildSnapshot(stocks: Stock[], metrics: Record<string, ScreenMetrics>, signalDate: string, recordedAt = new Date().toISOString()): ForwardSnapshot {
  const scored = scoreUniverse(stocks, FORWARD_SETTINGS.lens);
  const map = new Map(Object.entries(metrics));
  const options = { minTradeValue: FORWARD_SETTINGS.minTradeValue, limit: FORWARD_SETTINGS.recorded };
  const universe: ForwardSnapshot['universe'] = {};
  for (const stock of scored) universe[`${stock.market}:${stock.ticker}`] = [stock.total, isLiquid(stock, FORWARD_SETTINGS.minTradeValue) ? 1 : 0];
  return {
    version: 1,
    week: isoWeekKey(Date.parse(`${signalDate}T00:00:00Z`)),
    signalDate, recordedAt, rules: RULES_VERSION,
    settings: { lens: FORWARD_SETTINGS.lens, minTradeValue: FORWARD_SETTINGS.minTradeValue, longTermHorizon: FORWARD_SETTINGS.longTermHorizon },
    lists: {
      entry: rankEntries(scored, map, options).map(toSnapshotPick),
      exit: rankExits(scored, map, options).map(toSnapshotPick),
      longTerm: rankLongTerm(scored, map, FORWARD_SETTINGS.longTermHorizon, options).map(toSnapshotPick),
    },
    universe,
  };
}

/**
 * Merge a fresh snapshot into the stored ones. A week keeps the snapshot with
 * the latest signal date; an already stored (week, signalDate) is never
 * rewritten. Returns the list (sorted by week) and whether `fresh` was taken.
 */
export function upsertSnapshot(stored: ForwardSnapshot[], fresh: ForwardSnapshot): { snapshots: ForwardSnapshot[]; changed: boolean } {
  const existing = stored.find((snapshot) => snapshot.week === fresh.week);
  const hasContent = LIST_KINDS.some((kind) => fresh.lists[kind].length > 0);
  const newerElsewhere = stored.some((snapshot) => snapshot.signalDate >= fresh.signalDate);
  if (!hasContent || newerElsewhere || (existing && existing.signalDate >= fresh.signalDate)) return { snapshots: [...stored].sort((a, b) => a.week.localeCompare(b.week)), changed: false };
  return { snapshots: [...stored.filter((snapshot) => snapshot.week !== fresh.week), fresh].sort((a, b) => a.week.localeCompare(b.week)), changed: true };
}

/**
 * Trading days (Taipei dates, ascending) on which at least `share` of the
 * series have a bar. Individual series from the bulk price feed have gaps, so
 * horizons are counted on this shared calendar, never on one stock's own bars:
 * every stock and the benchmark are measured over exactly the same dates.
 */
export function tradingCalendar(seriesList: Iterable<ClosePoint[]>, share = 0.3): string[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const series of seriesList) {
    if (!series.length) continue;
    total += 1;
    for (const point of series) { const date = taipeiDate(point.t); counts.set(date, (counts.get(date) ?? 0) + 1); }
  }
  return [...counts.entries()].filter(([, count]) => count >= Math.max(1, total * share)).map(([date]) => date).sort();
}

/** What one price series did after a signal date. Percent returns, close to close, price only. */
export interface ForwardReturns {
  /** Trading days elapsed since the signal date. */
  bars: number;
  /** Return from the signal close to the latest close (null on the signal day itself). */
  toDate: number | null;
  /** Return at each FORWARD_HORIZONS trading-day count, null until that day exists. */
  at: Array<number | null>;
}

const endOfTaipeiDay = (date: string): number => Date.parse(`${date}T23:59:59+08:00`);
/** Last point at or before the end of `date` (points ascending). */
const pointOn = (points: ClosePoint[], date: string): ClosePoint | null => {
  const limit = endOfTaipeiDay(date);
  let low = 0, high = points.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].t <= limit) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found < 0 ? null : points[found];
};
const STALE_MS = 8 * DAY; // a close older than this is not a price for that date (suspended or delisted)

export function forwardReturns(points: ClosePoint[], signalDate: string, calendar: string[]): ForwardReturns | null {
  const base = pointOn(points, signalDate);
  // The stock must have traded close to the signal date, otherwise the "entry" price is stale.
  if (!base || !(base.c > 0) || endOfTaipeiDay(signalDate) - base.t > STALE_MS) return null;
  let start = -1;
  for (let cursor = calendar.length - 1; cursor >= 0; cursor -= 1) { if (calendar[cursor] <= signalDate) { start = cursor; break; } }
  const bars = start < 0 ? 0 : calendar.length - 1 - start;
  const changeOn = (date: string): number | null => {
    const point = pointOn(points, date);
    if (!point || endOfTaipeiDay(date) - point.t > STALE_MS) return null;
    return Math.round((point.c / base.c - 1) * 10_000) / 100;
  };
  return {
    bars,
    toDate: bars > 0 ? changeOn(calendar[calendar.length - 1]) : null,
    at: FORWARD_HORIZONS.map((horizon) => (start >= 0 && start + horizon < calendar.length ? changeOn(calendar[start + horizon]) : null)),
  };
}

type Lookup = (signalDate: string, key: string) => ForwardReturns | null | undefined;

export interface MeanReturns { toDate: number | null; at: Array<number | null> }
export interface EvaluatedPick extends SnapshotPick { toDate: number | null; at: Array<number | null> }
export interface EvaluatedWeek {
  week: string;
  signalDate: string;
  /** False while the week is still running and its snapshot may be replaced by a later day. */
  final: boolean;
  /** Trading bars elapsed since the signal date. */
  bars: number;
  lists: Record<ListKind, { picks: EvaluatedPick[]; mean: MeanReturns }>;
  /** Equal-weight average of every stock that passed the liquidity floor on the signal date. */
  market: MeanReturns;
  /** TAIEX over the same span (null when the index series was unavailable). */
  index: MeanReturns | null;
  /** Balanced score, top vs bottom fifth of the liquid universe. */
  scoreTop: MeanReturns;
  scoreBottom: MeanReturns;
}

export interface ForwardCell {
  bars: number;
  /** Final weekly snapshots old enough to have this horizon. */
  weeks: number;
  average: number | null;
  market: number | null;
  excess: number | null;
  index: number | null;
  /** Weeks in which the list average beat the market average. */
  weeksAhead: number;
  /** Share of individual picks that ended above the signal price, percent. */
  winRate: number | null;
}

export interface ForwardSummary {
  generatedAt: string;
  rules: string;
  settings: typeof FORWARD_SETTINGS;
  /** Signal date of the first snapshot under the current rules. */
  startedOn: string | null;
  latestSignal: string | null;
  /** Snapshots under the current rules (including the week in progress). */
  weeks: number;
  /** Snapshots recorded under earlier rule versions, kept in the repository but not counted. */
  earlierRules: number;
  horizons: number[];
  lists: Record<ListKind, ForwardCell[]>;
  score: Array<{ bars: number; weeks: number; top: number | null; bottom: number | null; spread: number | null }>;
  /** Newest first. */
  log: EvaluatedWeek[];
}

const round = (value: number) => Math.round(value * 100) / 100;
const meanOf = (values: Array<number | null | undefined>): number | null => {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null;
};
const meanReturns = (rows: Array<ForwardReturns | null | undefined>): MeanReturns => ({
  toDate: meanOf(rows.map((row) => row?.toDate)),
  at: FORWARD_HORIZONS.map((_, h) => meanOf(rows.map((row) => row?.at[h]))),
});

export function evaluateSnapshot(snapshot: ForwardSnapshot, lookup: Lookup, indexReturns: ForwardReturns | null, latestWeek: string): EvaluatedWeek {
  const get = (key: string) => lookup(snapshot.signalDate, key) ?? null;
  const lists = Object.fromEntries(LIST_KINDS.map((kind) => {
    const picks = snapshot.lists[kind].slice(0, FORWARD_SETTINGS.evaluated);
    const rows = picks.map((pick) => get(`${pick.market}:${pick.ticker}`));
    return [kind, {
      picks: picks.map((pick, index): EvaluatedPick => ({ ...pick, toDate: rows[index]?.toDate ?? null, at: rows[index]?.at ?? FORWARD_HORIZONS.map(() => null) })),
      mean: meanReturns(rows),
    }];
  })) as EvaluatedWeek['lists'];

  const liquid = Object.entries(snapshot.universe).filter(([, [, eligible]]) => eligible === 1).sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0]));
  const liquidRows = liquid.map(([key]) => get(key));
  const fifth = Math.max(1, Math.floor(liquid.length / 5));
  return {
    week: snapshot.week, signalDate: snapshot.signalDate, final: snapshot.week < latestWeek,
    bars: Math.max(0, indexReturns?.bars ?? 0, ...liquidRows.slice(0, 50).map((row) => row?.bars ?? 0)),
    lists,
    market: meanReturns(liquidRows),
    index: indexReturns ? { toDate: indexReturns.toDate, at: indexReturns.at } : null,
    scoreTop: meanReturns(liquidRows.slice(0, fifth)),
    scoreBottom: meanReturns(liquidRows.slice(-fifth)),
  };
}

/**
 * Evaluate every snapshot and aggregate. `lookup` returns the forward returns
 * of one stock from one signal date; `indexLookup` the same for the TAIEX.
 * `latestDate` is the newest trading day in the data.
 */
export function summarizeForward(snapshots: ForwardSnapshot[], lookup: Lookup, indexLookup: (signalDate: string) => ForwardReturns | null, latestDate: string, generatedAt = new Date().toISOString()): ForwardSummary {
  const current = snapshots.filter((snapshot) => snapshot.rules === RULES_VERSION).sort((a, b) => a.week.localeCompare(b.week));
  const latestWeek = isoWeekKey(Date.parse(`${latestDate}T00:00:00Z`));
  const weeks = current.map((snapshot) => evaluateSnapshot(snapshot, lookup, indexLookup(snapshot.signalDate), latestWeek));
  const settled = weeks.filter((week) => week.final);

  const cell = (kind: ListKind, h: number): ForwardCell => {
    const rows = settled.filter((week) => week.lists[kind].mean.at[h] != null && week.market.at[h] != null);
    const average = meanOf(rows.map((week) => week.lists[kind].mean.at[h]));
    const market = meanOf(rows.map((week) => week.market.at[h]));
    const picks = rows.flatMap((week) => week.lists[kind].picks.map((pick) => pick.at[h])).filter((value): value is number => value != null);
    return {
      bars: FORWARD_HORIZONS[h], weeks: rows.length, average, market,
      excess: average != null && market != null ? round(average - market) : null,
      index: meanOf(rows.map((week) => week.index?.at[h])),
      weeksAhead: rows.filter((week) => (week.lists[kind].mean.at[h] as number) > (week.market.at[h] as number)).length,
      winRate: picks.length ? round((picks.filter((value) => value > 0).length / picks.length) * 100) : null,
    };
  };

  return {
    generatedAt, rules: RULES_VERSION, settings: FORWARD_SETTINGS,
    startedOn: current[0]?.signalDate ?? null,
    latestSignal: current[current.length - 1]?.signalDate ?? null,
    weeks: current.length,
    earlierRules: snapshots.length - current.length,
    horizons: [...FORWARD_HORIZONS],
    lists: Object.fromEntries(LIST_KINDS.map((kind) => [kind, FORWARD_HORIZONS.map((_, h) => cell(kind, h))])) as ForwardSummary['lists'],
    score: FORWARD_HORIZONS.map((bars, h) => {
      const rows = settled.filter((week) => week.scoreTop.at[h] != null && week.scoreBottom.at[h] != null);
      const top = meanOf(rows.map((week) => week.scoreTop.at[h])), bottom = meanOf(rows.map((week) => week.scoreBottom.at[h]));
      return { bars, weeks: rows.length, top, bottom, spread: top != null && bottom != null ? round(top - bottom) : null };
    }),
    log: [...weeks].reverse(),
  };
}

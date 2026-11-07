// Per-stock series: daily history (cached per ticker with a TTL, independent
// of score changes so the chart never remounts during the session) and the
// intraday feed that merges the official latest trade into minute candles.

import { useEffect, useMemo, useState } from 'react';
import { fetchHistory, fetchIntraday } from '@/api/client';
import { mergeIntradayPoint, mergeLatestPointIntoCandles, toIntradayPoint } from '@/lib/intraday';
import { quoteRefreshInterval } from '@/lib/marketHours';
import { analyzeTiming, type TimingAnalysis } from '@/lib/timing';
import type { Candle, IntradayPoint, ScoredStock } from '@/lib/types';

const HISTORY_TTL_MS = 15 * 60_000;
const historyCache = new Map<string, { candles: Candle[]; source: string; storedAt: number }>();

export type SeriesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HistoryState { status: SeriesStatus; candles: Candle[]; source: string; error: string }

export function useHistory(ticker: string | undefined, market: 'TWSE' | 'TPEx' | undefined): HistoryState {
  const key = ticker && market ? `${market}:${ticker}` : '';
  const [state, setState] = useState<HistoryState & { key: string }>({ key: '', status: 'idle', candles: [], source: '', error: '' });

  useEffect(() => {
    if (!key) return;
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.storedAt < HISTORY_TTL_MS) {
      setState({ key, status: 'ready', candles: cached.candles, source: cached.source, error: '' });
      return;
    }
    let cancelled = false;
    setState({ key, status: 'loading', candles: cached?.candles ?? [], source: cached?.source ?? '', error: '' });
    fetchHistory(ticker as string, market as 'TWSE' | 'TPEx').then((payload) => {
      historyCache.set(key, { candles: payload.candles, source: payload.meta.source, storedAt: Date.now() });
      if (!cancelled) setState({ key, status: 'ready', candles: payload.candles, source: payload.meta.source, error: '' });
    }).catch((reason: unknown) => {
      if (!cancelled) setState({ key, status: 'error', candles: cached?.candles ?? [], source: cached?.source ?? '', error: reason instanceof Error ? reason.message : 'History unavailable' });
    });
    return () => { cancelled = true; };
  }, [key, ticker, market]);

  return state.key === key ? state : { status: key ? 'loading' : 'idle', candles: [], source: '', error: '' };
}

export function useTiming(stock: ScoredStock | undefined, history: HistoryState): TimingAnalysis | null {
  const total = stock?.total ?? 0;
  return useMemo(() => (history.status === 'ready' && stock ? analyzeTiming({ total }, history.candles) : null), [history.status, history.candles, stock, total]);
}

export type IntradayStatus = 'idle' | 'loading' | 'refreshing' | 'live' | 'stale';

export interface IntradayState {
  status: IntradayStatus;
  points: IntradayPoint[];
  candles: Candle[];
  previousClose: number | null;
  source: string;
  fetchedAt: string | null;
}

const emptyIntraday = (status: IntradayStatus): IntradayState => ({ status, points: [], candles: [], previousClose: null, source: '', fetchedAt: null });

export function useIntraday(stock: ScoredStock | undefined): IntradayState {
  const ticker = stock?.ticker ?? '';
  const market = stock?.market ?? 'TWSE';
  const key = ticker ? `${market}:${ticker}` : '';
  const [state, setState] = useState<IntradayState & { key: string }>({ key: '', ...emptyIntraday('idle') });

  // Server minute history, re-polled on the session-aware interval.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      setState((current) => (current.key === key ? { ...current, status: current.points.length ? 'refreshing' : 'loading' } : { key, ...emptyIntraday('loading') }));
      try {
        const payload = await fetchIntraday(ticker, market);
        if (cancelled) return;
        setState((current) => {
          const livePoints = current.key === key ? current.points.filter((point) => point.kind !== 'history') : [];
          let points = [...payload.points];
          let candles = [...payload.candles];
          for (const point of livePoints) { points = mergeIntradayPoint(points, point); candles = mergeLatestPointIntoCandles(candles, point, 1); }
          return { key, status: 'live', points, candles, previousClose: payload.previousClose, source: payload.meta.source, fetchedAt: payload.meta.fetchedAt };
        });
      } catch {
        if (!cancelled) setState((current) => (current.key === key ? { ...current, status: 'stale' } : { key, ...emptyIntraday('stale') }));
      }
    };
    const schedule = () => { timer = window.setTimeout(async () => { if (!document.hidden) await load(); schedule(); }, quoteRefreshInterval(Date.now(), document.hidden)); };
    void load();
    schedule();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key, ticker, market]);

  // Official latest trade from the quote feed, merged in between server refreshes.
  const latestPoint = useMemo(() => toIntradayPoint(stock), [stock]);
  useEffect(() => {
    if (!key || !latestPoint) return;
    setState((current) => {
      if (current.key !== key) return current;
      return { ...current, points: mergeIntradayPoint(current.points, latestPoint), candles: mergeLatestPointIntoCandles(current.candles, latestPoint, 1) };
    });
  }, [key, latestPoint]);

  return state.key === key ? state : emptyIntraday(key ? 'loading' : 'idle');
}

// Per-stock daily history, cached per ticker with a TTL and independent of
// score changes so the chart never remounts during the session.

import { useEffect, useMemo, useState } from 'react';
import { fetchHistory } from '@/api/client';
import { analyzeTiming, type TimingAnalysis } from '@/lib/timing';
import type { Candle, ScoredStock } from '@/lib/types';

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

// Market snapshot + live quotes with session-aware polling. The snapshot is
// refreshed every 15 minutes; quotes every 30 s while Taipei is trading,
// slower around the session, and rarely overnight or when the tab is hidden.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketSnapshot, fetchQuotes } from '@/api/client';
import { mergeSnapshotWithQuotes } from '@/lib/market';
import { quoteRefreshInterval, sessionPhase, type SessionPhase } from '@/lib/marketHours';
import type { MarketSnapshot, QuotePayload } from '@/lib/types';

const SNAPSHOT_REFRESH_MS = 15 * 60_000;

export type SnapshotStatus = 'loading' | 'live' | 'error';
export type QuoteStatus = 'idle' | 'loading' | 'live' | 'stale';

export interface MarketState {
  snapshot: MarketSnapshot | null;
  status: SnapshotStatus;
  error: string;
  quoteStatus: QuoteStatus;
  quoteMeta: QuotePayload['meta'] | null;
  phase: SessionPhase;
  reload: () => void;
}

export function useMarketData(): MarketState {
  const [base, setBase] = useState<MarketSnapshot | null>(null);
  const [quotes, setQuotes] = useState<QuotePayload | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [error, setError] = useState('');
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>('idle');
  const [phase, setPhase] = useState<SessionPhase>(() => sessionPhase());
  const hidden = useRef(typeof document !== 'undefined' && document.hidden);

  const loadSnapshot = useCallback(async () => {
    setStatus((current) => (current === 'live' ? current : 'loading'));
    try {
      const data = await fetchMarketSnapshot();
      setBase(data);
      setStatus('live');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Market data unavailable');
      setStatus((current) => (current === 'live' ? current : 'error'));
    }
  }, []);

  const loadQuotes = useCallback(async () => {
    setQuoteStatus((current) => (current === 'live' ? 'live' : 'loading'));
    try {
      const data = await fetchQuotes();
      setQuotes(data);
      setQuoteStatus('live');
    } catch {
      setQuoteStatus('stale');
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    void loadQuotes();
    const snapshotTimer = window.setInterval(loadSnapshot, SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(snapshotTimer);
  }, [loadSnapshot, loadQuotes]);

  // Quote polling re-arms itself with the interval that fits the session phase.
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const now = Date.now();
      setPhase(sessionPhase(now));
      timer = window.setTimeout(async () => {
        if (!hidden.current) await loadQuotes();
        schedule();
      }, quoteRefreshInterval(now, hidden.current));
    };
    const onVisibility = () => {
      hidden.current = document.hidden;
      if (!document.hidden) { window.clearTimeout(timer); void loadQuotes(); schedule(); }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [loadQuotes]);

  const snapshot = useMemo(() => (base ? mergeSnapshotWithQuotes(base, quotes) : null), [base, quotes]);
  const reload = useCallback(() => { void loadSnapshot(); void loadQuotes(); }, [loadSnapshot, loadQuotes]);
  return { snapshot, status, error, quoteStatus, quoteMeta: quotes?.meta ?? null, phase, reload };
}

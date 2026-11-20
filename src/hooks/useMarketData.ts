// Market snapshot. The site is static: the snapshot is the latest daily file
// published by the pipeline, re-read every 30 minutes in case the page stays
// open across an update. There is no live quote feed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchMarketSnapshot } from '@/api/client';
import { mergeSnapshotWithQuotes } from '@/lib/market';
import type { MarketSnapshot } from '@/lib/types';

const SNAPSHOT_REFRESH_MS = 30 * 60_000;

export type SnapshotStatus = 'loading' | 'live' | 'error';

export interface MarketState {
  snapshot: MarketSnapshot | null;
  status: SnapshotStatus;
  error: string;
  reload: () => void;
}

export function useMarketData(): MarketState {
  const [base, setBase] = useState<MarketSnapshot | null>(null);
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [error, setError] = useState('');

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

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(loadSnapshot, SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadSnapshot]);

  // Normalizes every row to closing data (the same path the quote feed used to go through).
  const snapshot = useMemo(() => (base ? mergeSnapshotWithQuotes(base, null) : null), [base]);
  const reload = useCallback(() => { void loadSnapshot(); }, [loadSnapshot]);
  return { snapshot, status, error, reload };
}

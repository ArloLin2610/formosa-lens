import type { Config } from '@netlify/functions';
import { strFromU8, unzipSync } from 'fflate';
import { FALLBACK_SIGNAL_HISTORY, parseNdcSignalCsv } from '../../src/lib/ndc';
import type { SignalPayload, SignalRecord } from '../../src/lib/types';
import { BROWSER_HEADERS, MemoryCache, json } from './_shared/http';

/** GET /api/ndc-signal — the monthly business-cycle signal from the NDC open-data archive. */
const DATASET_URL = 'https://data.gov.tw/dataset/6099';
const ZIP_URL = 'https://ws.ndc.gov.tw/Download.ashx?icon=.zip&n=5pmv5rCj5oyH5qiZ5Y%2BK54eI6JmfLnppcA%3D%3D&u=LzAwMS9hZG1pbmlzdHJhdG9yLzEwL3JlbGZpbGUvNTc4MS82MzkyL2VhMjM1YmQ5LWQwNTItNGE2OS1hYmZjLWQ1Yzc4NWQzZDBlMi56aXA%3D';
const cache = new MemoryCache<SignalRecord[]>(6 * 3_600_000, 1);

const payload = (history: SignalRecord[], status: 'live' | 'fallback'): SignalPayload => ({
  history,
  latest: history[history.length - 1],
  meta: { source: 'National Development Council open data', sourceUrl: DATASET_URL, status, fetchedAt: new Date().toISOString() },
});

export default async function handler(): Promise<Response> {
  const cached = cache.get('history');
  if (cached) return json(payload(cached, 'live'), { maxAge: 21_600, swr: 86_400 });
  try {
    const response = await fetch(ZIP_URL, { headers: { ...BROWSER_HEADERS, accept: 'application/zip, application/octet-stream, */*' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`NDC open data returned ${response.status}`);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const history = Object.values(files).map((file) => parseNdcSignalCsv(strFromU8(file), 13)).find((records) => records.length > 0);
    if (!history?.length) throw new Error('Signal CSV not found in archive');
    cache.set('history', history);
    return json(payload(history, 'live'), { maxAge: 21_600, swr: 86_400 });
  } catch (error) {
    console.warn(`[ndc-signal] falling back: ${error instanceof Error ? error.message : error}`);
    return json(payload(cache.stale('history') ?? FALLBACK_SIGNAL_HISTORY, 'fallback'), { maxAge: 300, swr: 300 });
  }
}

export const config: Config = { path: '/api/ndc-signal' };

import type { Config } from '@netlify/functions';
import { errorResponse, json } from './_shared/http';
import { getMarketSnapshot } from './_shared/snapshot';

/**
 * GET /api/market — the combined TWSE + TPEx dataset from the stored copy.
 * GET /api/market?refresh=TWSE|TPEx|all — rebuild that market from the exchange
 * first (used by the data pipeline when its own network cannot reach TPEx; at
 * most once per ten minutes per market, so it cannot be abused into load).
 */
export default async function handler(request: Request): Promise<Response> {
  try {
    const wanted = new URL(request.url).searchParams.get('refresh');
    const refresh = wanted === 'all' ? true : wanted === 'TWSE' || wanted === 'TPEx' ? [wanted as 'TWSE' | 'TPEx'] : false;
    const snapshot = await getMarketSnapshot({ refresh });
    return json(snapshot, refresh ? { maxAge: 0 } : { maxAge: 600, swr: 900 });
  } catch (error) {
    return errorResponse(error, 'Market data unavailable');
  }
}

export const config: Config = { path: '/api/market' };

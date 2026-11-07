import type { Config } from '@netlify/functions';
import { errorResponse, json } from './_shared/http';
import { getMarketSnapshot } from './_shared/snapshot';

/** GET /api/market — the combined TWSE + TPEx dataset, built and cached on the server. */
export default async function handler(): Promise<Response> {
  try {
    const snapshot = await getMarketSnapshot();
    return json(snapshot, { maxAge: 600, swr: 900 });
  } catch (error) {
    return errorResponse(error, 'Market data unavailable');
  }
}

export const config: Config = { path: '/api/market' };

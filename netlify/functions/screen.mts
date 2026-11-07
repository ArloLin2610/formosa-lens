import type { Config } from '@netlify/functions';
import { errorResponse, json } from './_shared/http';
import { advanceScreen, getScreenPayload } from './_shared/screen-store';

/**
 * GET /api/screen — market-wide metrics for the weekly picks.
 * GET /api/screen?advance=1 — process one chunk now (used by local development,
 * where the scheduled function never fires; harmless in production).
 */
export default async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('advance') === '1') await advanceScreen(Number(url.searchParams.get('batches')) || 20);
    return json(await getScreenPayload(), { maxAge: url.searchParams.get('advance') === '1' ? 0 : 1800, swr: 3600 });
  } catch (error) {
    return errorResponse(error, 'Market screen unavailable');
  }
}

export const config: Config = { path: '/api/screen' };

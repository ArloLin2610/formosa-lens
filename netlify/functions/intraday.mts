import type { Config } from '@netlify/functions';
import { parseYahooChart } from '../../src/lib/intraday';
import type { IntradayPayload } from '../../src/lib/types';
import { MemoryCache, TICKER, asMarket, errorResponse, fetchJson, json } from './_shared/http';

/** GET /api/intraday?ticker=2330&market=TWSE — today's one-minute bars (Yahoo Finance). */
const YAHOO_CHART = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const cache = new MemoryCache<IntradayPayload>(20_000, 300);

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker') ?? '';
  const market = asMarket(url.searchParams.get('market'));
  if (!TICKER.test(ticker)) return json({ error: 'ticker must be a four-digit code' }, { status: 400 });
  const symbol = `${ticker}.${market === 'TPEx' ? 'TWO' : 'TW'}`;
  const cached = cache.get(symbol);
  if (cached) return json(cached, { maxAge: 20, swr: 40 });

  const upstream = new URL(`${YAHOO_CHART}${symbol}`);
  upstream.search = new URLSearchParams({ interval: '1m', range: '1d', includePrePost: 'false', events: 'history' }).toString();
  try {
    const parsed = parseYahooChart(await fetchJson(upstream, { headers: { referer: 'https://finance.yahoo.com/' }, timeoutMs: 15_000 }));
    const payload: IntradayPayload = { ...parsed, meta: { source: `Yahoo Finance (${symbol}, 1m)`, fetchedAt: new Date().toISOString(), symbol } };
    if (parsed.candles.length) cache.set(symbol, payload);
    return json(payload, { maxAge: 20, swr: 40 });
  } catch (error) {
    return errorResponse(error, 'Intraday history unavailable');
  }
}

export const config: Config = { path: '/api/intraday' };

import type { Config } from '@netlify/functions';
import type { Market, Quote, QuotePayload } from '../../src/lib/types';
import { MemoryCache, errorResponse, fetchJson, json, mapWithConcurrency } from './_shared/http';
import { getQuoteUniverse } from './_shared/snapshot';

/**
 * GET /api/quotes — latest trades for every listed share from the TWSE
 * market information system (covers TPEx too). The ticker list comes from the
 * cached market snapshot, so this never re-downloads the daily files.
 */
const QUOTE_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const BATCH_SIZE = 150;
const cache = new MemoryCache<QuotePayload>(15_000, 1);

interface MisRow { c?: string; z?: string; y?: string; o?: string; h?: string; l?: string; v?: string; d?: string; t?: string; tlong?: string; ex?: string }

const number = (value?: string): number | null => {
  if (!value || value === '-') return null;
  const parsed = Number(value.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

async function fetchBatch(codes: Array<{ ticker: string; market: Market }>): Promise<Quote[]> {
  const url = new URL(QUOTE_URL);
  url.searchParams.set('ex_ch', codes.map(({ ticker, market }) => `${market === 'TPEx' ? 'otc' : 'tse'}_${ticker}.tw`).join('|'));
  url.searchParams.set('json', '1');
  url.searchParams.set('delay', '0');
  const payload = await fetchJson<{ msgArray?: MisRow[] }>(url, { headers: { referer: 'https://mis.twse.com.tw/stock/index.jsp' }, timeoutMs: 8_000 });
  const marketOf = new Map(codes.map(({ ticker, market }) => [ticker, market]));
  return (payload.msgArray ?? []).map((row): Quote | null => {
    const ticker = String(row.c ?? '');
    if (!/^\d{4}$/.test(ticker)) return null;
    const price = number(row.z);
    const previousClose = number(row.y);
    return {
      ticker,
      market: marketOf.get(ticker) ?? (row.ex === 'otc' ? 'TPEx' : 'TWSE'),
      price, previousClose,
      open: number(row.o), high: number(row.h), low: number(row.l),
      // MIS reports accumulated volume in lots (張); the daily files use shares.
      volume: number(row.v) == null ? null : (number(row.v) as number) * 1000,
      date: row.d ?? '', time: row.t ?? '', timestamp: number(row.tlong),
      dayChange: price != null && previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    };
  }).filter((quote): quote is Quote => quote !== null);
}

export default async function handler(request: Request): Promise<Response> {
  const cached = cache.get('quotes');
  if (cached) return json(cached, { maxAge: 15, swr: 15 });
  try {
    const universe = await getQuoteUniverse(new URL(request.url).origin);
    const batches = Array.from({ length: Math.ceil(universe.length / BATCH_SIZE) }, (_, index) => universe.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));
    const results = await mapWithConcurrency(batches, 6, fetchBatch);
    const quotes = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    const failures = results.filter((result) => result.status === 'rejected');
    if (!quotes.length) {
      const reason = failures[0] && failures[0].status === 'rejected' ? failures[0].reason : null;
      throw reason instanceof Error ? reason : new Error('Live quote service returned no data');
    }
    const latest = quotes.reduce((max, quote) => Math.max(max, quote.timestamp ?? 0), 0);
    const payload: QuotePayload = {
      quotes,
      meta: {
        source: failures.length ? `TWSE MIS (partial: ${failures.length}/${batches.length} batches failed)` : 'TWSE MIS',
        fetchedAt: new Date().toISOString(),
        quoteTimestamp: latest ? new Date(latest).toISOString() : null,
      },
    };
    cache.set('quotes', payload);
    return json(payload, { maxAge: 15, swr: 15 });
  } catch (error) {
    return errorResponse(error, 'Live quotes unavailable');
  }
}

export const config: Config = { path: '/api/quotes' };

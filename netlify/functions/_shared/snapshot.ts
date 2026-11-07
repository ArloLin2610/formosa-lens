// Builds the combined TWSE + TPEx market snapshot once on the server and
// caches it: in memory while the function instance is warm, and in Netlify
// Blobs so other instances and cold starts reuse the same build. Each market
// degrades independently to the last good copy, then to the bundled fallback.

import { buildTpexStocks, buildTwseStocks, datasetDate, datasetRevenuePeriod } from '../../../src/lib/market';
import type { Market, MarketSnapshot, Stock } from '../../../src/lib/types';
import fallbackMarket from './fallback-market.json';
import { MemoryCache, fetchJson } from './http';

type Row = Record<string, unknown>;
interface MarketDataset { market: Market; stocks: Stock[]; marketDate: string; revenuePeriod: string; fetchedAt: string }

const FRESH_MS = 24 * 3_600_000; // stored copies are refreshed by the scheduler, not by visitors
const BLOB_STORE = 'formosa-lens';
const BLOB_KEY = 'market-datasets-v2';

const ENDPOINTS = {
  TWSE: {
    base: 'https://openapi.twse.com.tw/v1/',
    daily: 'exchangeReport/STOCK_DAY_ALL', valuations: 'exchangeReport/BWIBBU_ALL', revenue: 'opendata/t187ap05_L', companies: 'opendata/t187ap03_L',
    headers: { referer: 'https://openapi.twse.com.tw/' },
  },
  TPEx: {
    base: 'https://www.tpex.org.tw/openapi/v1/',
    daily: 'tpex_mainboard_daily_close_quotes', valuations: 'tpex_mainboard_peratio_analysis', revenue: 'mopsfin_t187ap05_O', companies: 'mopsfin_t187ap03_O',
    headers: { referer: 'https://www.tpex.org.tw/openapi/' },
  },
} as const;

const memory = new MemoryCache<MarketDataset>(FRESH_MS, 4);
let inflight: Promise<Record<Market, MarketDataset>> | null = null;

async function fetchDataset(market: Market): Promise<MarketDataset> {
  const config = ENDPOINTS[market];
  const load = (path: string) => fetchJson<Row[]>(config.base + path, { headers: config.headers, timeoutMs: 25_000 });
  const [daily, valuations, revenue, companies] = await Promise.all([load(config.daily), load(config.valuations), load(config.revenue), load(config.companies)]);
  const stocks = market === 'TWSE' ? buildTwseStocks({ daily, valuations, revenue, companies }) : buildTpexStocks({ daily, valuations, revenue, companies });
  if (stocks.length < 100) throw new Error(`${market} dataset looked incomplete (${stocks.length} rows)`);
  return { market, stocks, marketDate: datasetDate(daily), revenuePeriod: datasetRevenuePeriod(revenue), fetchedAt: new Date().toISOString() };
}

async function blobStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: BLOB_STORE, consistency: 'strong' });
  } catch {
    return null; // Not running on Netlify (plain `vite` dev or unit tests).
  }
}

async function readBlob(): Promise<Partial<Record<Market, MarketDataset>>> {
  const store = await blobStore();
  if (!store) return {};
  try { return ((await store.get(BLOB_KEY, { type: 'json' })) as Partial<Record<Market, MarketDataset>> | null) ?? {}; } catch { return {}; }
}

async function writeBlob(datasets: Partial<Record<Market, MarketDataset>>): Promise<void> {
  const store = await blobStore();
  if (!store) return;
  try { await store.setJSON(BLOB_KEY, datasets); } catch { /* best effort */ }
}

interface FallbackFile { generatedAt: string; TWSE: { stocks: Stock[]; marketDate: string; revenuePeriod: string }; TPEx: { stocks: Stock[]; marketDate: string; revenuePeriod: string } }
const fallbackFile = fallbackMarket as unknown as FallbackFile;

const fallbackDataset = (market: Market): MarketDataset => {
  const bundled = fallbackFile[market];
  return { market, stocks: bundled.stocks, marketDate: bundled.marketDate, revenuePeriod: bundled.revenuePeriod, fetchedAt: fallbackFile.generatedAt };
};

async function loadDatasets(refresh: boolean): Promise<Record<Market, MarketDataset>> {
  const markets: Market[] = ['TWSE', 'TPEx'];
  const fromMemory = Object.fromEntries(markets.map((market) => [market, refresh ? undefined : memory.stale(market)])) as Partial<Record<Market, MarketDataset>>;
  if (markets.every((market) => fromMemory[market])) return fromMemory as Record<Market, MarketDataset>;

  const fromBlob = await readBlob();
  const result: Partial<Record<Market, MarketDataset>> = {};
  let changed = false;
  await Promise.all(markets.map(async (market) => {
    // User-facing requests serve whatever copy exists (the scheduled warmer keeps it
    // current); only the warmer itself, or a first deploy with nothing stored, goes upstream.
    const cached = refresh ? undefined : fromMemory[market] ?? fromBlob[market];
    if (cached) { result[market] = memory.set(market, cached, 24 * 3_600_000); return; }
    try {
      result[market] = memory.set(market, await fetchDataset(market));
      changed = true;
    } catch (error) {
      console.warn(`[market-snapshot] ${market} live fetch failed: ${error instanceof Error ? error.message : error}`);
      // Degrade: last copy this instance saw, then the last copy any instance stored, then the bundled file.
      const last = memory.stale(market) ?? fromBlob[market] ?? fallbackDataset(market);
      result[market] = memory.set(market, last, 60_000); // retry live again in a minute
    }
  }));
  if (changed) void writeBlob(result);
  return result as Record<Market, MarketDataset>;
}

export async function getDatasets({ refresh = false } = {}): Promise<Record<Market, MarketDataset>> {
  if (!inflight) inflight = loadDatasets(refresh).finally(() => { inflight = null; });
  return inflight;
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const datasets = await getDatasets();
  const list = [datasets.TWSE, datasets.TPEx];
  const stale = list.filter((dataset) => Date.now() - Date.parse(dataset.fetchedAt) > 24 * 3_600_000).map((dataset) => dataset.market);
  return {
    stocks: list.flatMap((dataset) => dataset.stocks),
    meta: {
      markets: list.map((dataset) => dataset.market),
      partial: false,
      marketDate: list.map((dataset) => dataset.marketDate).filter(Boolean).sort().at(-1) ?? '',
      revenuePeriod: list.map((dataset) => dataset.revenuePeriod).filter(Boolean).sort().at(-1) ?? '',
      fetchedAt: list.map((dataset) => dataset.fetchedAt).sort().at(-1) ?? new Date().toISOString(),
      stale,
      source: 'TWSE OpenAPI + TPEx OpenAPI',
    },
  };
}

let universeCache: { list: Array<{ ticker: string; market: Market }>; at: number } | null = null;

/**
 * Ticker list for the live quote service. Reads the site's own static
 * /data/market.json (published daily by the pipeline) so the quote function
 * never has to rebuild the snapshot; falls back to the stored datasets.
 */
export async function getQuoteUniverse(siteUrl?: string): Promise<Array<{ ticker: string; market: Market }>> {
  if (universeCache && Date.now() - universeCache.at < 6 * 3_600_000) return universeCache.list;
  const base = siteUrl ?? process.env.URL ?? process.env.DEPLOY_PRIME_URL;
  if (base) {
    try {
      const response = await fetch(new URL('/data/market.json', base), { signal: AbortSignal.timeout(8_000) });
      if (response.ok) {
        const payload = (await response.json()) as MarketSnapshot;
        if (payload.stocks?.length > 100) {
          universeCache = { list: payload.stocks.map(({ ticker, market }) => ({ ticker, market })), at: Date.now() };
          return universeCache.list;
        }
      }
    } catch { /* fall back to stored datasets */ }
  }
  const datasets = await getDatasets();
  universeCache = { list: [...datasets.TWSE.stocks, ...datasets.TPEx.stocks].map(({ ticker, market }) => ({ ticker, market })), at: Date.now() };
  return universeCache.list;
}

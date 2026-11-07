import type { Config } from '@netlify/functions';
import { toNumber } from '../../src/lib/market';
import { parseYahooChart } from '../../src/lib/intraday';
import { MemoryCache, errorResponse, fetchJson, json } from './_shared/http';

/**
 * GET /api/market-pulse — the market backdrop: live TAIEX and TPEx index
 * quotes (TWSE MIS), six months of TAIEX closes (Yahoo ^TWII), the latest
 * institutional investor flows for both markets, and TWSE turnover.
 */
export interface IndexQuote { code: string; name: string; value: number | null; previousClose: number | null; open: number | null; high: number | null; low: number | null; change: number | null; date: string; time: string }
export interface Flow { investor: 'foreign' | 'trust' | 'dealer' | 'total'; net: number }
export interface MarketPulse {
  indices: IndexQuote[];
  taiexHistory: Array<{ date: string; close: number }>;
  flows: { date: string; twse: Flow[]; tpex: Flow[] };
  turnover: { date: string; tradeValue: number | null; transactions: number | null; taiex: number | null; change: number | null } | null;
  meta: { fetchedAt: string; sources: string[] };
}

const cache = new MemoryCache<Partial<MarketPulse>>(5 * 60_000, 4);
const MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|otc_o00.tw&json=1&delay=0';
const YAHOO_TAIEX = 'https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=6mo';
const TWSE_FLOWS = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U';
const TPEX_FLOWS = 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary';
const TWSE_TOTALS = 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK';

const number = (value?: string) => toNumber(value);

async function fetchIndices(): Promise<IndexQuote[]> {
  const cached = cache.get('indices');
  if (cached?.indices) return cached.indices;
  const payload = await fetchJson<{ msgArray?: Array<Record<string, string>> }>(MIS_URL, { headers: { referer: 'https://mis.twse.com.tw/stock/index.jsp' }, timeoutMs: 8_000 });
  const indices = (payload.msgArray ?? []).map((row): IndexQuote => {
    const value = number(row.z), previousClose = number(row.y);
    return { code: row.c, name: row.n, value, previousClose, open: number(row.o), high: number(row.h), low: number(row.l),
      change: value != null && previousClose ? ((value - previousClose) / previousClose) * 100 : null, date: row.d ?? '', time: row.t ?? '' };
  });
  cache.set('indices', { indices }, 30_000);
  return indices;
}

async function fetchTaiexHistory(): Promise<MarketPulse['taiexHistory']> {
  const cached = cache.get('taiex');
  if (cached?.taiexHistory) return cached.taiexHistory;
  const parsed = parseYahooChart(await fetchJson(YAHOO_TAIEX, { headers: { referer: 'https://finance.yahoo.com/' }, timeoutMs: 12_000 }));
  const history = parsed.candles.map((candle) => ({ date: new Date((candle.timestamp as number) + 8 * 3_600_000).toISOString().slice(0, 10), close: candle.close }));
  cache.set('taiex', { taiexHistory: history }, 15 * 60_000);
  return history;
}

const taipeiDate = (offsetDays: number) => {
  const date = new Date(Date.now() + 8 * 3_600_000 - offsetDays * 86_400_000);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
};

async function fetchFlows(): Promise<MarketPulse['flows']> {
  const cached = cache.get('flows');
  if (cached?.flows) return cached.flows;
  let twse: Flow[] = [], date = '';
  for (let back = 0; back < 7 && !twse.length; back += 1) {
    const day = taipeiDate(back);
    try {
      const payload = await fetchJson<{ stat?: string; date?: string; data?: string[][] }>(`${TWSE_FLOWS}?response=json&dayDate=${day}&type=day`, { headers: { referer: 'https://www.twse.com.tw/' }, timeoutMs: 8_000 });
      if (payload.stat !== 'OK' || !payload.data?.length) continue;
      date = payload.date ?? day;
      const dealers = payload.data.filter((row) => row[0].startsWith('自營商')).reduce((sum, row) => sum + (number(row[3]) ?? 0), 0);
      const foreign = payload.data.filter((row) => row[0].startsWith('外資')).reduce((sum, row) => sum + (number(row[3]) ?? 0), 0);
      const trust = number(payload.data.find((row) => row[0] === '投信')?.[3]) ?? 0;
      const total = number(payload.data.find((row) => row[0] === '合計')?.[3]) ?? foreign + trust + dealers;
      twse = [{ investor: 'foreign', net: foreign }, { investor: 'trust', net: trust }, { investor: 'dealer', net: dealers }, { investor: 'total', net: total }];
    } catch { /* try the previous day */ }
  }
  let tpex: Flow[] = [];
  try {
    const rows = await fetchJson<Array<{ Date: string; Investor: string; Net: string }>>(TPEX_FLOWS, { headers: { referer: 'https://www.tpex.org.tw/openapi/' }, timeoutMs: 8_000 });
    const pick = (test: (label: string) => boolean) => number(rows.find((row) => test(row.Investor.trim()))?.Net) ?? 0;
    tpex = [
      { investor: 'foreign', net: pick((label) => label === '外資及陸資合計') },
      { investor: 'trust', net: pick((label) => label === '投信') },
      { investor: 'dealer', net: pick((label) => label === '自營商合計') },
      { investor: 'total', net: pick((label) => label.startsWith('三大法人合計')) },
    ];
    if (!date && rows[0]?.Date) date = String(Number(rows[0].Date.slice(0, 3)) + 1911) + rows[0].Date.slice(3);
  } catch { /* TPEx flows optional */ }
  const flows = { date, twse, tpex };
  if (twse.length || tpex.length) cache.set('flows', { flows }, 30 * 60_000);
  return flows;
}

async function fetchTurnover(): Promise<MarketPulse['turnover']> {
  const cached = cache.get('turnover');
  if (cached && 'turnover' in cached) return cached.turnover ?? null;
  try {
    const rows = await fetchJson<Array<Record<string, string>>>(TWSE_TOTALS, { headers: { referer: 'https://openapi.twse.com.tw/' }, timeoutMs: 10_000 });
    const last = rows[rows.length - 1];
    const turnover = last ? { date: last.Date, tradeValue: number(last.TradeValue), transactions: number(last.Transaction), taiex: number(last.TAIEX), change: number(last.Change) } : null;
    cache.set('turnover', { turnover }, 30 * 60_000);
    return turnover;
  } catch { return null; }
}

export default async function handler(): Promise<Response> {
  try {
    const [indices, taiexHistory, flows, turnover] = await Promise.all([
      fetchIndices().catch(() => [] as IndexQuote[]), fetchTaiexHistory().catch(() => []), fetchFlows().catch(() => ({ date: '', twse: [], tpex: [] })), fetchTurnover(),
    ]);
    const payload: MarketPulse = { indices, taiexHistory, flows, turnover, meta: { fetchedAt: new Date().toISOString(), sources: ['TWSE MIS', 'Yahoo Finance ^TWII', 'TWSE BFI82U', 'TPEx 3insti', 'TWSE FMTQIK'] } };
    return json(payload, { maxAge: 60, swr: 120 });
  } catch (error) {
    return errorResponse(error, 'Market pulse unavailable');
  }
}

export const config: Config = { path: '/api/market-pulse' };

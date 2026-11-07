// Builders that turn the raw TWSE / TPEx open-data rows into Stock records,
// plus the merge of live quotes into a snapshot. Pure functions, unit tested.

import type { Market, MarketSnapshot, Quote, QuotePayload, Stock } from './types';

type Row = Record<string, unknown>;

const LISTED_TICKER = /^\d{4}$/;

export const toNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const normalized = String(value).replaceAll(',', '').replace(/^\+/, '').trim();
  if (!normalized || normalized === '--' || normalized === '---' || normalized === 'N/A' || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const sane = (value: number | null, min: number, max: number): number | null => (value == null || value < min || value > max ? null : value);

const text = (value: unknown, fallback = ''): string => {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '－' ? normalized : fallback;
};

const pick = (row: Row | undefined, names: string[]): unknown =>
  names.map((name) => row?.[name]).find((value) => value !== undefined && value !== null);

const percentChange = (price: number, change: number | null): { previousClose: number | null; dayChange: number } => {
  if (change == null) return { previousClose: null, dayChange: 0 };
  const previousClose = price - change;
  if (previousClose <= 0) return { previousClose: null, dayChange: 0 };
  return { previousClose, dayChange: (change / previousClose) * 100 };
};

export interface RawMarketDataset {
  daily?: Row[];
  valuations?: Row[];
  revenue?: Row[];
  companies?: Row[];
}

function buildStocks(market: Market, keys: {
  code: string[]; name: string[]; close: string[]; change: string[]; open: string[]; high: string[]; low: string[];
  volume: string[]; value: string[]; transactions: string[];
  valuationCode: string[]; pe: string[]; pb: string[]; dividendYield: string[];
  companyCode: string[]; englishName: string[]; abbreviation: string[];
}, { daily = [], valuations = [], revenue = [], companies = [] }: RawMarketDataset): Stock[] {
  const valuationMap = new Map(valuations.map((row) => [text(pick(row, keys.valuationCode)), row]));
  const revenueMap = new Map(revenue.map((row) => [text(pick(row, ['公司代號'])), row]));
  const companyMap = new Map(companies.map((row) => [text(pick(row, keys.companyCode)), row]));
  const stocks: Stock[] = [];

  for (const row of daily) {
    const ticker = text(pick(row, keys.code));
    const close = toNumber(pick(row, keys.close));
    // Four-digit codes that appear in the company registry are ordinary
    // shares; warrants, ETFs, and TDRs are excluded on purpose.
    if (!LISTED_TICKER.test(ticker) || close == null || close <= 0 || !companyMap.has(ticker)) continue;
    const valuation = valuationMap.get(ticker);
    const revenueRow = revenueMap.get(ticker);
    const company = companyMap.get(ticker);
    const change = toNumber(pick(row, keys.change));
    const { previousClose, dayChange } = percentChange(close, change);
    const pe = toNumber(pick(valuation, keys.pe));

    stocks.push({
      ticker,
      market,
      nameZh: text(pick(row, keys.name), text(pick(company, keys.abbreviation), ticker)),
      nameEn: text(pick(company, keys.englishName)),
      sectorZh: text(pick(revenueRow, ['產業別']), market === 'TWSE' ? '上市公司' : '上櫃公司'),
      price: close,
      open: toNumber(pick(row, keys.open)),
      high: toNumber(pick(row, keys.high)),
      low: toNumber(pick(row, keys.low)),
      previousClose,
      dayChange,
      pe: pe != null && pe > 0 ? pe : null,
      pb: toNumber(pick(valuation, keys.pb)),
      dividendYield: sane(toNumber(pick(valuation, keys.dividendYield)), 0, 20), // >20% is a data artefact (capital returns, errors)
      revenueGrowth: toNumber(pick(revenueRow, ['營業收入-去年同月增減(%)'])),
      revenueMoM: toNumber(pick(revenueRow, ['營業收入-上月比較增減(%)'])),
      revenueYtd: toNumber(pick(revenueRow, ['累計營業收入-前期比較增減(%)'])),
      revenuePeriod: text(pick(revenueRow, ['資料年月'])),
      volume: toNumber(pick(row, keys.volume)),
      tradeValue: toNumber(pick(row, keys.value)),
      transactions: toNumber(pick(row, keys.transactions)),
      dataKind: 'daily',
    });
  }
  return stocks;
}

export const buildTwseStocks = (dataset: RawMarketDataset): Stock[] => buildStocks('TWSE', {
  code: ['Code', '證券代號'], name: ['Name', '證券名稱'], close: ['ClosingPrice', '收盤價'], change: ['Change', '漲跌價差'],
  open: ['OpeningPrice', '開盤價'], high: ['HighestPrice', '最高價'], low: ['LowestPrice', '最低價'],
  volume: ['TradeVolume', '成交股數'], value: ['TradeValue', '成交金額'], transactions: ['Transaction', '成交筆數'],
  valuationCode: ['Code', '證券代號'], pe: ['PEratio', '本益比'], pb: ['PBratio', '股價淨值比'], dividendYield: ['DividendYield', '殖利率(%)'],
  companyCode: ['公司代號'], englishName: ['英文簡稱'], abbreviation: ['公司簡稱'],
}, dataset);

export const buildTpexStocks = (dataset: RawMarketDataset): Stock[] => buildStocks('TPEx', {
  code: ['SecuritiesCompanyCode', '證券代號'], name: ['CompanyName', '證券名稱'], close: ['Close', '收盤價'], change: ['Change', '漲跌'],
  open: ['Open', '開盤價'], high: ['High', '最高價'], low: ['Low', '最低價'],
  volume: ['TradingShares', '成交股數'], value: ['TransactionAmount', '成交金額'], transactions: ['TransactionNumber', '成交筆數'],
  valuationCode: ['SecuritiesCompanyCode'], pe: ['PriceEarningRatio'], pb: ['PriceBookRatio'], dividendYield: ['YieldRatio'],
  companyCode: ['SecuritiesCompanyCode', '公司代號'], englishName: ['Symbol', 'EnglishAbbreviation'], abbreviation: ['CompanyAbbreviation', '公司簡稱'],
}, dataset);

export const datasetDate = (daily: Row[] = []): string => text(pick(daily[0], ['Date', '日期']));
export const datasetRevenuePeriod = (revenue: Row[] = []): string => text(pick(revenue[0], ['資料年月']));

/** Merge official latest trades into a snapshot. Pre-open quotes without a trade keep the previous close. */
export function applyQuotes(stocks: Stock[], payload: QuotePayload | null | undefined): Stock[] {
  if (!payload?.quotes?.length) return stocks;
  const quotes = new Map<string, Quote>(payload.quotes.map((quote) => [`${quote.market}:${quote.ticker}`, quote]));
  return stocks.map((stock) => {
    const quote = quotes.get(`${stock.market}:${stock.ticker}`);
    if (!quote) return stock;
    const previousClose = quote.previousClose ?? stock.previousClose;
    if (quote.price == null) {
      if (previousClose == null) return stock;
      return { ...stock, price: previousClose, previousClose, dayChange: 0, open: null, high: null, low: null,
        quoteDate: quote.date, quoteTime: quote.time, quoteTimestamp: quote.timestamp, dataKind: 'close' };
    }
    const dayChange = quote.dayChange ?? (previousClose ? ((quote.price - previousClose) / previousClose) * 100 : stock.dayChange);
    return { ...stock, price: quote.price, previousClose, dayChange,
      open: quote.open ?? stock.open, high: quote.high ?? stock.high, low: quote.low ?? stock.low,
      volume: quote.volume ?? stock.volume, quoteDate: quote.date, quoteTime: quote.time,
      quoteTimestamp: quote.timestamp, dataKind: 'latest' };
  });
}

export function mergeSnapshotWithQuotes(snapshot: MarketSnapshot, payload: QuotePayload | null | undefined): MarketSnapshot {
  const stocks = applyQuotes(snapshot.stocks, payload);
  const live = stocks.some((stock) => stock.dataKind === 'latest');
  return {
    stocks,
    meta: { ...snapshot.meta, source: live ? `${snapshot.meta.source} + TWSE MIS` : snapshot.meta.source },
  };
}

/** ROC "1151030" -> "2026-10-30"; passes through ISO dates unchanged. */
export function rocToIso(value: string): string {
  const compact = /^(\d{3})(\d{2})(\d{2})$/.exec(value);
  if (compact) return `${Number(compact[1]) + 1911}-${compact[2]}-${compact[3]}`;
  const slashed = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (slashed) return `${Number(slashed[1]) + 1911}-${slashed[2].padStart(2, '0')}-${slashed[3].padStart(2, '0')}`;
  return value;
}

/** ROC year-month "11509" -> "2026/09". */
export function rocMonthLabel(value: string): string {
  const match = /^(\d{3})(\d{2})$/.exec(value);
  return match ? `${Number(match[1]) + 1911}/${match[2]}` : value;
}

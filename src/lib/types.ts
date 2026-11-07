// Shared data model for Formosa Lens. The same types are used by the Netlify
// Functions (server) and the React app (client), so keep this file free of
// browser- or Node-only imports.

export type Market = 'TWSE' | 'TPEx';
export type Lang = 'zh' | 'en';
export type Lens = 'balanced' | 'value' | 'growth' | 'trading' | 'pe' | 'yield';
export type DataKind = 'daily' | 'latest' | 'close' | 'demo';

/** One listed company as assembled from the official open data feeds. */
export interface Stock {
  ticker: string;
  market: Market;
  nameZh: string;
  nameEn: string;
  sectorZh: string;
  /** Latest price: daily close, or the latest trade when live quotes are merged. */
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  /** Percent change versus the previous close. */
  dayChange: number;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  revenueGrowth: number | null;
  /** Month-over-month revenue change in percent. */
  revenueMoM: number | null;
  /** Cumulative year-to-date revenue change in percent. */
  revenueYtd: number | null;
  /** ROC year-month of the revenue record, e.g. "11509". */
  revenuePeriod: string;
  volume: number | null;
  tradeValue: number | null;
  transactions: number | null;
  dataKind: DataKind;
  quoteDate?: string;
  quoteTime?: string;
  quoteTimestamp?: number | null;
}

export interface MarketMeta {
  markets: Market[];
  partial: boolean;
  /** ROC date of the daily file, e.g. "1151030". */
  marketDate: string;
  revenuePeriod: string;
  fetchedAt: string;
  /** True when one market came from the bundled fallback dataset. */
  stale: Market[];
  source: string;
}

export interface MarketSnapshot {
  stocks: Stock[];
  meta: MarketMeta;
}

export interface Quote {
  ticker: string;
  market: Market;
  price: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  date: string;
  time: string;
  timestamp: number | null;
  dayChange: number | null;
}

export interface QuotePayload {
  quotes: Quote[];
  meta: { source: string; fetchedAt: string; quoteTimestamp: string | null };
}

export interface Candle {
  /** ISO date (daily) or ISO date-time (intraday). */
  date: string;
  timestamp?: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface IntradayPoint {
  timestamp: number;
  price: number;
  dayChange: number;
  kind: 'history' | 'trade' | 'close';
  volume?: number;
}

export interface IntradayPayload {
  candles: Candle[];
  points: IntradayPoint[];
  previousClose: number | null;
  meta: { source: string; fetchedAt: string; symbol: string };
}

export type SignalKey = 'blue' | 'yellowBlue' | 'green' | 'yellowRed' | 'red';

export interface SignalRecord {
  month: string; // "2026/09"
  score: number;
  signalKey: SignalKey;
  signalZh: string;
}

export interface SignalPayload {
  history: SignalRecord[];
  latest: SignalRecord;
  meta: { source: string; sourceUrl: string; status: 'live' | 'fallback'; fetchedAt: string };
}

export interface ScoreBreakdown {
  total: number;
  value: number;
  growth: number;
  momentum: number;
  quality: number;
  yieldScore: number;
}

export type ScoredStock = Stock & ScoreBreakdown & { efficiency: number };

export interface ScreenPayload {
  /** Metrics keyed by "MARKET:ticker". */
  entries: Record<string, import('./screen').ScreenMetrics>;
  /** Rule backtest over the last completed pass (null until one pass has finished). */
  backtest: import('./backtest').BacktestSummary | null;
  /** True when the backtest shown is from the pass still in progress. */
  backtestPartial: boolean;
  meta: {
    updatedAt: string | null;
    /** Date of the latest completed full pass over the market, if any. */
    completedAt: string | null;
    covered: number;
    universe: number;
    cursor: number;
    source: string;
  };
}

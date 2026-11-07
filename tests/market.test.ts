import { describe, expect, test } from 'vitest';
import { applyQuotes, buildTpexStocks, buildTwseStocks, rocMonthLabel, rocToIso, toNumber } from '@/lib/market';
import type { Stock } from '@/lib/types';

const baseStock: Stock = {
  ticker: '2330', market: 'TWSE', nameZh: '台積電', nameEn: 'TSMC', sectorZh: '半導體業', price: 1000, open: 990, high: 1005, low: 985,
  previousClose: 990, dayChange: 1.01, pe: 20, pb: 5, dividendYield: 1.2, revenueGrowth: 30, revenueMoM: 2, revenueYtd: 35,
  revenuePeriod: '11509', volume: 10_000, tradeValue: 1e10, transactions: 20_000, dataKind: 'daily',
};

describe('toNumber', () => {
  test('parses official string formats', () => {
    expect(toNumber('1,234.50')).toBe(1234.5);
    expect(toNumber('+0.05')).toBe(0.05);
    expect(toNumber('-0.31 ')).toBe(-0.31);
    expect(toNumber('')).toBeNull();
    expect(toNumber('--')).toBeNull();
    expect(toNumber('N/A')).toBeNull();
  });
});

describe('buildTwseStocks', () => {
  test('keeps four-digit ordinary shares with company records and derives the day change', () => {
    const stocks = buildTwseStocks({
      daily: [
        { Code: '2330', Name: '台積電', ClosingPrice: '1,030.00', Change: '30.0000', OpeningPrice: '1,000.00', HighestPrice: '1,035.00', LowestPrice: '995.00', TradeVolume: '25,000,000', TradeValue: '25,000,000,000', Transaction: '40,000' },
        { Code: '0050', Name: '元大台灣50', ClosingPrice: '200', Change: '1' },
        { Code: '00400A', Name: '主動ETF', ClosingPrice: '13.80', Change: '-0.56' },
      ],
      valuations: [{ Code: '2330', PEratio: '25.5', DividendYield: '1.20', PBratio: '7.1' }],
      revenue: [{ 公司代號: '2330', 產業別: '半導體業', '營業收入-去年同月增減(%)': '31.2', '營業收入-上月比較增減(%)': '2.5', '累計營業收入-前期比較增減(%)': '36.1', 資料年月: '11509' }],
      companies: [{ 公司代號: '2330', 公司簡稱: '台積電', 英文簡稱: 'TSMC' }],
    });
    expect(stocks).toHaveLength(1);
    expect(stocks[0]).toMatchObject({ ticker: '2330', market: 'TWSE', nameEn: 'TSMC', sectorZh: '半導體業', price: 1030, previousClose: 1000, pe: 25.5, pb: 7.1, dividendYield: 1.2, revenueGrowth: 31.2, revenueYtd: 36.1, revenuePeriod: '11509', high: 1035, transactions: 40_000 });
    expect(stocks[0].dayChange).toBeCloseTo(3, 5);
  });
  test('treats a blank P/E as unavailable rather than zero', () => {
    const [stock] = buildTwseStocks({
      daily: [{ Code: '1101', Name: '台泥', ClosingPrice: '30', Change: '0' }],
      valuations: [{ Code: '1101', PEratio: '', DividendYield: '2.82', PBratio: '0.92' }],
      companies: [{ 公司代號: '1101', 公司簡稱: '台泥' }],
    });
    expect(stock.pe).toBeNull();
    expect(stock.pb).toBe(0.92);
    expect(stock.dayChange).toBe(0);
  });
});

describe('buildTpexStocks', () => {
  test('includes 5483 and excludes warrants', () => {
    const stocks = buildTpexStocks({
      daily: [
        { SecuritiesCompanyCode: '5483', CompanyName: '中美晶', Close: '204.00', Change: '+0.50', Open: '201.00', High: '205', Low: '200', TradingShares: '15863180', TransactionAmount: '3200000000', TransactionNumber: '9000' },
        { SecuritiesCompanyCode: '700830', CompanyName: '中美晶元大5A購01', Close: '2.49', Change: '0.10', Open: '2.40' },
      ],
      valuations: [{ SecuritiesCompanyCode: '5483', PriceEarningRatio: '18.50', YieldRatio: '3.1', PriceBookRatio: '2.4' }],
      revenue: [{ 公司代號: '5483', 產業別: '半導體業', '營業收入-去年同月增減(%)': '27.72', 資料年月: '11509' }],
      companies: [{ SecuritiesCompanyCode: '5483', CompanyAbbreviation: '中美晶', Symbol: 'SAS' }],
    });
    expect(stocks).toHaveLength(1);
    expect(stocks[0]).toMatchObject({ ticker: '5483', market: 'TPEx', nameEn: 'SAS', sectorZh: '半導體業', revenueGrowth: 27.72, dividendYield: 3.1 });
    expect(stocks[0].dayChange).toBeCloseTo(0.2457, 3);
  });
});

describe('applyQuotes', () => {
  const meta = { source: 'test', fetchedAt: '', quoteTimestamp: null };
  test('latest trade replaces the daily close and recalculates the change', () => {
    const [updated] = applyQuotes([baseStock], { meta, quotes: [{ ticker: '2330', market: 'TWSE', price: 1030, previousClose: 1000, open: 1001, high: 1031, low: 999, volume: 25, date: '20260811', time: '10:15:30', timestamp: 1, dayChange: 3 }] });
    expect(updated).toMatchObject({ price: 1030, dayChange: 3, previousClose: 1000, dataKind: 'latest', quoteTime: '10:15:30', volume: 25, high: 1031 });
  });
  test('pre-open quote without a trade shows the previous close with zero change', () => {
    const [updated] = applyQuotes([baseStock], { meta, quotes: [{ ticker: '2330', market: 'TWSE', price: null, previousClose: 1000, open: null, high: null, low: null, volume: null, date: '20260812', time: '07:50:00', timestamp: 2, dayChange: null }] });
    expect(updated).toMatchObject({ price: 1000, dayChange: 0, dataKind: 'close' });
  });
  test('quotes are matched per market so 1240 on TWSE and TPEx stay separate', () => {
    const tpex: Stock = { ...baseStock, ticker: '1240', market: 'TPEx' };
    const twse: Stock = { ...baseStock, ticker: '1240', market: 'TWSE', price: 50 };
    const [a, b] = applyQuotes([tpex, twse], { meta, quotes: [{ ticker: '1240', market: 'TPEx', price: 57, previousClose: 56, open: null, high: null, low: null, volume: null, date: '', time: '09:00:00', timestamp: 3, dayChange: null }] });
    expect(a.price).toBe(57);
    expect(a.dayChange).toBeCloseTo(1.7857, 3);
    expect(b.price).toBe(50);
  });
});

test('ROC date helpers', () => {
  expect(rocToIso('1151030')).toBe('2026-10-30');
  expect(rocToIso('115/10/30')).toBe('2026-10-30');
  expect(rocToIso('2026-10-30')).toBe('2026-10-30');
  expect(rocMonthLabel('11509')).toBe('2026/09');
});

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, SearchX, Star } from 'lucide-react';
import type { Copy } from '@/i18n/copy';
import { compact, num, pct, twd } from '@/lib/format';
import { signalLabel } from '@/lib/scoring';
import type { Lang, ScoredStock } from '@/lib/types';

type SortKey = 'total' | 'efficiency' | 'price' | 'dayChange' | 'revenueGrowth' | 'pe' | 'dividendYield' | 'tradeValue';

interface Props {
  rows: ScoredStock[];
  lang: Lang;
  t: Copy;
  selectedTicker: string | undefined;
  watchlist: string[];
  pageSize: number;
  onPageSize: (size: number) => void;
  onSelect: (ticker: string) => void;
  onToggleWatch: (ticker: string) => void;
}

export function RankingTable({ rows, lang, t, selectedTicker, watchlist, pageSize, onPageSize, onSelect, onToggleWatch }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'total', direction: 'desc' });
  const [page, setPage] = useState(1);
  const watched = useMemo(() => new Set(watchlist), [watchlist]);

  const sorted = useMemo(() => {
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = a[sort.key], right = b[sort.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1; // missing values sink regardless of direction
      if (right == null) return -1;
      return (left - right) * sign || a.ticker.localeCompare(b.ticker);
    });
  }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { setPage(1); }, [rows, sort, pageSize]);
  const current = Math.min(page, pages);
  const slice = sorted.slice((current - 1) * pageSize, current * pageSize);

  const changeSort = (key: SortKey) => setSort((state) => (state.key === key ? { key, direction: state.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'pe' ? 'asc' : 'desc' }));
  const Head = ({ name, children, right = true, optional = false }: { name: SortKey; children: React.ReactNode; right?: boolean; optional?: boolean }) => (
    <th className={`${right ? 'right' : ''} ${optional ? 'col-optional' : ''}`}>
      <button type="button" className={sort.key === name ? 'sorted' : ''} onClick={() => changeSort(name)} aria-sort={sort.key === name ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {children}{sort.key === name ? (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
      </button>
    </th>
  );

  const pageNumbers = useMemo(() => {
    const set = new Set<number>([1, pages, current - 1, current, current + 1]);
    return [...set].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  }, [current, pages]);

  return (
    <>
      <div className="table-wrap">
        <table className="ranking">
          <thead>
            <tr>
              <th aria-label={t.table.add} />
              <th>{t.table.rank}</th>
              <th>{t.table.ticker}</th>
              <th className="col-optional">{t.table.sector}</th>
              <Head name="total" right={false}>{t.table.score}</Head>
              <Head name="efficiency" optional>{t.table.efficiency}</Head>
              <Head name="price">{t.table.price}</Head>
              <Head name="dayChange">{t.table.change}</Head>
              <Head name="revenueGrowth">{t.table.revenue}</Head>
              <Head name="pe">{t.table.pe}</Head>
              <Head name="dividendYield" optional>{t.table.dividendYield}</Head>
              <Head name="tradeValue" optional>{t.table.turnover}</Head>
              <th>{t.table.view}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((stock, index) => {
              const label = signalLabel(stock.total);
              const isWatched = watched.has(stock.ticker);
              const tone = stock.dayChange > 0 ? 'gain' : stock.dayChange < 0 ? 'loss' : 'flat';
              return (
                <tr key={`${stock.market}:${stock.ticker}`} className={selectedTicker === stock.ticker ? 'selected' : ''} onClick={() => onSelect(stock.ticker)} tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter') onSelect(stock.ticker); }}>
                  <td><button type="button" className={`star ${isWatched ? 'active' : ''}`} aria-pressed={isWatched} aria-label={isWatched ? t.table.remove : t.table.add} onClick={(event) => { event.stopPropagation(); onToggleWatch(stock.ticker); }}><Star size={15} fill={isWatched ? 'currentColor' : 'none'} /></button></td>
                  <td className="rank-no num">{(current - 1) * pageSize + index + 1}</td>
                  <td><div className="company"><b>{stock.ticker}<span className={`tag ${stock.market === 'TPEx' ? 'tpex' : ''}`}>{stock.market === 'TPEx' ? t.filters.tpex : t.filters.twse}</span></b><span>{lang === 'zh' ? stock.nameZh : stock.nameEn || stock.nameZh}</span></div></td>
                  <td className="col-optional"><span className="sector" title={stock.sectorZh}>{stock.sectorZh}</span></td>
                  <td><div className="score-cell"><b className="num">{stock.total}</b><span className="bar"><i style={{ width: `${stock.total}%` }} /></span></div></td>
                  <td className="right num col-optional" title={t.table.quick}>{stock.efficiency}</td>
                  <td className="right"><div className="price-cell num"><b>{twd(stock.price)}</b><small>{stock.dataKind === 'latest' ? t.table.latest : t.table.close}{stock.quoteTime ? ` ${stock.quoteTime.slice(0, 5)}` : ''}</small></div></td>
                  <td className={`right num ${tone}`}>{pct(stock.dayChange)}</td>
                  <td className={`right num ${stock.revenueGrowth == null ? 'flat' : stock.revenueGrowth >= 0 ? 'gain' : 'loss'}`}>{pct(stock.revenueGrowth, 1)}</td>
                  <td className="right num">{num(stock.pe, 1)}</td>
                  <td className="right num col-optional">{stock.dividendYield == null ? '—' : `${num(stock.dividendYield, 2)}%`}</td>
                  <td className="right num col-optional">{compact(stock.tradeValue)}</td>
                  <td><span className={`pill ${label}`}>{t.labels[label]}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sorted.length ? <div className="empty"><SearchX size={22} /><span>{t.table.empty}</span></div> : null}
      </div>
      <div className="pagination">
        <span>{t.table.page(current, pages)}｜{t.filters.results(num(sorted.length, 0))}</span>
        <div className="pagination-controls">
          <label className="toolbar-count">{t.table.perPage}
            <select className="select" style={{ height: 30, marginLeft: 6 }} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select>
          </label>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label={t.table.prev}><ChevronLeft size={14} /></button>
          {pageNumbers.map((value, index) => (
            <span key={value} style={{ display: 'contents' }}>
              {index > 0 && value - pageNumbers[index - 1] > 1 ? <span>…</span> : null}
              <button type="button" className={value === current ? 'active' : ''} onClick={() => setPage(value)} aria-current={value === current ? 'page' : undefined}>{value}</button>
            </span>
          ))}
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label={t.table.next}><ChevronRight size={14} /></button>
        </div>
      </div>
    </>
  );
}

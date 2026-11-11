import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Star } from 'lucide-react';
import type { Copy } from '@/i18n/copy';
import { num, pct, taipeiDateTime, twd } from '@/lib/format';
import { rankEntries, rankExits, rankLongTerm, type Horizon, type Pick, type ScreenMetrics } from '@/lib/screen';
import type { Lang, ScoredStock, ScreenPayload } from '@/lib/types';
import type { BacktestSummary, HorizonStat } from '@/lib/backtest';
import type { ForwardSummary } from '@/lib/forward';
import { ForwardCard } from './ForwardCard';

interface Props {
  stocks: ScoredStock[];
  screen: ScreenPayload | null;
  track: ForwardSummary | null;
  status: 'loading' | 'ready' | 'error';
  lang: Lang;
  t: Copy;
  watchlist: string[];
  onSelect: (ticker: string) => void;
  onToggleWatch: (ticker: string) => void;
}

const LIQUIDITY: Record<'low' | 'mid' | 'high', number> = { low: 3e7, mid: 1e8, high: 5e8 };

const tone = (value: number | null | undefined) => (value == null ? 'flat' : value > 0 ? 'gain' : value < 0 ? 'loss' : 'flat');
const distance = (m: ScreenMetrics, price: number) => (m.ma20 ? (price / m.ma20 - 1) * 100 : null);

function BacktestCard({ summary, partial, t }: { summary: BacktestSummary | null; partial: boolean; t: Copy }) {
  const tb = t.backtest;
  const tone = (value: number | null) => (value == null ? '' : value > 0 ? 'gain' : value < 0 ? 'loss' : '');
  const cell = (stat: HorizonStat) => (
    <td key={stat.bars} className="right">
      <div className="bt-cell">
        <b className={tone(stat.average)}>{pct(stat.average, 2)}</b>
        <span>{tb.win} <i className="num">{stat.winRate == null ? '—' : `${num(stat.winRate, 0)}%`}</i></span>
        <span>{tb.benchmark} <i className="num">{pct(stat.benchmark, 2)}</i></span>
        <span>{tb.excess} <i className={`num ${tone(stat.excess)}`}>{pct(stat.excess, 2)}</i></span>
        <span className="muted">n = {num(stat.samples, 0)}</span>
      </div>
    </td>
  );
  return (
    <div className="section backtest">
      <div className="section-head"><div><h3>{tb.title}</h3><small>{tb.subtitle}</small></div>
        {summary ? <small className="num">{tb.weeks(summary.weeks, summary.from ?? '', summary.to ?? '')}{partial ? `｜${tb.partial}` : ''}</small> : null}</div>
      {summary ? (
        <>
          <div className="table-wrap">
            <table className="ranking bt-table num">
              <thead><tr><th>{tb.signal}</th>{summary.entry.map((stat) => <th key={stat.bars} className="right">{tb.horizon[stat.bars]}</th>)}</tr></thead>
              <tbody>
                <tr><td><span className="chip entry">{tb.entry}</span></td>{summary.entry.map(cell)}</tr>
                <tr><td><span className="chip exit">{tb.exit}</span></td>{summary.exit.map(cell)}</tr>
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="ranking bt-years num">
              <thead><tr><th>{tb.year}</th><th className="right">{tb.entry}</th><th className="right">{tb.excess}</th><th className="right">{tb.exit}</th><th className="right">{tb.excess}</th></tr></thead>
              <tbody>{summary.byYear.map((row) => (
                <tr key={row.year}><td>{row.year}</td>
                  <td className={`right ${tone(row.entry.average)}`}>{pct(row.entry.average, 2)} <small className="muted">n={num(row.entry.samples, 0)}</small></td><td className={`right ${tone(row.entry.excess)}`}>{pct(row.entry.excess, 2)}</td>
                  <td className={`right ${tone(row.exit.average)}`}>{pct(row.exit.average, 2)} <small className="muted">n={num(row.exit.samples, 0)}</small></td><td className={`right ${tone(row.exit.excess)}`}>{pct(row.exit.excess, 2)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="fineprint">{tb.reading}</p>
        </>
      ) : <p className="toolbar-count">{tb.none}</p>}
    </div>
  );
}

export function PicksPanel({ stocks, screen, track, status, lang, t, watchlist, onSelect, onToggleWatch }: Props) {
  const tp = t.picks;
  const [liquidity, setLiquidity] = useState<'low' | 'mid' | 'high'>('mid');
  const [horizon, setHorizon] = useState<Horizon>('3y');
  const metrics = useMemo(() => new Map<string, ScreenMetrics>(Object.entries(screen?.entries ?? {})), [screen]);
  const options = useMemo(() => ({ minTradeValue: LIQUIDITY[liquidity], limit: 10 }), [liquidity]);
  const entries = useMemo(() => rankEntries(stocks, metrics, options), [stocks, metrics, options]);
  const exits = useMemo(() => rankExits(stocks, metrics, options), [stocks, metrics, options]);
  const longTerm = useMemo(() => rankLongTerm(stocks, metrics, horizon, options), [stocks, metrics, horizon, options]);
  const watched = useMemo(() => new Set(watchlist), [watchlist]);

  const Company = ({ pick }: { pick: Pick }) => (
    <td>
      <div className="company">
        <b>{pick.ticker}<span className={`tag ${pick.market === 'TPEx' ? 'tpex' : ''}`}>{pick.market === 'TPEx' ? t.filters.tpex : t.filters.twse}</span></b>
        <span>{lang === 'zh' ? pick.stock.nameZh : pick.stock.nameEn || pick.stock.nameZh}</span>
      </div>
    </td>
  );
  const StarCell = ({ pick }: { pick: Pick }) => {
    const isWatched = watched.has(pick.ticker);
    return <td><button type="button" className={`star ${isWatched ? 'active' : ''}`} aria-pressed={isWatched} aria-label={isWatched ? t.table.remove : t.table.add} onClick={(event) => { event.stopPropagation(); onToggleWatch(pick.ticker); }}><Star size={15} fill={isWatched ? 'currentColor' : 'none'} /></button></td>;
  };
  const Reasons = ({ pick }: { pick: Pick }) => <td><div className="chip-row">{pick.reasons.map((reason) => <span key={reason} className={`chip ${pick.kind}`}>{tp.reason[reason]}</span>)}</div></td>;
  const row = (pick: Pick, children: React.ReactNode) => (
    <tr key={`${pick.market}:${pick.ticker}`} onClick={() => onSelect(pick.ticker)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(pick.ticker); }}>{children}</tr>
  );
  const Empty = () => <div className="empty-small">{tp.empty}</div>;

  const coverageLine = screen?.meta ? (
    screen.meta.covered < screen.meta.universe && !screen.meta.completedAt
      ? tp.scanning(screen.meta.covered, screen.meta.universe)
      : tp.updated(taipeiDateTime(screen.meta.updatedAt, lang))
  ) : '';

  return (
    <section className="panel picks" aria-label={tp.title}>
      <div className="toolbar">
        <div><h2 style={{ fontSize: 16, fontWeight: 600 }}>{tp.title}</h2><p className="toolbar-count" style={{ maxWidth: '72ch' }}>{tp.intro}</p></div>
        <span className="toolbar-spacer" />
        <label className="toolbar-count">{tp.liquidity}
          <select className="select" style={{ marginLeft: 6 }} value={liquidity} onChange={(event) => setLiquidity(event.target.value as 'low' | 'mid' | 'high')}>
            {(['low', 'mid', 'high'] as const).map((key) => <option key={key} value={key}>{tp.liquidityOptions[key]}</option>)}
          </select>
        </label>
      </div>
      {status === 'loading' && !screen ? <div className="section"><div className="loading-row"><Loader2 size={15} />{tp.loading}</div></div> : null}
      {status === 'error' && !screen ? <div className="section"><div className="fineprint"><AlertTriangle size={14} />{tp.unavailable}</div></div> : null}
      {screen ? (
        <>
          <div className="section" style={{ paddingTop: 10, paddingBottom: 10 }}><span className="toolbar-count num">{coverageLine}</span></div>
          <BacktestCard summary={screen.backtest} partial={screen.backtestPartial} t={t} />
          <ForwardCard track={track} backtest={screen.backtest} lang={lang} t={t} onSelect={onSelect} />

          <div className="section">
            <div className="section-head"><div><h3>{tp.entries}</h3><small>{tp.entriesHint}</small></div></div>
            <div className="table-wrap">{entries.length ? (
              <table className="ranking picks-table num">
                <thead><tr><th /><th>#</th><th>{t.table.ticker}</th><th className="right">{tp.score}</th><th className="right">{t.table.price}</th><th className="right">{tp.ma20Distance}</th><th className="right">{tp.rsi}</th><th className="right">{tp.ret1m}</th><th className="right">{tp.ret3m}</th><th className="right">{tp.ret1y}</th><th className="right">{t.table.score}</th><th>{tp.reasons}</th></tr></thead>
                <tbody>{entries.map((pick, index) => row(pick, <>
                  <StarCell pick={pick} /><td className="rank-no">{index + 1}</td><Company pick={pick} />
                  <td className="right"><b>{pick.score}</b></td><td className="right">{twd(pick.stock.price)}</td>
                  <td className={`right ${tone(distance(pick.metrics, pick.stock.price))}`}>{pct(distance(pick.metrics, pick.stock.price), 1)}</td>
                  <td className="right">{num(pick.metrics.rsi14, 0)}</td>
                  <td className={`right ${tone(pick.metrics.ret1m)}`}>{pct(pick.metrics.ret1m, 1)}</td>
                  <td className={`right ${tone(pick.metrics.ret3m)}`}>{pct(pick.metrics.ret3m, 1)}</td>
                  <td className={`right ${tone(pick.metrics.ret1y)}`}>{pct(pick.metrics.ret1y, 1)}</td>
                  <td className="right">{pick.stock.total}</td><Reasons pick={pick} />
                </>))}</tbody>
              </table>) : <Empty />}</div>
          </div>

          <div className="section">
            <div className="section-head"><div><h3>{tp.exits}</h3><small>{tp.exitsHint}</small></div></div>
            <div className="table-wrap">{exits.length ? (
              <table className="ranking picks-table num">
                <thead><tr><th /><th>#</th><th>{t.table.ticker}</th><th className="right">{tp.score}</th><th className="right">{t.table.price}</th><th className="right">{tp.ma20Distance}</th><th className="right">{tp.rsi}</th><th className="right">{tp.ret1w}</th><th className="right">{tp.ret1m}</th><th className="right">{tp.fromHigh}</th><th className="right">{tp.drawdown}</th><th>{tp.reasons}</th></tr></thead>
                <tbody>{exits.map((pick, index) => row(pick, <>
                  <StarCell pick={pick} /><td className="rank-no">{index + 1}</td><Company pick={pick} />
                  <td className="right"><b>{pick.score}</b></td><td className="right">{twd(pick.stock.price)}</td>
                  <td className={`right ${tone(distance(pick.metrics, pick.stock.price))}`}>{pct(distance(pick.metrics, pick.stock.price), 1)}</td>
                  <td className="right">{num(pick.metrics.rsi14, 0)}</td>
                  <td className={`right ${tone(pick.metrics.ret1w)}`}>{pct(pick.metrics.ret1w, 1)}</td>
                  <td className={`right ${tone(pick.metrics.ret1m)}`}>{pct(pick.metrics.ret1m, 1)}</td>
                  <td className="right loss">{pct(pick.metrics.fromHigh52w, 1)}</td>
                  <td className="right loss">{pct(pick.metrics.maxDrawdown1y, 1)}</td><Reasons pick={pick} />
                </>))}</tbody>
              </table>) : <Empty />}</div>
          </div>

          <div className="section">
            <div className="section-head">
              <div><h3>{tp.longTerm}</h3><small>{tp.longTermHint}</small></div>
              <div className="segmented" role="tablist">{(['1y', '3y', '5y'] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={horizon === key} className={horizon === key ? 'active' : ''} onClick={() => setHorizon(key)}>{tp.horizon[key]}</button>)}</div>
            </div>
            <div className="table-wrap">{longTerm.length ? (
              <table className="ranking picks-table num">
                <thead><tr><th /><th>#</th><th>{t.table.ticker}</th><th className="right">{tp.score}</th><th className="right">{tp.ret1y}</th><th className="right">{tp.cagr3y}</th><th className="right">{tp.cagr5y}</th><th className="right">{t.table.price}</th><th className="right">{tp.drawdown}</th><th className="right">{t.table.dividendYield}</th><th className="right">{t.table.pe}</th><th>{tp.reasons}</th></tr></thead>
                <tbody>{longTerm.map((pick, index) => row(pick, <>
                  <StarCell pick={pick} /><td className="rank-no">{index + 1}</td><Company pick={pick} />
                  <td className="right"><b>{num(pick.score, 0)}</b></td>
                  <td className={`right ${tone(pick.metrics.ret1y)} ${horizon === '1y' ? 'emph' : ''}`}>{pct(pick.metrics.ret1y, 1)}</td>
                  <td className={`right ${tone(pick.metrics.cagr3y)} ${horizon === '3y' ? 'emph' : ''}`}>{pct(pick.metrics.cagr3y, 1)}</td>
                  <td className={`right ${tone(pick.metrics.cagr5y)} ${horizon === '5y' ? 'emph' : ''}`}>{pct(pick.metrics.cagr5y, 1)}</td>
                  <td className="right">{twd(pick.stock.price)}</td>
                  <td className="right loss">{pct(pick.metrics.maxDrawdown1y, 1)}</td>
                  <td className="right">{pick.stock.dividendYield == null ? '—' : `${num(pick.stock.dividendYield, 2)}%`}</td>
                  <td className="right">{num(pick.stock.pe, 1)}</td><Reasons pick={pick} />
                </>))}</tbody>
              </table>) : <Empty />}</div>
          </div>
        </>
      ) : null}
    </section>
  );
}

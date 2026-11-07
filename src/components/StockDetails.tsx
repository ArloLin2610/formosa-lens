import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, ShieldCheck, Star } from 'lucide-react';
import type { Copy } from '@/i18n/copy';
import type { HistoryState, IntradayState } from '@/hooks/useStockSeries';
import { compact, lots, num, pct, taipeiTime, twd } from '@/lib/format';
import { bucketIntradayPoints } from '@/lib/intraday';
import { rocMonthLabel } from '@/lib/market';
import { signalLabel } from '@/lib/scoring';
import type { TimingAnalysis } from '@/lib/timing';
import type { Lang, ScoredStock } from '@/lib/types';
import { TechnicalChart } from './TechnicalChart';

interface Props {
  stock: ScoredStock | undefined;
  lang: Lang;
  t: Copy;
  history: HistoryState;
  timing: TimingAnalysis | null;
  intraday: IntradayState;
  isWatched: boolean;
  onToggleWatch: () => void;
}

function TimingPanel({ timing, history, t }: { timing: TimingAnalysis | null; history: HistoryState; t: Copy }) {
  const tt = t.timing;
  if (history.status === 'loading' && !timing) return <section className="section"><div className="loading-row"><Loader2 size={15} />{tt.loading}</div></section>;
  if (history.status === 'error' && !timing) return <section className="section"><div className="fineprint"><AlertTriangle size={14} />{tt.unavailable}</div></section>;
  if (!timing) return <section className="section"><div className="fineprint"><AlertTriangle size={14} />{tt.insufficient}</div></section>;
  const a = timing;
  const closes = a.points.map((point) => point.close);
  const W = 900, H = 170, pad = 12, lo = Math.min(...closes, a.stop), hi = Math.max(...closes, a.target);
  const x = (index: number) => pad + (index / Math.max(closes.length - 1, 1)) * (W - pad * 2 - 60);
  const y = (value: number) => H - pad - ((value - lo) / (hi - lo || 1)) * (H - pad * 2);
  return (
    <section className="section" aria-label={tt.title}>
      <div className="section-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><h3>{tt.title}</h3><span className={`signal ${a.signal}`}>{tt.signal[a.signal]}</span></div>
        <small>{tt.efficiency} <b className="num" style={{ color: 'var(--ink)', fontSize: 15 }}>{a.efficiency}</b>/100</small>
      </div>
      <svg className="timing-chart num" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${tt.entry} ${twd(a.entryLow)}–${twd(a.entryHigh)}, ${tt.stop} ${twd(a.stop)}, ${tt.target} ${twd(a.target)}`}>
        <rect className="zone" x={pad} y={y(a.entryHigh)} width={W - pad * 2 - 60} height={Math.max(2, y(a.entryLow) - y(a.entryHigh))} />
        <line className="target-line" x1={pad} x2={W - pad - 60} y1={y(a.target)} y2={y(a.target)} />
        <line className="stop-line" x1={pad} x2={W - pad - 60} y1={y(a.stop)} y2={y(a.stop)} />
        <polyline points={closes.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
        <circle cx={x(closes.length - 1)} cy={y(closes.at(-1) as number)} r={3.5} />
        <text x={W - pad - 54} y={y(a.target) + 3.5}>{twd(a.target)}</text>
        <text x={W - pad - 54} y={y(a.stop) + 3.5}>{twd(a.stop)}</text>
        <text x={W - pad - 54} y={y(closes.at(-1) as number) + 3.5} style={{ fill: 'var(--accent)', fontWeight: 500 }}>{twd(closes.at(-1))}</text>
      </svg>
      <div className="timing-grid num">
        <div className="level entry"><span>{tt.entry}</span><b>{twd(a.entryLow)} – {twd(a.entryHigh)}</b></div>
        <div className="level stop"><span>{tt.stop}</span><b>{twd(a.stop)}</b></div>
        <div className="level target"><span>{tt.target}</span><b>{twd(a.target)}</b></div>
        <div className="level"><span>{tt.ratio}</span><b>{a.riskReward == null ? '—' : `${num(a.riskReward, 2)} : 1`}</b></div>
      </div>
      <div className="metrics num">
        <div><span>{tt.rsi}</span><b>{num(a.rsi14, 1)}</b></div>
        <div><span>{tt.averages}</span><b>{num(a.ma20, 1)} / {num(a.ma60, 1)}</b></div>
        <div><span>{tt.momentum}</span><b className={a.momentum60 >= 0 ? 'gain' : 'loss'}>{pct(a.momentum60, 1)}</b></div>
        <div><span>{tt.volatility}</span><b>{a.volatility == null ? '—' : `${num(a.volatility, 1)}%`}</b></div>
        <div><span>{tt.dataDays}</span><b>{a.dataDays}</b></div>
        <div><span>{tt.confidence}</span><b>{tt.confidenceValue[a.confidence]}</b></div>
      </div>
      <ul className="reasons">{a.reasons.map((reason) => <li key={reason}>{tt.reasons[reason]}</li>)}</ul>
      <p className="fineprint"><ShieldCheck size={14} />{tt.note}</p>
    </section>
  );
}

function IntradayPanel({ intraday, lang, t }: { intraday: IntradayState; lang: Lang; t: Copy }) {
  const [interval, setInterval] = useState(1);
  const ti = t.intraday;
  const rows = useMemo(() => bucketIntradayPoints(intraday.points, interval).slice(-80).reverse(), [intraday.points, interval]);
  const latest = rows[0];
  return (
    <section className="section" aria-label={ti.title}>
      <div className="section-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><h3>{ti.title}</h3><span className={`status-chip ${intraday.status}`}>{ti.status[intraday.status]}</span></div>
        <div className="segmented" aria-label={ti.interval}>{[1, 5, 15].map((value) => <button key={value} type="button" className={interval === value ? 'active' : ''} aria-pressed={interval === value} onClick={() => setInterval(value)}>{value}m</button>)}</div>
      </div>
      {latest ? (
        <div className="intraday-latest num">
          <div>{ti.price}<b>{twd(latest.price)}</b></div>
          <div>{ti.change}<b className={latest.dayChange > 0 ? 'gain' : latest.dayChange < 0 ? 'loss' : ''}>{pct(latest.dayChange)}</b></div>
          <div>{ti.time}<b>{taipeiTime(latest.timestamp, lang)}</b></div>
        </div>
      ) : null}
      <div className="intraday-table-wrap">
        <table className="intraday-table num">
          <thead><tr><th>{ti.time}</th><th>{ti.price}</th><th>{ti.change}</th><th>{ti.kind}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.timestamp}><td>{taipeiTime(row.timestamp, lang)}</td><td>{twd(row.price)}</td><td className={row.dayChange > 0 ? 'gain' : row.dayChange < 0 ? 'loss' : ''}>{pct(row.dayChange)}</td><td><span className={`kind ${row.kind}`}>{row.kind === 'trade' ? ti.trade : row.kind === 'history' ? ti.history : ti.close}</span></td></tr>)}</tbody>
        </table>
        {!rows.length ? <p className="empty-small">{ti.empty}</p> : null}
      </div>
      <p className="fineprint">{ti.subtitle}。{ti.note}</p>
    </section>
  );
}

export function StockDetails({ stock, lang, t, history, timing, intraday, isWatched, onToggleWatch }: Props) {
  const td = t.details;
  if (!stock) return <section className="panel"><div className="empty">{td.noStock}</div></section>;
  const label = signalLabel(stock.total);
  const name = lang === 'zh' ? stock.nameZh : stock.nameEn || stock.nameZh;
  const tone = stock.dayChange > 0 ? 'gain' : stock.dayChange < 0 ? 'loss' : 'flat';
  const positives: string[] = [];
  if (stock.revenueGrowth != null && stock.revenueGrowth > 10) positives.push(`${t.table.revenue} ${pct(stock.revenueGrowth, 1)}`);
  if (stock.revenueYtd != null && stock.revenueYtd > 10) positives.push(`${td.revenueYtd} ${pct(stock.revenueYtd, 1)}`);
  if (stock.pe != null && stock.pe < 15) positives.push(`${t.table.pe} ${num(stock.pe, 1)}`);
  if (stock.dividendYield != null && stock.dividendYield >= 4) positives.push(`${t.table.dividendYield} ${num(stock.dividendYield, 2)}%`);
  if (timing?.reasons.includes('bullishTrend')) positives.push(t.timing.reasons.bullishTrend);
  if (timing?.reasons.includes('rewardFavorable')) positives.push(t.timing.reasons.rewardFavorable);
  if (!positives.length) positives.push(`${t.table.score} ${stock.total}`, `${t.table.change} ${pct(stock.dayChange)}`);
  const risks: string[] = [];
  if (stock.pe == null) risks.push(td.riskItems.loss);
  if ((stock.tradeValue ?? 0) < 3e7) risks.push(td.riskItems.liquidity);
  if (timing?.reasons.includes('highVolatility')) risks.push(t.timing.reasons.highVolatility);
  if (timing?.reasons.includes('rsiHot')) risks.push(t.timing.reasons.rsiHot);
  risks.push(td.riskItems.cycle, td.riskItems.valuation, td.riskItems.lag);

  return (
    <article className="panel details" aria-label={td.title}>
      <header className="details-head">
        <div className="details-title">
          <div className="ticker-line num"><b style={{ color: 'var(--ink)', fontSize: 15 }}>{stock.ticker}</b><span className={`tag ${stock.market === 'TPEx' ? 'tpex' : ''}`}>{stock.market === 'TPEx' ? t.filters.tpex : t.filters.twse}</span><span>{stock.sectorZh}</span></div>
          <h2>{name}</h2>
          <p>{lang === 'zh' ? stock.nameEn : stock.nameZh}</p>
        </div>
        <div className={`details-price num ${tone}`}>
          <b>{twd(stock.price)}</b>
          <span>{pct(stock.dayChange)}{stock.previousClose ? ` (${stock.dayChange >= 0 ? '+' : ''}${num(stock.price - stock.previousClose, 2)})` : ''}</span>
          <small>{stock.dataKind === 'latest' ? t.table.latest : t.table.close}{stock.quoteTime ? `｜${stock.quoteTime}` : ''}</small>
        </div>
        <div className="details-actions">
          <span className="score-chip"><span className="score-ring" style={{ ['--score' as string]: stock.total }} /><b className="num">{stock.total}</b><span>{t.table.score}</span><span className={`pill ${label}`}>{t.labels[label]}</span></span>
          <span className="score-chip"><b className="num">{stock.efficiency}</b><span>{t.table.efficiency}</span></span>
          <button type="button" className={`text-button ${isWatched ? 'active' : ''}`} onClick={onToggleWatch} aria-pressed={isWatched}><Star size={14} fill={isWatched ? 'currentColor' : 'none'} style={{ color: isWatched ? 'var(--warn)' : undefined }} />{isWatched ? t.table.remove : t.table.add}</button>
        </div>
      </header>

      <div className="factors num">
        {(['value', 'growth', 'momentum', 'quality', 'yieldScore'] as const).map((key) => (
          <div key={key} className="factor"><span>{td.factors[key]}</span><b>{stock[key]}</b><span className="bar"><i style={{ width: `${stock[key]}%` }} /></span></div>
        ))}
      </div>

      <div className="facts num">
        <div><span>{td.open} / {td.high} / {td.low}</span><b>{twd(stock.open)} / {twd(stock.high)} / {twd(stock.low)}</b></div>
        <div><span>{td.previousClose}</span><b>{twd(stock.previousClose)}</b></div>
        <div><span>{td.volume}</span><b>{lots(stock.volume)}</b></div>
        <div><span>{td.turnover}</span><b>{compact(stock.tradeValue)}</b></div>
        <div><span>{td.transactions}</span><b>{num(stock.transactions, 0)}</b></div>
        <div><span>{t.table.pe} / {t.table.pb}</span><b>{num(stock.pe, 1)} / {num(stock.pb, 2)}</b></div>
        <div><span>{t.table.dividendYield}</span><b>{stock.dividendYield == null ? '—' : `${num(stock.dividendYield, 2)}%`}</b></div>
        <div><span>{t.table.revenue}</span><b className={stock.revenueGrowth == null ? '' : stock.revenueGrowth >= 0 ? 'gain' : 'loss'}>{pct(stock.revenueGrowth, 1)}</b></div>
        <div><span>{td.revenueMoM}</span><b className={stock.revenueMoM == null ? '' : stock.revenueMoM >= 0 ? 'gain' : 'loss'}>{pct(stock.revenueMoM, 1)}</b></div>
        <div><span>{td.revenueYtd}</span><b className={stock.revenueYtd == null ? '' : stock.revenueYtd >= 0 ? 'gain' : 'loss'}>{pct(stock.revenueYtd, 1)}</b></div>
        <div><span>{td.revenuePeriod}</span><b>{rocMonthLabel(stock.revenuePeriod) || '—'}</b></div>
      </div>

      <TechnicalChart candles={history.candles} intradayCandles={intraday.candles} lang={lang} t={t} loading={history.status === 'loading'} />
      <TimingPanel timing={timing} history={history} t={t} />
      <IntradayPanel intraday={intraday} lang={lang} t={t} />

      <section className="section thesis">
        <div className="section-head"><h3>{td.thesis}</h3></div>
        <p>{td.generatedThesis(name, stock.total, t.labels[label])}</p>
        <div className="lists">
          <div><h4><Check size={14} />{td.positives}</h4><ul>{positives.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h4><AlertTriangle size={14} />{td.risks}</h4><ul>{risks.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
      </section>
    </article>
  );
}

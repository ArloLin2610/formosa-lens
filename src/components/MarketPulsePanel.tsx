import { useMemo } from 'react';
import type { MarketPulse } from '@/api/client';
import type { Copy } from '@/i18n/copy';
import { num, pct, taipeiTime } from '@/lib/format';
import { rocToIso } from '@/lib/market';
import type { Lang, ScoredStock } from '@/lib/types';

interface Props { pulse: MarketPulse | null; stocks: ScoredStock[]; lang: Lang; t: Copy }

/** TWD -> 億 (hundred million) with sign, or billions in English. */
const money = (value: number, lang: Lang) => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  if (lang === 'zh') return `${sign}${num(Math.abs(value) / 1e8, 0)} 億`;
  return `${sign}${num(Math.abs(value) / 1e9, 1)}B`;
};

export function MarketPulsePanel({ pulse, stocks, lang, t }: Props) {
  const tp = t.pulse;
  const breadth = useMemo(() => {
    let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
    for (const stock of stocks) {
      if (stock.dayChange > 0) up += 1; else if (stock.dayChange < 0) down += 1; else flat += 1;
      if (stock.dayChange >= 9.5) limitUp += 1; else if (stock.dayChange <= -9.5) limitDown += 1;
    }
    return { up, down, flat, limitUp, limitDown, total: stocks.length || 1 };
  }, [stocks]);

  const taiex = pulse?.indices.find((index) => index.code === 't00');
  const tpex = pulse?.indices.find((index) => index.code === 'o00');
  const history = pulse?.taiexHistory ?? [];
  const W = 300, H = 56;
  const closes = history.map((point) => point.close);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const path = closes.map((close, index) => `${index ? 'L' : 'M'}${((index / Math.max(closes.length - 1, 1)) * W).toFixed(1)},${(H - 4 - ((close - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}`).join(' ');
  const sixMonthChange = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : null;
  const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'gain' : value < 0 ? 'loss' : 'flat');

  const Index = ({ label, quote }: { label: string; quote: typeof taiex }) => (
    <div className="pulse-index">
      <span>{label}</span>
      <b className="num">{quote?.value == null ? '—' : num(quote.value, 2)}</b>
      <i className={`num ${tone(quote?.change)}`}>{quote?.change == null ? '—' : pct(quote.change)}</i>
    </div>
  );
  const flowRows = (flows: MarketPulse['flows']['twse']) => (['foreign', 'trust', 'dealer'] as const).map((key) => {
    const net = flows.find((flow) => flow.investor === key)?.net;
    return <span key={key} className={`num ${tone(net)}`}>{tp[key]} {net == null ? '—' : money(net, lang)}</span>;
  });

  return (
    <section className="panel pulse" aria-label={tp.title}>
      <div className="card-head"><h2>{tp.title}</h2><small className="num">{taiex?.time ? `${taiex.date.slice(4, 6)}/${taiex.date.slice(6, 8)} ${taiex.time.slice(0, 5)}` : ''}</small></div>
      {pulse ? (
        <>
          <div className="pulse-indices"><Index label={tp.taiex} quote={taiex} /><Index label={tp.tpex} quote={tpex} /></div>
          {closes.length > 1 ? (
            <div className="pulse-spark">
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${tp.taiex} ${tp.sixMonths}`}><path d={path} /></svg>
              <small>{tp.sixMonths} <b className={`num ${tone(sixMonthChange)}`}>{pct(sixMonthChange, 1)}</b></small>
            </div>
          ) : null}
        </>
      ) : <p className="toolbar-count">{tp.unavailable}</p>}
      <div className="pulse-breadth">
        <div className="pulse-breadth-bar" aria-hidden="true">
          <i className="up" style={{ flex: breadth.up }} /><i className="flat" style={{ flex: breadth.flat }} /><i className="down" style={{ flex: breadth.down }} />
        </div>
        <div className="pulse-breadth-legend num">
          <span className="gain">{tp.up} {num(breadth.up, 0)}</span><span className="flat">{tp.flat} {num(breadth.flat, 0)}</span><span className="loss">{tp.down} {num(breadth.down, 0)}</span>
          <span>{tp.limitUp} <b className="gain">{breadth.limitUp}</b>｜{tp.limitDown} <b className="loss">{breadth.limitDown}</b></span>
        </div>
      </div>
      {pulse?.flows.twse.length || pulse?.flows.tpex.length ? (
        <div className="pulse-flows">
          <small>{tp.flows}{pulse.flows.date ? `（${pulse.flows.date.length === 8 ? `${pulse.flows.date.slice(4, 6)}/${pulse.flows.date.slice(6, 8)}` : pulse.flows.date}）` : ''}</small>
          {pulse.flows.twse.length ? <div><em>{tp.twse}</em>{flowRows(pulse.flows.twse)}</div> : null}
          {pulse.flows.tpex.length ? <div><em>{tp.tpexShort}</em>{flowRows(pulse.flows.tpex)}</div> : null}
        </div>
      ) : null}
      {pulse?.turnover?.tradeValue ? (
        <div className="pulse-turnover num"><span>{tp.turnover}（{rocToIso(pulse.turnover.date).slice(5)}）</span><b>{lang === 'zh' ? `${num(pulse.turnover.tradeValue / 1e12, 2)} ${tp.trillion}` : `${num(pulse.turnover.tradeValue / 1e9, 0)}B`}</b><span>{tp.transactions}</span><b>{num(pulse.turnover.transactions, 0)}</b></div>
      ) : null}
      {pulse ? <span className="visually-hidden">{taipeiTime(pulse.meta.fetchedAt, lang)}</span> : null}
    </section>
  );
}

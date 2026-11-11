import type { Copy } from '@/i18n/copy';
import type { BacktestSummary } from '@/lib/backtest';
import { num, pct } from '@/lib/format';
import { LIST_KINDS, type EvaluatedWeek, type ForwardCell, type ForwardSummary, type ListKind } from '@/lib/forward';
import type { Lang } from '@/lib/types';

interface Props {
  track: ForwardSummary | null;
  backtest: BacktestSummary | null;
  lang: Lang;
  t: Copy;
  onSelect: (ticker: string) => void;
}

const tone = (value: number | null | undefined) => (value == null ? '' : value > 0 ? 'gain' : value < 0 ? 'loss' : '');
const TARGET_WEEKS = 52;

/**
 * Forward test: the lists frozen each week and what prices did afterwards.
 * Sits next to the backtest so "what the rules did in the past" and "what the
 * site's actual lists have done since" can be read side by side.
 */
export function ForwardCard({ track, backtest, lang, t, onSelect }: Props) {
  const tf = t.forward;
  if (!track || !track.weeks) {
    return (
      <div className="section forward">
        <div className="section-head"><div><h3>{tf.title}</h3><small>{tf.subtitle}</small></div></div>
        <p className="toolbar-count">{tf.none}</p>
      </div>
    );
  }

  const settledAny = LIST_KINDS.some((kind) => track.lists[kind].some((cell) => cell.weeks > 0));
  // Backtest excess for the same rule and horizon, where the backtest has one (entry / exit at 1 week, 1 month, 3 months).
  const expected = (kind: ListKind, bars: number): number | null => (kind === 'longTerm' ? null : backtest?.[kind].find((stat) => stat.bars === bars)?.excess ?? null);

  const cell = (kind: ListKind, stat: ForwardCell) => (
    <td key={stat.bars} className="right">
      {stat.weeks ? (
        <div className="bt-cell">
          <b className={tone(stat.average)}>{pct(stat.average, 2)}</b>
          <span>{tf.market} <i className="num">{pct(stat.market, 2)}</i></span>
          <span>{tf.excess} <i className={`num ${tone(stat.excess)}`}>{pct(stat.excess, 2)}</i></span>
          {stat.index != null ? <span>{tf.index} <i className="num">{pct(stat.index, 2)}</i></span> : null}
          <span>{tf.ahead(stat.weeksAhead, stat.weeks)}</span>
          {expected(kind, stat.bars) != null ? <span className="muted">{tf.backtest} {pct(expected(kind, stat.bars), 2)}</span> : null}
        </div>
      ) : <span className="muted">{tf.pending}</span>}
    </td>
  );

  const weekLine = (week: EvaluatedWeek) => (
    <details key={week.week} className="fw-week" open={week === track.log[0]}>
      <summary>
        <b className="num">{week.week}</b>
        <span className="num">{tf.signal} {week.signalDate}</span>
        <span className={`status-chip ${week.final ? '' : 'stale'}`}>{week.final ? tf.frozen : tf.running}</span>
        <span className="num">{tf.elapsed(week.bars)}</span>
        {week.bars > 0 ? (
          <span className="fw-means num">
            {LIST_KINDS.map((kind) => <span key={kind}>{tf.list[kind]} <i className={tone(week.lists[kind].mean.toDate)}>{pct(week.lists[kind].mean.toDate, 1)}</i></span>)}
            <span>{tf.market} <i>{pct(week.market.toDate, 1)}</i></span>
            {week.index ? <span>{tf.index} <i>{pct(week.index.toDate, 1)}</i></span> : null}
          </span>
        ) : null}
      </summary>
      <div className="fw-lists">
        {LIST_KINDS.map((kind) => (
          <div key={kind} className="fw-list">
            <span className={`chip ${kind}`}>{tf.list[kind]}</span>
            <div className="chip-row">
              {week.lists[kind].picks.length ? week.lists[kind].picks.map((pick) => (
                <button key={pick.ticker} type="button" className="fw-pick num" onClick={() => onSelect(pick.ticker)} title={`${tf.signal} ${num(pick.price, 2)}`}>
                  <b>{pick.ticker}</b>{lang === 'zh' ? pick.name : pick.nameEn || pick.name}
                  {week.bars > 0 ? <i className={tone(pick.toDate)}>{pct(pick.toDate, 1)}</i> : <i>{num(pick.price, 2)}</i>}
                </button>
              )) : <span className="muted">—</span>}
            </div>
          </div>
        ))}
      </div>
    </details>
  );

  return (
    <div className="section forward">
      <div className="section-head">
        <div><h3>{tf.title}</h3><small>{tf.subtitle}</small></div>
        <small className="num">{tf.since(track.startedOn ?? '', track.weeks)}</small>
      </div>
      <div className="fw-progress">
        <div className="fw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={TARGET_WEEKS} aria-valuenow={Math.min(track.weeks, TARGET_WEEKS)} aria-label={tf.progress(track.weeks)}>
          <i style={{ width: `${Math.min(100, (track.weeks / TARGET_WEEKS) * 100)}%` }} />
        </div>
        <span className="num">{tf.progress(track.weeks)}</span>
      </div>

      {settledAny ? (
        <div className="table-wrap">
          <table className="ranking bt-table fw-table num">
            <thead><tr><th>{tf.listHead}</th>{track.horizons.map((bars) => <th key={bars} className="right">{tf.horizon[bars as 5 | 21 | 63 | 126 | 252]}</th>)}</tr></thead>
            <tbody>
              {LIST_KINDS.map((kind) => <tr key={kind}><td><span className={`chip ${kind}`}>{tf.list[kind]}</span></td>{track.lists[kind].map((stat) => cell(kind, stat))}</tr>)}
              <tr>
                <td><span className="chip">{tf.scoreRow}</span></td>
                {track.score.map((stat) => (
                  <td key={stat.bars} className="right">
                    {stat.weeks ? (
                      <div className="bt-cell">
                        <b className={tone(stat.spread)}>{pct(stat.spread, 2)}</b>
                        <span>{tf.top} <i className="num">{pct(stat.top, 2)}</i></span>
                        <span>{tf.bottom} <i className="num">{pct(stat.bottom, 2)}</i></span>
                        <span className="muted">{tf.weeksCount(stat.weeks)}</span>
                      </div>
                    ) : <span className="muted">{tf.pending}</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : <p className="toolbar-count">{tf.waiting}</p>}

      <div className="fw-log">
        <h4>{tf.logTitle}</h4>
        {track.log.map(weekLine)}
      </div>
      <p className="fineprint">{tf.reading}</p>
      <p className="fineprint">{tf.settings}{track.earlierRules ? ` ${tf.earlier(track.earlierRules)}` : ''}</p>
    </div>
  );
}

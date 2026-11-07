import { useId } from 'react';
import { SIGNAL_BANDS } from '@/lib/ndc';
import type { Lang, SignalKey, SignalPayload } from '@/lib/types';
import type { Copy } from '@/i18n/copy';

const LAMP_VAR: Record<SignalKey, string> = {
  blue: 'var(--lamp-blue)', yellowBlue: 'var(--lamp-yellow-blue)', green: 'var(--lamp-green)', yellowRed: 'var(--lamp-yellow-red)', red: 'var(--lamp-red)',
};

export function MacroPanel({ signal, lang, t }: { signal: SignalPayload | null; lang: Lang; t: Copy }) {
  const id = useId();
  if (!signal) return <section className="panel macro" aria-busy="true"><div className="card-head"><h2>{t.macro.title}</h2></div></section>;
  const { latest, history } = signal;
  const band = SIGNAL_BANDS.find((item) => item.key === latest.signalKey) ?? SIGNAL_BANDS[4];
  const W = 300, H = 86, left = 22, right = 8, top = 10, bottom = 22;
  const series = history.slice(-12);
  const x = (index: number) => left + (index / Math.max(series.length - 1, 1)) * (W - left - right);
  const y = (score: number) => top + (1 - (score - 9) / 36) * (H - top - bottom);
  const path = series.map((record, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(record.score).toFixed(1)}`).join(' ');

  return (
    <section className="panel macro" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{t.macro.title}</h2>
        <small>{signal.meta.status === 'live' ? t.macro.live : t.macro.fallback}</small>
      </div>
      <div className="lamp-row">
        <div className="lamp" style={{ ['--lamp' as string]: LAMP_VAR[latest.signalKey] }} aria-hidden="true">{latest.score}</div>
        <div className="lamp-text">
          <b>{lang === 'zh' ? band.zh : band.en}</b>
          <span>{t.macro.month(latest.month)}｜{latest.score} {t.macro.score}｜{t.macro.range}</span>
        </div>
      </div>
      <div className="lamp-scale" aria-hidden="true">
        {SIGNAL_BANDS.map((item) => <i key={item.key} style={{ flex: item.max - item.min + 1, background: LAMP_VAR[item.key], opacity: item.key === latest.signalKey ? 1 : 0.35 }} />)}
      </div>
      <svg className="macro-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.macro.trend}: ${series.map((record) => `${record.month} ${record.score}`).join(', ')}`}>
        {[16, 22, 31, 37].map((threshold) => <line key={threshold} className="grid" x1={left} x2={W - right} y1={y(threshold + 0.5)} y2={y(threshold + 0.5)} />)}
        {[9, 27, 45].map((tick) => <text key={tick} x={left - 5} y={y(tick) + 3.5} textAnchor="end">{tick}</text>)}
        <path d={path} />
        {series.map((record, index) => <circle key={record.month} cx={x(index)} cy={y(record.score)} r={index === series.length - 1 ? 3.5 : 2} fill={LAMP_VAR[record.signalKey]} />)}
        {series.map((record, index) => (index % 3 === 0 || index === series.length - 1) ? <text key={`label-${record.month}`} x={x(index)} y={H - 6} textAnchor={index === series.length - 1 ? 'end' : index === 0 ? 'start' : 'middle'}>{record.month.slice(2).replace('/', '.')}</text> : null)}
      </svg>
      <p className="macro-note">{t.macro.notes[latest.signalKey]}</p>
    </section>
  );
}

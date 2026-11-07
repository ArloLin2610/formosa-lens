import { useRef, useState } from 'react';
import { Download, Star, Trash2, Upload } from 'lucide-react';
import type { Copy } from '@/i18n/copy';
import { pct, taipeiDateTime, twd } from '@/lib/format';
import { rocMonthLabel, rocToIso } from '@/lib/market';
import { exportSettings, importSettings, type UserSettings } from '@/lib/storage';
import type { Lang, MarketMeta, QuotePayload, ScoredStock } from '@/lib/types';

export function FreshnessPanel({ meta, quoteMeta, lang, t }: { meta: MarketMeta | null; quoteMeta: QuotePayload['meta'] | null; lang: Lang; t: Copy }) {
  if (!meta) return null;
  return (
    <section className="panel freshness" aria-label={t.common.updated}>
      <div><span>{t.status.marketDate}</span><b className="num">{rocToIso(meta.marketDate) || '—'}</b></div>
      <div><span>{t.status.revenue}</span><b className="num">{rocMonthLabel(meta.revenuePeriod) || '—'}</b></div>
      <div><span>{t.status.quoteTime}</span><b className="num">{quoteMeta?.quoteTimestamp ? `${taipeiDateTime(quoteMeta.quoteTimestamp, lang)} (${t.status.taipei})` : '—'}</b></div>
      <div><span>{t.common.updated}</span><b className="num">{taipeiDateTime(meta.fetchedAt, lang)}</b></div>
    </section>
  );
}

interface WatchlistProps {
  stocks: ScoredStock[];
  settings: UserSettings;
  selectedTicker: string | undefined;
  lang: Lang;
  t: Copy;
  onSelect: (ticker: string) => void;
  onReplaceSettings: (next: UserSettings) => void;
  onClear: () => void;
}

export function WatchlistPanel({ stocks, settings, selectedTicker, lang, t, onSelect, onReplaceSettings, onClear }: WatchlistProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState('');
  const byTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));
  const items = settings.watchlist.map((ticker) => byTicker.get(ticker)).filter((stock): stock is ScoredStock => Boolean(stock));

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200); };
  const download = () => {
    const blob = new Blob([exportSettings(settings)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `formosa-lens-settings-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try { onReplaceSettings(importSettings(await file.text())); flash(t.watchlist.imported); }
    catch { flash(t.watchlist.importFailed); }
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <section className="panel watch" aria-label={t.watchlist.title}>
      <div className="card-head"><h2>{t.watchlist.title}</h2><small>{t.watchlist.count(items.length)}</small></div>
      {items.length ? (
        <div className="watch-list">
          {items.map((stock) => (
            <button key={stock.ticker} type="button" className={`watch-item ${stock.ticker === selectedTicker ? 'selected' : ''}`} onClick={() => onSelect(stock.ticker)}>
              <span className="company"><b>{stock.ticker}<span className={`tag ${stock.market === 'TPEx' ? 'tpex' : ''}`}>{stock.market === 'TPEx' ? t.filters.tpex : t.filters.twse}</span></b><span>{lang === 'zh' ? stock.nameZh : stock.nameEn || stock.nameZh}</span></span>
              <span className="price-cell num"><b>{twd(stock.price)}</b><small className={stock.dayChange > 0 ? 'gain' : stock.dayChange < 0 ? 'loss' : 'flat'}>{pct(stock.dayChange)}</small></span>
              <span className="score-cell" style={{ gridTemplateColumns: '28px' }}><b className="num">{stock.total}</b></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-small"><Star size={18} /><b>{t.watchlist.empty}</b><span>{t.watchlist.emptyHint}</span></div>
      )}
      <div className="watch-actions">
        <button type="button" onClick={download}><Download size={13} />{t.watchlist.export}</button>
        <label><Upload size={13} />{t.watchlist.import}<input ref={fileInput} type="file" accept="application/json,.json" onChange={(event) => void upload(event.target.files?.[0])} /></label>
        {items.length ? <button type="button" onClick={onClear}><Trash2 size={13} />{t.watchlist.clear}</button> : null}
      </div>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </section>
  );
}

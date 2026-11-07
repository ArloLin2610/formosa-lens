import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Globe2, Moon, RefreshCw, Search, Settings2, Sun, SunMoon } from 'lucide-react';
import { fetchMarketPulse, fetchScreen, fetchSignal, type MarketPulse } from '@/api/client';
import { copy } from '@/i18n/copy';
import { useMarketData } from '@/hooks/useMarketData';
import { useSettings, useSlashShortcut } from '@/hooks/useSettings';
import { useHistory, useIntraday, useTiming } from '@/hooks/useStockSeries';
import { num, taipeiTime } from '@/lib/format';
import { LENSES, estimateEfficiency, scoreStock } from '@/lib/scoring';
import type { Lens, Market, ScoredStock, ScreenPayload, SignalPayload } from '@/lib/types';
import { MacroPanel } from '@/components/MacroPanel';
import { FreshnessPanel, WatchlistPanel } from '@/components/RailPanels';
import { RankingTable } from '@/components/RankingTable';
import { StockDetails } from '@/components/StockDetails';
import { PicksPanel } from '@/components/PicksPanel';
import { MarketPulsePanel } from '@/components/MarketPulsePanel';

type View = 'ranking' | 'picks' | 'watchlist' | 'details';
const MIN_SCORES = [0, 50, 60, 70, 80];
const SOURCES = { twse: 'https://openapi.twse.com.tw/', tpex: 'https://www.tpex.org.tw/openapi/', ndc: 'https://data.gov.tw/dataset/6099' };

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M21 21l7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M9.5 16.5l3-4 2.5 2.5 3.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [settings, update, replace] = useSettings();
  const t = copy[settings.lang];
  const lang = settings.lang;
  const market = useMarketData();
  const [signal, setSignal] = useState<SignalPayload | null>(null);
  const [screen, setScreen] = useState<ScreenPayload | null>(null);
  const [pulse, setPulse] = useState<MarketPulse | null>(null);
  const [screenStatus, setScreenStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View>('ranking');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sector, setSector] = useState('all');
  const [marketFilter, setMarketFilter] = useState<'all' | Market>('all');
  const [minScore, setMinScore] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashShortcut(searchRef);

  useEffect(() => {
    let active = true;
    const load = () => fetchSignal().then((payload) => { if (active) setSignal(payload); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 6 * 3_600_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => fetchMarketPulse().then((payload) => { if (active) setPulse(payload); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => fetchScreen().then((payload) => { if (active) { setScreen(payload); setScreenStatus('ready'); } }).catch(() => { if (active) setScreenStatus((current) => (current === 'ready' ? current : 'error')); });
    void load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.popover-anchor')) setSettingsOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [settingsOpen]);

  const scored = useMemo<ScoredStock[]>(() => (market.snapshot?.stocks ?? []).map((stock) => {
    const breakdown = scoreStock(stock, settings.lens);
    const merged = { ...stock, ...breakdown, efficiency: 0 };
    return { ...merged, efficiency: estimateEfficiency(merged) };
  }), [market.snapshot, settings.lens]);

  const sectors = useMemo(() => Array.from(new Set(scored.map((stock) => stock.sectorZh))).sort((a, b) => a.localeCompare(b, 'zh-Hant')), [scored]);
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return scored.filter((stock) =>
      (marketFilter === 'all' || stock.market === marketFilter)
      && (sector === 'all' || stock.sectorZh === sector)
      && stock.total >= minScore
      && (!needle || stock.ticker.includes(needle) || stock.nameZh.toLowerCase().includes(needle) || stock.nameEn.toLowerCase().includes(needle)));
  }, [scored, deferredQuery, sector, marketFilter, minScore]);

  const selected = useMemo(() => scored.find((stock) => stock.ticker === settings.selectedTicker) ?? filtered[0] ?? scored[0], [scored, settings.selectedTicker, filtered]);
  const history = useHistory(selected?.ticker, selected?.market);
  const timing = useTiming(selected, history);
  const intraday = useIntraday(selected);

  const selectStock = (ticker: string) => { update({ selectedTicker: ticker }); setView('details'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggleWatch = (ticker: string) => update((current) => ({ watchlist: current.watchlist.includes(ticker) ? current.watchlist.filter((item) => item !== ticker) : [...current.watchlist, ticker] }));

  const snapshotMeta = market.snapshot?.meta ?? null;
  const hasLive = scored.some((stock) => stock.dataKind === 'latest');
  const statusKind = market.status === 'error' && !market.snapshot ? 'error' : market.status === 'loading' && !market.snapshot ? 'loading' : hasLive && (market.phase === 'open' || market.phase === 'preOpen') ? 'live' : 'close';
  const statusText = statusKind === 'loading' ? t.status.loading : statusKind === 'error' ? t.status.demo : statusKind === 'live' ? t.status.live : t.status.close;
  const quoteTime = market.quoteMeta?.quoteTimestamp ? `${taipeiTime(market.quoteMeta.quoteTimestamp, lang)} (${t.status.taipei})` : '—';
  const ThemeIcon = settings.theme === 'dark' ? Moon : settings.theme === 'light' ? Sun : SunMoon;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={t.brand}><BrandMark /><span className="brand-text"><b>{t.brand}</b><small>{t.brandLatin}｜{t.tagline}</small></span></a>
        <nav className="nav" aria-label={t.nav.ranking}>
          <button type="button" className={view === 'ranking' ? 'active' : ''} onClick={() => setView('ranking')}>{t.nav.ranking}</button>
          <button type="button" className={view === 'picks' ? 'active' : ''} onClick={() => setView('picks')}>{t.picks.nav}</button>
          <button type="button" className={view === 'watchlist' ? 'active' : ''} onClick={() => setView('watchlist')}>{t.nav.watchlist}<i className="num">{settings.watchlist.length}</i></button>
          <button type="button" className={view === 'details' ? 'active' : ''} onClick={() => setView('details')}>{t.nav.details}</button>
        </nav>
        <label className="search">
          <Search size={16} />
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); if (view !== 'ranking') setView('ranking'); }} placeholder={t.search.placeholder} aria-label={t.search.hint} />
          <kbd>/</kbd>
        </label>
        <div className="topbar-actions">
          <button type="button" className="icon-button" onClick={() => update({ lang: lang === 'zh' ? 'en' : 'zh' })} aria-label="Language"><Globe2 size={15} />{t.common.lang}</button>
          <div className="popover-anchor">
            <button type="button" className="icon-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-label={t.common.settings}><Settings2 size={15} /></button>
            {settingsOpen ? (
              <div className="popover" role="dialog" aria-label={t.common.settings}>
                <h3><ThemeIcon size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{t.theme.label}</h3>
                <div className="segmented">{(['system', 'light', 'dark'] as const).map((theme) => <button key={theme} type="button" className={settings.theme === theme ? 'active' : ''} onClick={() => update({ theme })}>{t.theme[theme]}</button>)}</div>
                <h3>{t.table.perPage}</h3>
                <div className="segmented">{[25, 50, 100].map((size) => <button key={size} type="button" className={settings.pageSize === size ? 'active' : ''} onClick={() => update({ pageSize: size })}>{size}</button>)}</div>
              </div>
            ) : null}
          </div>
          <button type="button" className="icon-button" onClick={market.reload} disabled={market.status === 'loading'} aria-label={t.status.refresh} title={t.status.refresh}><RefreshCw size={15} /></button>
        </div>
      </header>

      <main id="top">
        <div className="status-strip num">
          <span className={`status-dot ${statusKind}`}>{statusText}</span>
          <span className="status-item">{t.status.quoteTime}<b>{quoteTime}</b></span>
          <span className="status-item">{market.phase === 'open' ? t.status.quoteLive : t.status.quotePaused}</span>
          {snapshotMeta ? <span className="status-item">{t.filters.results(num(scored.length, 0))}</span> : null}
        </div>
        {market.error && market.snapshot ? <div className="notice" role="status"><AlertTriangle size={15} />{t.status.loadError}</div> : null}
        {market.error && !market.snapshot && market.status !== 'loading' ? <div className="notice" role="alert"><AlertTriangle size={15} />{market.error}</div> : null}
        {snapshotMeta?.stale.length ? <div className="notice" role="status"><AlertTriangle size={15} />{t.status.partialNote}</div> : null}

        <div className="workbench">
          <div>
            {view === 'ranking' ? (
              <section className="panel" aria-label={t.nav.ranking}>
                <div className="toolbar">
                  <span className="toolbar-label">{t.lens.title}</span>
                  <div className="segmented" role="tablist">{LENSES.map((lens: Lens) => <button key={lens} type="button" role="tab" aria-selected={settings.lens === lens} className={settings.lens === lens ? 'active' : ''} onClick={() => update({ lens })}>{t.lens[lens]}</button>)}</div>
                  <select className="select" value={marketFilter} onChange={(event) => setMarketFilter(event.target.value as 'all' | Market)} aria-label={t.filters.market}>
                    <option value="all">{t.filters.allMarkets}</option><option value="TWSE">{t.filters.twse}</option><option value="TPEx">{t.filters.tpex}</option>
                  </select>
                  <select className="select" value={sector} onChange={(event) => setSector(event.target.value)} aria-label={t.filters.sector}>
                    <option value="all">{t.filters.allSectors}</option>{sectors.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className="select" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} aria-label={t.filters.minScore}>
                    {MIN_SCORES.map((score) => <option key={score} value={score}>{score ? `${t.filters.minScore} ${score}` : `${t.filters.minScore}: ${t.filters.any}`}</option>)}
                  </select>
                  <span className="toolbar-spacer" />
                  <span className="toolbar-count">{t.filters.results(num(filtered.length, 0))}</span>
                </div>
                {market.status === 'loading' && !market.snapshot ? <div className="empty"><RefreshCw size={20} className="spin" />{t.status.loading}</div> : (
                  <RankingTable rows={filtered} lang={lang} t={t} selectedTicker={selected?.ticker} watchlist={settings.watchlist} pageSize={settings.pageSize} onPageSize={(size) => update({ pageSize: size })} onSelect={selectStock} onToggleWatch={toggleWatch} />
                )}
              </section>
            ) : null}
            {view === 'picks' ? (
              <PicksPanel stocks={scored} screen={screen} status={screenStatus} lang={lang} t={t} watchlist={settings.watchlist} onSelect={selectStock} onToggleWatch={toggleWatch} />
            ) : null}
            {view === 'watchlist' ? (
              <section className="panel" aria-label={t.nav.watchlist}>
                <div className="toolbar"><span className="toolbar-label">{t.lens.title}</span><div className="segmented">{LENSES.map((lens: Lens) => <button key={lens} type="button" className={settings.lens === lens ? 'active' : ''} onClick={() => update({ lens })}>{t.lens[lens]}</button>)}</div></div>
                <RankingTable rows={scored.filter((stock) => settings.watchlist.includes(stock.ticker))} lang={lang} t={t} selectedTicker={selected?.ticker} watchlist={settings.watchlist} pageSize={100} onPageSize={() => undefined} onSelect={selectStock} onToggleWatch={toggleWatch} />
              </section>
            ) : null}
            {view === 'details' ? (
              <StockDetails stock={selected} lang={lang} t={t} history={history} timing={timing} intraday={intraday} isWatched={!!selected && settings.watchlist.includes(selected.ticker)} onToggleWatch={() => selected && toggleWatch(selected.ticker)} />
            ) : null}
          </div>
          <aside className="rail">
            <MarketPulsePanel pulse={pulse} stocks={scored} lang={lang} t={t} />
            <MacroPanel signal={signal} lang={lang} t={t} />
            <FreshnessPanel meta={snapshotMeta} quoteMeta={market.quoteMeta} lang={lang} t={t} />
            <WatchlistPanel stocks={scored} settings={settings} selectedTicker={selected?.ticker} lang={lang} t={t} onSelect={selectStock} onReplaceSettings={replace} onClear={() => update({ watchlist: [] })} />
          </aside>
        </div>

        <section className="panel method" id="method">
          <h2>{t.method.title}</h2>
          <p>{t.method.body}</p>
          <p className="sources">{t.method.sources}</p>
        </section>
        <footer className="footer">
          <span>{t.method.disclosure}</span>
          <span style={{ display: 'flex', gap: 14 }}>
            <a href={SOURCES.twse} target="_blank" rel="noreferrer">TWSE <ExternalLink size={11} /></a>
            <a href={SOURCES.tpex} target="_blank" rel="noreferrer">TPEx <ExternalLink size={11} /></a>
            <a href={SOURCES.ndc} target="_blank" rel="noreferrer">NDC <ExternalLink size={11} /></a>
          </span>
        </footer>
      </main>
    </div>
  );
}

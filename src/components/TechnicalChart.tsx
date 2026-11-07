import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import type { Copy } from '@/i18n/copy';
import { compact, lots, pct, taipeiTime, twd } from '@/lib/format';
import { aggregateIntradayCandles } from '@/lib/intraday';
import { aggregateCandles, classifyCandlePatterns, classifyVolumeBars, countBackLevels, movingAverage, type CandleType, type VolumeType } from '@/lib/technical';
import type { Candle, Lang } from '@/lib/types';
import { clampViewport, panViewport, zoomViewport, type Viewport } from '@/lib/viewport';

export type ChartMode = 'oneDay' | 'oneWeek' | 'day' | 'week' | 'month';
const MODES: ChartMode[] = ['oneDay', 'oneWeek', 'day', 'week', 'month'];
const DEFAULT_COUNT: Record<ChartMode, number> = { oneDay: 60, oneWeek: 5, day: 70, week: 52, month: 24 };
const MIN_COUNT_FOR_MODE = 5;
const CANDLE_KEYS: CandleType[] = ['doji', 'longLower', 'longUpper'];
const VOLUME_KEYS: VolumeType[] = ['high', 'low', 'double', 'flat', 'shrink', 'increase'];
// Only the notable bars get a marker on the chart; every bar is still classified in the table.
const MARKED_VOLUME: VolumeType[] = ['high', 'double', 'low'];

// Geometry in SVG units; the SVG scales to its container.
const W = 960, H = 430, LEFT = 8, RIGHT = 68, TOP = 36, PRICE_BOTTOM = 296, VOLUME_TOP = 312, BOTTOM = 400;

interface Props {
  candles: Candle[];
  intradayCandles: Candle[];
  lang: Lang;
  t: Copy;
  loading?: boolean;
}

export function TechnicalChart({ candles, intradayCandles, lang, t, loading = false }: Props) {
  const [mode, setMode] = useState<ChartMode>('day');
  const [viewport, setViewport] = useState<Viewport | null>(null); // null = follow the latest bar
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startEnd: number; moved: boolean; pinchDistance?: number; pinchCount?: number; pinchAnchor?: number } | null>(null);
  const tc = t.chart;
  const isShort = mode === 'oneDay' || mode === 'oneWeek';

  // Narrow screens start with fewer bars so candles stay legible.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 640));
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const defaultCount = Math.max(MIN_COUNT_FOR_MODE, Math.round(DEFAULT_COUNT[mode] * (narrow ? 0.5 : 1)));

  const base = useMemo<Candle[]>(() => {
    if (mode === 'oneDay') return aggregateIntradayCandles(intradayCandles, 5);
    return aggregateCandles(candles, mode === 'oneWeek' ? 'day' : mode);
  }, [candles, intradayCandles, mode]);

  const view = useMemo(() => clampViewport(viewport ?? { end: base.length, count: defaultCount }, base.length), [viewport, base.length, defaultCount]);
  const start = Math.max(0, view.end - view.count);
  const periods = base.slice(start, view.end);

  const ma5 = useMemo(() => (isShort ? [] : movingAverage(base, 5)), [base, isShort]);
  const ma10 = useMemo(() => (isShort ? [] : movingAverage(base, 10)), [base, isShort]);
  const ma20 = useMemo(() => (isShort ? [] : movingAverage(base, 20)), [base, isShort]);
  const candleSignals = useMemo(() => classifyCandlePatterns(base), [base]);
  const volumeSignals = useMemo(() => classifyVolumeBars(base), [base]);
  const cbl = useMemo(() => (isShort ? { support: null, resistance: null } : countBackLevels(periods)), [periods, isShort]);
  const hasVolume = periods.some((item) => (item.volume ?? 0) > 0);

  const changeMode = (next: ChartMode) => { setMode(next); setViewport(null); setSelectedKey(null); setHover(null); };
  const pan = useCallback((bars: number) => setViewport((current) => panViewport(current ?? { end: base.length, count: defaultCount }, bars, base.length)), [base.length, defaultCount]);
  const zoom = useCallback((factor: number, anchorFraction = 1) => setViewport((current) => zoomViewport(current ?? { end: base.length, count: defaultCount }, factor, base.length, anchorFraction)), [base.length, defaultCount]);

  // Wheel must be registered non-passively to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * W;
      const fraction = Math.min(1, Math.max(0, (x - LEFT) / (W - LEFT - RIGHT)));
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) pan(Math.sign(event.deltaX || event.deltaY) * Math.max(1, Math.round(view.count / 12)));
      else zoom(event.deltaY > 0 ? 1.18 : 1 / 1.18, fraction);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [pan, zoom, view.count]);

  const plotWidth = W - LEFT - RIGHT;
  const slot = plotWidth / Math.max(periods.length, 1);
  const bodyWidth = Math.max(1.5, Math.min(14, slot * 0.62));
  const highs = periods.map((item) => item.high ?? item.close), lows = periods.map((item) => item.low ?? item.close);
  const visibleLines = isShort ? [] : [ma5, ma10, ma20].flatMap((line) => line.slice(start, view.end).map((point) => point?.value ?? null)).filter((value): value is number => value != null);
  const rawMin = Math.min(...lows, ...visibleLines, cbl.support?.value ?? Infinity);
  const rawMax = Math.max(...highs, ...visibleLines, cbl.resistance?.value ?? -Infinity);
  const spread = Math.max(rawMax - rawMin, rawMax * 0.01, 0.01);
  const min = Math.max(0, rawMin - spread * 0.06), max = rawMax + spread * 0.06;
  const maxVolume = Math.max(...periods.map((item) => item.volume ?? 0), 1);
  const x = (index: number) => LEFT + slot * index + slot / 2;
  const y = (value: number) => PRICE_BOTTOM - ((value - min) / (max - min || 1)) * (PRICE_BOTTOM - TOP);
  const priceAt = (py: number) => min + ((PRICE_BOTTOM - py) / (PRICE_BOTTOM - TOP)) * (max - min);
  const volumeY = (value: number | null) => BOTTOM - ((value ?? 0) / maxVolume) * (BOTTOM - VOLUME_TOP);
  const indexAt = (px: number) => Math.min(periods.length - 1, Math.max(0, Math.floor((px - LEFT) / slot)));

  const toSvg = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toSvg(event);
    pointers.current.set(event.pointerId, point);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { startX: point.x, startEnd: view.end, moved: true, pinchDistance: Math.abs(a.x - b.x), pinchCount: view.count, pinchAnchor: ((a.x + b.x) / 2 - LEFT) / plotWidth };
      setHover(null);
    } else {
      gesture.current = { startX: point.x, startEnd: view.end, moved: false };
    }
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toSvg(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    const state = gesture.current;
    if (state && pointers.current.size === 2 && state.pinchDistance) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.max(10, Math.abs(a.x - b.x));
      const nextCount = Math.round((state.pinchCount ?? view.count) * (state.pinchDistance / distance));
      const anchorIndex = state.startEnd - (state.pinchCount ?? view.count) + (state.pinchAnchor ?? 1) * (state.pinchCount ?? view.count);
      setViewport(clampViewport({ end: Math.round(anchorIndex + (1 - (state.pinchAnchor ?? 1)) * nextCount), count: nextCount }, base.length));
      return;
    }
    if (state && pointers.current.has(event.pointerId)) {
      const dx = point.x - state.startX;
      if (Math.abs(dx) > 3 || state.moved) {
        state.moved = true;
        setDragging(true);
        setHover(null);
        setViewport(clampViewport({ end: state.startEnd - Math.round(dx / slot), count: view.count }, base.length));
        return;
      }
    }
    if (point.x >= LEFT && point.x <= W - RIGHT && periods.length) setHover({ index: indexAt(point.x), y: point.y });
    else setHover(null);
  };
  const endGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    const state = gesture.current;
    const point = toSvg(event);
    pointers.current.delete(event.pointerId);
    if (state && !state.moved && point.x >= LEFT && point.x <= W - RIGHT && periods.length) {
      const bar = periods[indexAt(point.x)];
      setSelectedKey((current) => (current === bar.date ? null : bar.date));
    }
    if (pointers.current.size === 0) { gesture.current = null; setDragging(false); }
    else gesture.current = { startX: point.x, startEnd: view.end, moved: true };
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); pan(-Math.max(1, Math.round(view.count / 10))); }
    if (event.key === 'ArrowRight') { event.preventDefault(); pan(Math.max(1, Math.round(view.count / 10))); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1 / 1.25); }
    if (event.key === '-') { event.preventDefault(); zoom(1.25); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setViewport(null); }
  };

  const selectedIndex = selectedKey ? periods.findIndex((item) => item.date === selectedKey) : -1;
  const activeIndex = hover?.index ?? (selectedIndex >= 0 ? selectedIndex : periods.length - 1);
  const active = periods[activeIndex];
  const previousBar = activeIndex > 0 ? periods[activeIndex - 1] : base[start - 1];
  const activeChange = active && previousBar?.close ? (active.close / previousBar.close - 1) * 100 : null;
  const activeCandle = candleSignals[start + activeIndex];
  const activeVolume = volumeSignals[start + activeIndex];
  const label = (bar: Candle | undefined, withTime = mode === 'oneDay') => (!bar ? '—' : withTime ? taipeiTime(bar.timestamp ?? bar.date, lang, false) : bar.date.slice(0, 10));

  const gridValues = periods.length ? Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4) : [];
  const tickEvery = Math.max(1, Math.ceil(periods.length / 7));
  const supportLabel = cbl.support?.method === 'range' ? tc.rangeSupport : tc.support;
  const resistanceLabel = cbl.resistance?.method === 'range' ? tc.rangeResistance : tc.resistance;
  const linePath = (line: Array<{ value: number } | null>) => {
    let started = false;
    return line.slice(start, view.end).map((point, index) => {
      if (!point) return '';
      const command = started ? 'L' : 'M';
      started = true;
      return `${command}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`;
    }).filter(Boolean).join(' ');
  };
  const showMarkers = periods.length <= 120;
  const tableRows = periods.slice(-12).reverse();

  return (
    <section className="section chart" aria-label={tc.title}>
      <div className="section-head">
        <div><h3>{tc.title}</h3><small>{isShort ? tc.shortNote : tc.cblNote}</small></div>
        <div className="chart-toolbar">
          <div className="segmented" role="tablist" aria-label={tc.title}>
            {MODES.map((key) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'active' : ''} onClick={() => changeMode(key)}>{tc.modes[key]}</button>)}
          </div>
          <div className="chart-nav" aria-label={tc.hint}>
            <button type="button" onClick={() => pan(-Math.max(1, Math.round(view.count / 4)))} aria-label={tc.panLeft} title={tc.panLeft}><ChevronLeft size={14} /></button>
            <button type="button" onClick={() => pan(Math.max(1, Math.round(view.count / 4)))} aria-label={tc.panRight} title={tc.panRight}><ChevronRight size={14} /></button>
            <button type="button" onClick={() => zoom(1 / 1.3)} aria-label={tc.zoomIn} title={tc.zoomIn}><Plus size={14} /></button>
            <button type="button" onClick={() => zoom(1.3)} aria-label={tc.zoomOut} title={tc.zoomOut}><Minus size={14} /></button>
            <button type="button" onClick={() => setViewport(null)} aria-label={tc.reset} title={tc.reset}><RotateCcw size={13} />{tc.bars(periods.length)}</button>
          </div>
        </div>
      </div>

      <div className="chart-frame">
        {active ? (
          <div className="chart-readout num" aria-live="polite">
            <span><b>{label(active)}</b></span>
            <span>{tc.open} <b>{twd(active.open)}</b></span>
            <span>{tc.high} <b>{twd(active.high)}</b></span>
            <span>{tc.low} <b>{twd(active.low)}</b></span>
            <span>{tc.close} <b>{twd(active.close)}</b></span>
            <span className={(activeChange ?? 0) > 0 ? 'gain' : (activeChange ?? 0) < 0 ? 'loss' : ''}>{pct(activeChange)}</span>
            {hasVolume ? <span>{tc.volume} <b>{mode === 'oneDay' ? compact(active.volume) : lots(active.volume)}</b></span> : null}
          </div>
        ) : null}
        <svg ref={svgRef} className={`chart-svg ${dragging ? 'dragging' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={`${tc.title} ${tc.modes[mode]} ${tc.bars(periods.length)}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endGesture} onPointerCancel={endGesture} onPointerLeave={() => { if (!gesture.current) setHover(null); }} onKeyDown={onKeyDown}>
          {!periods.length ? <text x={W / 2} y={H / 2} textAnchor="middle">{loading ? '…' : tc.empty}</text> : null}
          {gridValues.map((value) => <g key={value}><line className="grid" x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} /><text x={W - RIGHT + 6} y={y(value) + 3.5}>{value >= 1000 ? value.toFixed(0) : value.toFixed(value >= 100 ? 1 : 2)}</text></g>)}
          {hasVolume ? <line className="divider" x1={LEFT} x2={W - RIGHT} y1={VOLUME_TOP - 8} y2={VOLUME_TOP - 8} /> : null}
          {selectedIndex >= 0 ? <rect className="selected-band" x={x(selectedIndex) - slot / 2} y={TOP - 6} width={slot} height={BOTTOM - TOP + 6} /> : null}
          {cbl.support ? <line className={`cbl support ${cbl.support.method}`} x1={x(cbl.support.startIndex)} x2={W - RIGHT} y1={y(cbl.support.value)} y2={y(cbl.support.value)} /> : null}
          {cbl.resistance ? <line className={`cbl resistance ${cbl.resistance.method}`} x1={x(cbl.resistance.startIndex)} x2={W - RIGHT} y1={y(cbl.resistance.value)} y2={y(cbl.resistance.value)} /> : null}
          {periods.map((item, index) => {
            const open = item.open ?? item.close, high = item.high ?? item.close, low = item.low ?? item.close;
            const up = item.close >= open;
            const bodyTop = y(Math.max(open, item.close)), bodyHeight = Math.max(1.2, Math.abs(y(open) - y(item.close)));
            const volumeSignal = volumeSignals[start + index];
            return (
              <g key={item.date} className={`candle ${up ? 'up' : 'down'}`}>
                <line x1={x(index)} x2={x(index)} y1={y(high)} y2={y(low)} />
                <rect className="body" x={x(index) - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} />
                {hasVolume ? <rect className={`vol ${up ? 'up' : 'down'} ${volumeSignal?.primary && MARKED_VOLUME.includes(volumeSignal.primary) ? 'marked' : ''}`} x={x(index) - bodyWidth / 2} y={volumeY(item.volume)} width={bodyWidth} height={Math.max(1, BOTTOM - volumeY(item.volume))} /> : null}
              </g>
            );
          })}
          {hasVolume ? <path className="vol-avg" d={volumeSignals.slice(start, view.end).map((signal, index) => signal.average == null ? '' : `${index && volumeSignals[start + index - 1]?.average != null ? 'L' : 'M'}${x(index).toFixed(1)},${volumeY(signal.average).toFixed(1)}`).filter(Boolean).join(' ')} /> : null}
          {!isShort ? <><path className="ma ma5" d={linePath(ma5)} /><path className="ma ma10" d={linePath(ma10)} /><path className="ma ma20" d={linePath(ma20)} /></> : null}
          {showMarkers ? candleSignals.slice(start, view.end).map((signal, index) => {
            if (!signal.type) return null;
            const item = periods[index];
            const above = signal.type !== 'longLower';
            const anchor = above ? y(item.high ?? item.close) - 12 : y(item.low ?? item.close) + 12;
            return (
              <g key={`cp-${item.date}`} className={`marker ${signal.type}`}>
                <title>{`${tc.candlePatterns[signal.type].name}｜${tc.candleContexts[signal.context]}｜${tc.candleConfirmations[signal.confirmation]}`}</title>
                <circle cx={x(index)} cy={anchor} r={6} />
                <text x={x(index)} y={anchor + 3} textAnchor="middle">{tc.candlePatterns[signal.type].short}</text>
              </g>
            );
          }) : null}
          {showMarkers && hasVolume ? volumeSignals.slice(start, view.end).map((signal, index) => {
            if (!signal.primary || !MARKED_VOLUME.includes(signal.primary)) return null;
            const item = periods[index];
            const anchor = Math.max(VOLUME_TOP, volumeY(item.volume) - 9);
            return (
              <g key={`vp-${item.date}`} className="marker vol">
                <title>{signal.types.map((key) => tc.volumePatterns[key].name).join('、')}</title>
                <circle cx={x(index)} cy={anchor} r={5.5} />
                <text x={x(index)} y={anchor + 3} textAnchor="middle">{tc.volumePatterns[signal.primary].short}</text>
              </g>
            );
          }) : null}
          {periods.map((item, index) => (index % tickEvery === 0 || index === periods.length - 1) && (index === periods.length - 1 ? (periods.length - 1) % tickEvery > tickEvery / 2 || periods.length <= tickEvery : true)
            ? <text key={`tick-${item.date}`} x={x(index)} y={H - 10} textAnchor="middle">{mode === 'oneDay' ? taipeiTime(item.timestamp ?? item.date, lang, false) : item.date.slice(mode === 'month' ? 0 : 5, mode === 'month' ? 7 : 10)}</text>
            : null)}
          {cbl.support ? <g className="level-tag"><rect x={W - RIGHT + 2} y={y(cbl.support.value) - 9} width={RIGHT - 6} height={18} rx={4} /><text x={W - RIGHT + 6} y={y(cbl.support.value) + 3.5}>{cbl.support.value >= 1000 ? cbl.support.value.toFixed(0) : cbl.support.value.toFixed(2)}</text></g> : null}
          {cbl.resistance ? <g className="level-tag"><rect x={W - RIGHT + 2} y={y(cbl.resistance.value) - 9} width={RIGHT - 6} height={18} rx={4} /><text x={W - RIGHT + 6} y={y(cbl.resistance.value) + 3.5}>{cbl.resistance.value >= 1000 ? cbl.resistance.value.toFixed(0) : cbl.resistance.value.toFixed(2)}</text></g> : null}
          {hover && active ? (
            <g className="crosshair" pointerEvents="none">
              <line x1={x(hover.index)} x2={x(hover.index)} y1={TOP - 6} y2={BOTTOM} />
              {hover.y >= TOP && hover.y <= PRICE_BOTTOM ? <>
                <line x1={LEFT} x2={W - RIGHT} y1={hover.y} y2={hover.y} />
                <rect x={W - RIGHT + 2} y={hover.y - 9} width={RIGHT - 6} height={18} rx={4} />
                <text x={W - RIGHT + 6} y={hover.y + 3.5}>{priceAt(hover.y) >= 1000 ? priceAt(hover.y).toFixed(0) : priceAt(hover.y).toFixed(2)}</text>
              </> : null}
              <rect x={Math.min(W - RIGHT - 84, Math.max(LEFT, x(hover.index) - 42))} y={H - 22} width={84} height={18} rx={4} />
              <text x={Math.min(W - RIGHT - 84, Math.max(LEFT, x(hover.index) - 42)) + 42} y={H - 9} textAnchor="middle">{label(active)}</text>
            </g>
          ) : null}
        </svg>
      </div>

      <div className="chart-legend">
        {!isShort ? <><span><i style={{ background: 'var(--ma5)' }} />MA5 <b className="num">{twd(ma5[start + activeIndex]?.value)}</b></span><span><i style={{ background: 'var(--ma10)' }} />MA10 <b className="num">{twd(ma10[start + activeIndex]?.value)}</b></span><span><i style={{ background: 'var(--ma20)' }} />MA20 <b className="num">{twd(ma20[start + activeIndex]?.value)}</b></span></> : null}
        {cbl.support ? <span><i className="dash" style={{ color: 'var(--down)' }} />{supportLabel} <b className="num">{twd(cbl.support.value)}</b></span> : null}
        {cbl.resistance ? <span><i className="dash" style={{ color: 'var(--up)' }} />{resistanceLabel} <b className="num">{twd(cbl.resistance.value)}</b></span> : null}
        {hasVolume ? <span><i className="dash" style={{ color: 'var(--ink-2)' }} />{tc.averageVolume}</span> : null}
        <span style={{ marginLeft: 'auto' }}>{tc.hint}</span>
      </div>
      {mode === 'oneDay' ? <p className="fineprint">{tc.oneDayNote}</p> : null}

      {active ? (
        <div className="pattern-summary">
          <div className="pattern-card">
            <span>{tc.candlePattern}</span>
            <b>{activeCandle?.type ? tc.candlePatterns[activeCandle.type].name : tc.noPattern}</b>
            <div className="row"><span>{tc.context}</span><b>{tc.candleContexts[activeCandle?.context ?? 'neutral']}</b></div>
            <div className="row"><span>{tc.confirmation}</span><b>{tc.candleConfirmations[activeCandle?.confirmation ?? 'none']}</b></div>
          </div>
          {hasVolume ? (
            <div className="pattern-card">
              <span>{tc.volumePattern}</span>
              <div className="chip-row">{activeVolume?.types.length ? activeVolume.types.map((key) => <span key={key} className="chip"><i>{tc.volumePatterns[key].short}</i>{tc.volumePatterns[key].name}</span>) : <b>{tc.normalVolume}</b>}</div>
              <div className="row"><span>{tc.versusPrevious}</span><b className="num">{activeVolume?.previousRatio == null ? '—' : `${activeVolume.previousRatio.toFixed(2)}×`}</b></div>
              <div className="row"><span>{tc.versusAverage}</span><b className="num">{activeVolume?.averageRatio == null ? '—' : `${activeVolume.averageRatio.toFixed(2)}×`}</b></div>
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="guide">
        <summary>{tc.guide}</summary>
        <div className="guide-grid">
          {CANDLE_KEYS.map((key) => <div key={key} className="guide-item"><b><span className={`chip ${key}`}><i>{tc.candlePatterns[key].short}</i></span>{tc.candlePatterns[key].name}</b><code>{tc.candlePatterns[key].rule}</code><span>{tc.candlePatterns[key].read}</span></div>)}
          {VOLUME_KEYS.map((key) => <div key={key} className="guide-item"><b><span className="chip"><i>{tc.volumePatterns[key].short}</i></span>{tc.volumePatterns[key].name}</b><code>{tc.volumePatterns[key].rule}</code><span>{tc.volumePatterns[key].read}</span></div>)}
        </div>
        <p className="fineprint" style={{ padding: '0 14px 14px' }}>{tc.disclaimer}</p>
      </details>

      {tableRows.length ? (
        <div className="period-table-wrap">
          <table className="period-table num">
            <thead><tr><th>{mode === 'oneDay' ? tc.time : tc.date}</th><th>{tc.open}</th><th>{tc.high}</th><th>{tc.low}</th><th>{tc.close}</th><th>{tc.change}</th><th>{tc.candlePattern}</th>{hasVolume ? <><th>{tc.volumePattern}</th><th>{tc.volume}</th></> : null}</tr></thead>
            <tbody>
              {tableRows.map((item) => {
                const index = periods.indexOf(item);
                const prior = index > 0 ? periods[index - 1] : base[start - 1];
                const change = prior?.close ? (item.close / prior.close - 1) * 100 : null;
                const candleSignal = candleSignals[start + index], volumeSignal = volumeSignals[start + index];
                return (
                  <tr key={item.date} className={item.date === selectedKey ? 'selected' : ''} onClick={() => setSelectedKey(item.date)}>
                    <td>{label(item)}</td><td>{twd(item.open)}</td><td>{twd(item.high)}</td><td>{twd(item.low)}</td><td><b>{twd(item.close)}</b></td>
                    <td className={(change ?? 0) > 0 ? 'gain' : (change ?? 0) < 0 ? 'loss' : ''}>{pct(change)}</td>
                    <td>{candleSignal?.type ? <span className={`chip ${candleSignal.type}`}><i>{tc.candlePatterns[candleSignal.type].short}</i></span> : '—'}</td>
                    {hasVolume ? <><td>{volumeSignal?.types.length ? volumeSignal.types.map((key) => tc.volumePatterns[key].short).join(' ') : '—'}</td><td>{mode === 'oneDay' ? compact(item.volume) : lots(item.volume)}</td></> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

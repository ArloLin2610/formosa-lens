// Chart viewport math: a window of `count` bars ending at `end` over a series
// of `total` bars. Shared by the chart's drag, wheel, pinch and key handlers.

export interface Viewport { end: number; count: number }

export const MIN_BARS = 5;

export function clampViewport(viewport: Viewport, total: number, minBars = MIN_BARS): Viewport {
  const count = Math.max(minBars, Math.min(Math.round(viewport.count), Math.max(total, minBars)));
  const end = Math.max(Math.min(count, total), Math.min(Math.round(viewport.end), total));
  return { end, count };
}

/** Shift the window by `bars` (positive = towards newer data). */
export const panViewport = (viewport: Viewport, bars: number, total: number): Viewport =>
  clampViewport({ ...viewport, end: viewport.end + bars }, total);

/**
 * Scale the window by `factor` (>1 zooms out) keeping the bar under
 * `anchorFraction` (0 = left edge, 1 = right edge) in place.
 */
export function zoomViewport(viewport: Viewport, factor: number, total: number, anchorFraction = 1): Viewport {
  const current = clampViewport(viewport, total);
  const nextCount = Math.round(current.count * factor);
  const anchorIndex = current.end - current.count + anchorFraction * current.count;
  const nextStart = anchorIndex - anchorFraction * nextCount;
  return clampViewport({ end: nextStart + nextCount, count: nextCount }, total);
}

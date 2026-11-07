import { describe, expect, test } from 'vitest';
import { clampViewport, panViewport, zoomViewport } from '@/lib/viewport';

describe('chart viewport', () => {
  test('clamps to the series and the minimum bar count', () => {
    expect(clampViewport({ end: 500, count: 70 }, 220)).toEqual({ end: 220, count: 70 });
    expect(clampViewport({ end: 10, count: 70 }, 220)).toEqual({ end: 70, count: 70 });
    expect(clampViewport({ end: 220, count: 2 }, 220)).toEqual({ end: 220, count: 5 });
    expect(clampViewport({ end: 220, count: 900 }, 220)).toEqual({ end: 220, count: 220 });
    expect(clampViewport({ end: 50, count: 70 }, 3)).toEqual({ end: 3, count: 5 });
  });
  test('pans towards older data and stops at the first bar', () => {
    expect(panViewport({ end: 220, count: 70 }, -30, 220)).toEqual({ end: 190, count: 70 });
    expect(panViewport({ end: 80, count: 70 }, -30, 220)).toEqual({ end: 70, count: 70 });
    expect(panViewport({ end: 200, count: 70 }, 60, 220)).toEqual({ end: 220, count: 70 });
  });
  test('zooms around the anchor bar', () => {
    // zooming in anchored at the right edge keeps the latest bar in view
    expect(zoomViewport({ end: 220, count: 70 }, 0.5, 220, 1)).toEqual({ end: 220, count: 35 });
    // anchored at the centre, the middle bar stays in the middle
    const zoomed = zoomViewport({ end: 200, count: 100 }, 0.5, 220, 0.5);
    expect(zoomed).toEqual({ end: 175, count: 50 });
    expect(zoomed.end - zoomed.count / 2).toBe(150);
    // zooming out past the series shows everything
    expect(zoomViewport({ end: 220, count: 200 }, 2, 220)).toEqual({ end: 220, count: 220 });
  });
});

// Browser persistence for user settings (watchlist, lens, language, theme).
// Everything stays on the device; export/import moves it between browsers.

import { LENSES } from './scoring';
import type { Lang, Lens } from './types';

export type Theme = 'system' | 'light' | 'dark';

export interface UserSettings {
  version: 2;
  watchlist: string[];
  lang: Lang;
  lens: Lens;
  theme: Theme;
  selectedTicker: string;
  pageSize: number;
  updatedAt: string;
}

export const STORAGE_KEY = 'formosa-lens:settings:v2';
const LEGACY_KEY = 'formosa-lens-guest-data-v1';
const TICKER = /^\d{4,6}$/;

export const defaultSettings = (): UserSettings => ({
  version: 2, watchlist: ['2330', '2454', '2317'], lang: 'zh', lens: 'balanced', theme: 'system',
  selectedTicker: '2330', pageSize: 50, updatedAt: new Date(0).toISOString(),
});

export function sanitizeSettings(input: unknown): UserSettings {
  const base = defaultSettings();
  if (!input || typeof input !== 'object') return base;
  const data = input as Record<string, unknown>;
  const watchlist = Array.isArray(data.watchlist)
    ? Array.from(new Set(data.watchlist.map((value) => String(value)).filter((value) => TICKER.test(value)))).slice(0, 300)
    : base.watchlist;
  const pageSize = Number(data.pageSize);
  return {
    version: 2,
    watchlist,
    lang: data.lang === 'en' ? 'en' : 'zh',
    lens: LENSES.includes(data.lens as Lens) ? (data.lens as Lens) : 'balanced',
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system',
    selectedTicker: TICKER.test(String(data.selectedTicker ?? '')) ? String(data.selectedTicker) : base.selectedTicker,
    pageSize: [25, 50, 100].includes(pageSize) ? pageSize : 50,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : base.updatedAt,
  };
}

export function loadSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: UserSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, updatedAt: new Date().toISOString() }));
  } catch { /* storage may be unavailable in private windows */ }
}

export const exportSettings = (settings: UserSettings): string => JSON.stringify({ app: 'formosa-lens', ...settings }, null, 2);

export function importSettings(text: string): UserSettings {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a Formosa Lens settings file');
  return sanitizeSettings(parsed);
}

// Number and time formatting with cached Intl instances.

import type { Lang } from './types';

const formatters = new Map<string, Intl.NumberFormat>();
const numberFormat = (digits: number, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat => {
  const key = `${digits}:${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits, ...options });
    formatters.set(key, formatter);
  }
  return formatter;
};

export const num = (value: number | null | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value) ? '—' : numberFormat(digits).format(value);

export const twd = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value) ? '—' : numberFormat(digits, { minimumFractionDigits: Math.min(digits, value >= 1000 ? 0 : 2) }).format(value);

export const pct = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${numberFormat(digits).format(value)}%`;

export const compact = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : numberFormat(1, { notation: 'compact' }).format(value);

/** Shares -> 張 (lots of 1,000 shares), the unit Taiwanese investors read volume in. */
export const lots = (shares: number | null | undefined): string =>
  shares == null || !Number.isFinite(shares) ? '—' : numberFormat(0).format(Math.round(shares / 1000));

export const ratio = (value: number | null | undefined): string => (value == null ? '—' : `${value.toFixed(2)}×`);

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormat = (lang: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const key = `${lang}:${JSON.stringify(options)}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', hourCycle: 'h23', ...options });
    timeFormatters.set(key, formatter);
  }
  return formatter;
};

export const taipeiTime = (value: string | number | Date | null | undefined, lang: Lang = 'zh', seconds = true): string => {
  if (value == null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return timeFormat(lang, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(date);
};

export const taipeiDateTime = (value: string | number | Date | null | undefined, lang: Lang = 'zh'): string => {
  if (value == null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return timeFormat(lang, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
};

export const shortDate = (iso: string): string => (iso.length >= 10 ? iso.slice(5, 10) : iso);

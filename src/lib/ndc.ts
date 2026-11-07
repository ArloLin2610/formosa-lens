// National Development Council business-cycle signal: CSV parsing and the
// last verified official records used when the live download fails.

import type { SignalKey, SignalRecord } from './types';

const SIGNAL_KEYS: Record<string, SignalKey> = { 藍: 'blue', 黃藍: 'yellowBlue', 綠: 'green', 黃紅: 'yellowRed', 紅: 'red' };

export const SIGNAL_BANDS: Array<{ key: SignalKey; min: number; max: number; zh: string; en: string }> = [
  { key: 'blue', min: 9, max: 16, zh: '藍燈', en: 'Blue' },
  { key: 'yellowBlue', min: 17, max: 22, zh: '黃藍燈', en: 'Yellow-blue' },
  { key: 'green', min: 23, max: 31, zh: '綠燈', en: 'Green' },
  { key: 'yellowRed', min: 32, max: 37, zh: '黃紅燈', en: 'Yellow-red' },
  { key: 'red', min: 38, max: 45, zh: '紅燈', en: 'Red' },
];

export const signalKeyForScore = (score: number): SignalKey =>
  SIGNAL_BANDS.find((band) => score >= band.min && score <= band.max)?.key ?? (score < 9 ? 'blue' : 'red');

/** Last verified official release (2026-10-29 download). Refresh with `npm run refresh:ndc`. */
export const FALLBACK_SIGNAL_HISTORY: SignalRecord[] = [
  { month: '2025/10', score: 35, signalKey: 'yellowRed', signalZh: '黃紅' },
  { month: '2025/11', score: 37, signalKey: 'yellowRed', signalZh: '黃紅' },
  { month: '2025/12', score: 38, signalKey: 'red', signalZh: '紅' },
  { month: '2026/01', score: 39, signalKey: 'red', signalZh: '紅' },
  { month: '2026/02', score: 41, signalKey: 'red', signalZh: '紅' },
  { month: '2026/03', score: 39, signalKey: 'red', signalZh: '紅' },
  { month: '2026/04', score: 40, signalKey: 'red', signalZh: '紅' },
  { month: '2026/05', score: 39, signalKey: 'red', signalZh: '紅' },
  { month: '2026/06', score: 41, signalKey: 'red', signalZh: '紅' },
  { month: '2026/07', score: 41, signalKey: 'red', signalZh: '紅' },
  { month: '2026/08', score: 40, signalKey: 'red', signalZh: '紅' },
  { month: '2026/09', score: 41, signalKey: 'red', signalZh: '紅' },
];

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(value.trim()); value = '';
    } else value += character;
  }
  fields.push(value.trim());
  return fields;
}

/** Parse the official 景氣指標與燈號.csv; returns the newest `limit` published months in ascending order. */
export function parseNdcSignalCsv(csv: string, limit = 12): SignalRecord[] {
  const lines = String(csv ?? '').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const dateIndex = headers.indexOf('Date');
  const scoreIndex = headers.indexOf('景氣對策信號綜合分數');
  const signalIndex = headers.indexOf('景氣對策信號');
  if ([dateIndex, scoreIndex, signalIndex].some((index) => index < 0)) return [];

  return lines.slice(1).map((line): SignalRecord | null => {
    const fields = parseCsvLine(line);
    const date = fields[dateIndex];
    const score = Number(fields[scoreIndex]);
    const signalZh = String(fields[signalIndex] ?? '').replace(/燈/g, '').trim();
    if (!/^\d{6}$/.test(date) || !Number.isFinite(score) || score < 9 || score > 45) return null;
    return { month: `${date.slice(0, 4)}/${date.slice(4, 6)}`, score, signalKey: SIGNAL_KEYS[signalZh] ?? signalKeyForScore(score), signalZh };
  }).filter((record): record is SignalRecord => record !== null)
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-limit);
}

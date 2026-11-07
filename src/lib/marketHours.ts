// Taipei trading-session awareness, used to pace polling: every 30 seconds
// while the market is open, every few minutes around it, hourly otherwise.

const TAIPEI_OFFSET_MS = 8 * 3_600_000;

export interface TaipeiClock {
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since Taipei midnight
  date: string; // YYYY-MM-DD in Taipei
}

export function taipeiClock(now: number = Date.now()): TaipeiClock {
  const shifted = new Date(now + TAIPEI_OFFSET_MS);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

export type SessionPhase = 'open' | 'preOpen' | 'afterClose' | 'closed';

/** Regular session 09:00-13:30, with the 13:30-13:35 closing match treated as open. Holidays are not modelled. */
export function sessionPhase(now: number = Date.now()): SessionPhase {
  const { weekday, minutes } = taipeiClock(now);
  if (weekday === 0 || weekday === 6) return 'closed';
  if (minutes >= 8 * 60 + 30 && minutes < 9 * 60) return 'preOpen';
  if (minutes >= 9 * 60 && minutes <= 13 * 60 + 35) return 'open';
  if (minutes > 13 * 60 + 35 && minutes < 15 * 60) return 'afterClose';
  return 'closed';
}

export const QUOTE_INTERVAL_MS: Record<SessionPhase, number> = {
  open: 30_000,
  preOpen: 60_000,
  afterClose: 5 * 60_000,
  closed: 30 * 60_000,
};

export const quoteRefreshInterval = (now: number = Date.now(), hidden = false): number => {
  const base = QUOTE_INTERVAL_MS[sessionPhase(now)];
  return hidden ? Math.max(base, 5 * 60_000) : base;
};

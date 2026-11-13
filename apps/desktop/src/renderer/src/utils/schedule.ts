import type { Language } from '../../../shared/types';

export interface ScheduleLike {
  enabled: boolean;
  startTime: string;
  stopTime?: string;
  days?: number[];
}

export interface ScheduleWindowState {
  enabled: boolean;
  active: boolean;
  waiting: boolean;
  remainingMs: number | null;
}

const DAY_MINUTES = 24 * 60;

function parseMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total < DAY_MINUTES ? total : null;
}

function runsOnDay(days: number[] | undefined, weekday: number): boolean {
  return !days || days.length === 0 || days.includes(weekday);
}

/** Computes whether a schedule is currently inside its active window and milliseconds to next transition. */
export function getScheduleWindowState(schedule: ScheduleLike | undefined, now = new Date()): ScheduleWindowState {
  if (!schedule?.enabled) {
    return { enabled: false, active: false, waiting: false, remainingMs: null };
  }

  const startMin = parseMinutes(schedule.startTime);
  if (startMin === null) {
    return { enabled: true, active: false, waiting: false, remainingMs: null };
  }

  const stopMin = parseMinutes(schedule.stopTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  if (stopMin !== null && stopMin !== startMin) {
    if (startMin < stopMin) {
      if (nowMin >= startMin && nowMin < stopMin && runsOnDay(schedule.days, today)) {
        const stopAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(stopMin / 60), stopMin % 60, 0, 0);
        return { enabled: true, active: true, waiting: false, remainingMs: Math.max(0, stopAt.getTime() - now.getTime()) };
      }
    } else {
      // Window crosses midnight (e.g. 22:00 -> 06:00)
      if (nowMin >= startMin && runsOnDay(schedule.days, today)) {
        const stopAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, Math.floor(stopMin / 60), stopMin % 60, 0, 0);
        return { enabled: true, active: true, waiting: false, remainingMs: Math.max(0, stopAt.getTime() - now.getTime()) };
      }
      if (nowMin < stopMin && runsOnDay(schedule.days, (today + 6) % 7)) {
        const stopAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(stopMin / 60), stopMin % 60, 0, 0);
        return { enabled: true, active: true, waiting: false, remainingMs: Math.max(0, stopAt.getTime() - now.getTime()) };
      }
    }
  }

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      Math.floor(startMin / 60),
      startMin % 60,
      0,
      0
    );
    if (candidate.getTime() > now.getTime() && runsOnDay(schedule.days, candidate.getDay())) {
      return {
        enabled: true,
        active: false,
        waiting: true,
        remainingMs: candidate.getTime() - now.getTime(),
      };
    }
  }

  return { enabled: true, active: false, waiting: true, remainingMs: null };
}

/** Formats remaining schedule milliseconds as a concise human-readable duration. */
export function formatScheduleCountdown(ms: number | null, language: Language): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const totalMins = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMins / DAY_MINUTES);
  const hours = Math.floor((totalMins % DAY_MINUTES) / 60);
  const mins = totalMins % 60;

  if (language === 'fa') {
    if (days > 0) return hours > 0 ? `${days} روز و ${hours} ساعت` : `${days} روز`;
    if (hours > 0) return mins > 0 ? `${hours} ساعت و ${mins} دقیقه` : `${hours} ساعت`;
    return `${mins} دقیقه`;
  }

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}


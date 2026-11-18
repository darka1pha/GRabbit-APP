export interface ScheduleWindowConfig {
  enabled?: boolean;
  startTime?: string;
  stopTime?: string;
  /** Weekdays (0 = Sunday … 6 = Saturday). Empty or omitted = every day. */
  days?: number[];
}

function parseMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Returns true if `now` falls inside the configured schedule window (respecting `days` and
 * overnight windows like 22:00 -> 06:00).
 */
export function isScheduleWindowActive(schedule: ScheduleWindowConfig | undefined, now = new Date()): boolean {
  if (!schedule?.enabled) return false;
  const startMin = parseMinutes(schedule.startTime);
  if (startMin === null) return false;
  const stopMin = parseMinutes(schedule.stopTime);

  const days = schedule.days;
  const hasDayFilter = Array.isArray(days) && days.length > 0;
  const today = now.getDay();
  const yesterday = (today + 6) % 7;
  const currentMin = now.getHours() * 60 + now.getMinutes();

  if (stopMin === null || startMin === stopMin) {
    if (hasDayFilter && !days.includes(today)) return false;
    return currentMin >= startMin;
  }

  if (startMin < stopMin) {
    if (hasDayFilter && !days.includes(today)) return false;
    return currentMin >= startMin && currentMin < stopMin;
  }

  // Overnight window (e.g. 22:00 -> 08:00)
  if (currentMin >= startMin) {
    return !hasDayFilter || days.includes(today);
  }
  if (currentMin < stopMin) {
    return !hasDayFilter || days.includes(yesterday);
  }
  return false;
}

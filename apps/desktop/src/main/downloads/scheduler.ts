/** A daily start time with an optional stop time, optionally limited to some weekdays. */
export interface Schedule {
  enabled: boolean;
  /** HH:MM, local time. '' = never starts. */
  startTime: string;
  /** HH:MM, or '' for no stop time. */
  stopTime: string;
  /** Weekdays (0 = Sunday … 6 = Saturday) on which the schedule starts. Missing or empty = every day. */
  days?: number[];
}

export type ScheduleAction = 'start' | 'stop';

const DAY_MINUTES = 24 * 60;

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < DAY_MINUTES ? minutes : null;
}

function runsOn(schedule: Schedule, weekday: number): boolean {
  return !schedule.days || schedule.days.length === 0 || schedule.days.includes(weekday);
}

/**
 * Is `now` inside the schedule's start–stop window? Windows may cross midnight (22:00–06:00);
 * the weekday that counts is the one the window started on. Returns null when the schedule has
 * no window (disabled, no start time, no stop time, or start equals stop).
 */
export function insideWindow(schedule: Schedule, now: Date): boolean | null {
  if (!schedule.enabled) return null;
  const start = minutesOf(schedule.startTime);
  const stop = minutesOf(schedule.stopTime);
  if (start === null || stop === null || start === stop) return null;

  const minute = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  if (start < stop) return minute >= start && minute < stop && runsOn(schedule, today);
  // Crosses midnight: the evening part belongs to today, the morning part to yesterday
  if (minute >= start) return runsOn(schedule, today);
  if (minute < stop) return runsOn(schedule, (today + 6) % 7);
  return false;
}

/** The most recent moment at or before `now` at which the schedule's start time occurred on a day it runs. */
function lastStart(schedule: Schedule, now: Date): Date | null {
  const start = minutesOf(schedule.startTime);
  if (start === null) return null;
  for (let back = 0; back <= 7; back++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, Math.floor(start / 60), start % 60, 0, 0);
    if (candidate.getTime() <= now.getTime() && runsOn(schedule, candidate.getDay())) return candidate;
  }
  return null;
}

/**
 * Turns schedules into start/stop actions as time passes.
 *
 * A schedule with a stop time is a window: the action follows the window, not the exact minute.
 * Launching the app (or waking the PC) part-way through a window still starts the downloads,
 * and the stop fires when the window is left. Nothing happens while the state does not change,
 * so pausing by hand inside a window sticks.
 *
 * A schedule without a stop time only starts: it fires when its start time passes while the
 * app is running, including a start time slept through since the previous tick.
 */
export class ScheduleTracker {
  private inside = new Map<string, boolean>();
  private lastTick = new Map<string, number>();

  public update(key: string, schedule: Schedule | undefined, now: Date): ScheduleAction | null {
    if (!schedule?.enabled) {
      this.forget(key);
      return null;
    }
    const previousTick = this.lastTick.get(key);
    this.lastTick.set(key, now.getTime());

    const inside = insideWindow(schedule, now);
    if (inside !== null) {
      const was = this.inside.get(key);
      this.inside.set(key, inside);
      if (inside && was !== true) return 'start';
      if (!inside && was === true) return 'stop';
      return null;
    }

    // Start-only schedule
    this.inside.delete(key);
    if (previousTick === undefined) return null;
    const started = lastStart(schedule, now);
    return started && started.getTime() > previousTick ? 'start' : null;
  }

  public forget(key: string): void {
    this.inside.delete(key);
    this.lastTick.delete(key);
  }
}

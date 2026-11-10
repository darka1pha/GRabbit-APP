import { describe, expect, it } from 'vitest';
import { insideWindow, ScheduleTracker, type Schedule } from '../src/main/downloads/scheduler';

/** 2026-11-09 is a Monday. */
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, day, h, m, 0, 0);
};
const night: Schedule = { enabled: true, startTime: '02:00', stopTime: '08:00' };
const overnight: Schedule = { enabled: true, startTime: '22:00', stopTime: '06:00' };

describe('insideWindow', () => {
  it('covers start (inclusive) to stop (exclusive)', () => {
    expect(insideWindow(night, at(9, '01:59'))).toBe(false);
    expect(insideWindow(night, at(9, '02:00'))).toBe(true);
    expect(insideWindow(night, at(9, '07:59'))).toBe(true);
    expect(insideWindow(night, at(9, '08:00'))).toBe(false);
  });

  it('handles windows that cross midnight', () => {
    expect(insideWindow(overnight, at(9, '21:59'))).toBe(false);
    expect(insideWindow(overnight, at(9, '23:30'))).toBe(true);
    expect(insideWindow(overnight, at(10, '05:59'))).toBe(true);
    expect(insideWindow(overnight, at(10, '06:00'))).toBe(false);
  });

  it('counts the weekday the window started on', () => {
    const mondays = { ...overnight, days: [1] };
    expect(insideWindow(mondays, at(9, '23:00'))).toBe(true); // Monday evening
    expect(insideWindow(mondays, at(10, '03:00'))).toBe(true); // Tuesday morning, started Monday
    expect(insideWindow(mondays, at(10, '23:00'))).toBe(false); // Tuesday evening
    expect(insideWindow(mondays, at(9, '03:00'))).toBe(false); // Monday morning belongs to Sunday
    expect(insideWindow({ ...night, days: [] }, at(9, '03:00'))).toBe(true); // empty = every day
  });

  it('has no window when disabled or without a stop time', () => {
    expect(insideWindow({ ...night, enabled: false }, at(9, '03:00'))).toBeNull();
    expect(insideWindow({ ...night, stopTime: '' }, at(9, '03:00'))).toBeNull();
    expect(insideWindow({ ...night, startTime: '' }, at(9, '03:00'))).toBeNull();
  });
});

describe('ScheduleTracker', () => {
  it('starts when the app launches part-way through the window', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '02:05'))).toBe('start');
    expect(tracker.update('q', night, at(9, '02:06'))).toBeNull();
  });

  it('does nothing when launched outside the window, then starts and stops once each', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '01:00'))).toBeNull();
    expect(tracker.update('q', night, at(9, '02:00'))).toBe('start');
    expect(tracker.update('q', night, at(9, '05:00'))).toBeNull();
    expect(tracker.update('q', night, at(9, '08:00'))).toBe('stop');
    expect(tracker.update('q', night, at(9, '08:01'))).toBeNull();
  });

  it('starts after waking from sleep inside the window', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '00:30'))).toBeNull();
    // asleep from 00:30 to 04:00
    expect(tracker.update('q', night, at(9, '04:00'))).toBe('start');
  });

  it('stops after sleeping past the end of the window', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '03:00'))).toBe('start');
    expect(tracker.update('q', night, at(9, '11:00'))).toBe('stop');
  });

  it('does not act when a whole window was slept through', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '01:00'))).toBeNull();
    expect(tracker.update('q', night, at(9, '09:00'))).toBeNull();
  });

  it('skips days that are not selected', () => {
    const tracker = new ScheduleTracker();
    const weekdaysOnly = { ...night, days: [1, 2, 3, 4, 5] };
    expect(tracker.update('q', weekdaysOnly, at(8, '03:00'))).toBeNull(); // Sunday
    expect(tracker.update('q', weekdaysOnly, at(9, '03:00'))).toBe('start'); // Monday
  });

  it('start-only schedules fire when the start time passes, including while asleep, but not at launch', () => {
    const startOnly: Schedule = { enabled: true, startTime: '02:00', stopTime: '' };
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', startOnly, at(9, '14:00'))).toBeNull(); // launched long after
    expect(tracker.update('q', startOnly, at(10, '01:59'))).toBeNull();
    expect(tracker.update('q', startOnly, at(10, '02:00'))).toBe('start');
    expect(tracker.update('q', startOnly, at(10, '02:01'))).toBeNull();
    // slept through the next start
    expect(tracker.update('q', startOnly, at(11, '07:00'))).toBe('start');
  });

  it('forgets a schedule that is switched off, so switching it on inside the window starts again', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('q', night, at(9, '03:00'))).toBe('start');
    expect(tracker.update('q', { ...night, enabled: false }, at(9, '03:01'))).toBeNull();
    expect(tracker.update('q', night, at(9, '03:02'))).toBe('start');
  });

  it('tracks schedules independently', () => {
    const tracker = new ScheduleTracker();
    expect(tracker.update('a', night, at(9, '03:00'))).toBe('start');
    expect(tracker.update('b', overnight, at(9, '03:00'))).toBe('start');
    expect(tracker.update('a', night, at(9, '07:00'))).toBeNull();
    expect(tracker.update('b', overnight, at(9, '07:00'))).toBe('stop');
  });
});

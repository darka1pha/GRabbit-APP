import { describe, expect, it } from 'vitest';
import { formatScheduleCountdown, getScheduleWindowState } from '../../src/renderer/src/utils/schedule';

describe('Schedule Window Status Helpers', () => {
  it('returns disabled state when schedule is turned off', () => {
    const res = getScheduleWindowState({ enabled: false, startTime: '08:00', stopTime: '18:00' }, new Date(2026, 0, 1, 10, 0));
    expect(res).toEqual({ enabled: false, active: false, waiting: false, remainingMs: null });
  });

  it('detects active daytime window and computes remaining stop time', () => {
    const now = new Date(2026, 10, 13, 14, 30, 0, 0);
    const res = getScheduleWindowState({ enabled: true, startTime: '08:00', stopTime: '16:00' }, now);
    expect(res.enabled).toBe(true);
    expect(res.active).toBe(true);
    expect(res.waiting).toBe(false);
    expect(res.remainingMs).toBe(90 * 60_000);
  });

  it('handles overnight midnight-crossing windows accurately before and after midnight', () => {
    const lateNight = new Date(2026, 10, 13, 23, 30, 0, 0); // Friday 23:30
    const res1 = getScheduleWindowState({ enabled: true, startTime: '22:00', stopTime: '06:00', days: [5] }, lateNight);
    expect(res1.active).toBe(true);
    expect(res1.remainingMs).toBe(6.5 * 60 * 60_000);

    const earlyMorning = new Date(2026, 10, 14, 2, 0, 0, 0); // Saturday 02:00 (started Friday day=5)
    const res2 = getScheduleWindowState({ enabled: true, startTime: '22:00', stopTime: '06:00', days: [5] }, earlyMorning);
    expect(res2.active).toBe(true);
    expect(res2.remainingMs).toBe(4 * 60 * 60_000);
  });

  it('computes countdown until next allowed weekday start when inactive', () => {
    const now = new Date(2026, 10, 13, 10, 0, 0, 0); // Friday (day 5)
    const res = getScheduleWindowState({ enabled: true, startTime: '22:00', stopTime: '06:00', days: [5] }, now);
    expect(res.active).toBe(false);
    expect(res.waiting).toBe(true);
    expect(res.remainingMs).toBe(12 * 60 * 60_000);
  });

  it('formats countdowns cleanly in English and Persian', () => {
    expect(formatScheduleCountdown(45 * 60_000, 'en')).toBe('45m');
    expect(formatScheduleCountdown(135 * 60_000, 'en')).toBe('2h 15m');
    expect(formatScheduleCountdown(45 * 60_000, 'fa')).toBe('45 دقیقه');
    expect(formatScheduleCountdown(135 * 60_000, 'fa')).toBe('2 ساعت و 15 دقیقه');
  });
});


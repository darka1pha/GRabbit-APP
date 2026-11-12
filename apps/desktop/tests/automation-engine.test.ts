import { describe, expect, it } from 'vitest';
import { isArchive, runCustomCommand } from '../src/main/downloads/automation';
import { insideWindow } from '../src/main/downloads/scheduler';
import { RateLimiter } from '../src/main/downloads/throttle';

describe('Post-Download Automation & Rules Engine', () => {
  describe('isArchive', () => {
    it('accurately identifies archive extensions', () => {
      expect(isArchive('archive.zip')).toBe(true);
      expect(isArchive('backup.tar.gz')).toBe(true);
      expect(isArchive('bundle.tgz')).toBe(true);
      expect(isArchive('data.tar.bz2')).toBe(true);
      expect(isArchive('raw.tar')).toBe(true);
      expect(isArchive('movie.mp4')).toBe(false);
      expect(isArchive('document.pdf')).toBe(false);
      expect(isArchive('installer.exe')).toBe(false);
    });
  });

  describe('runCustomCommand', () => {
    it('interpolates tokens cleanly and executes command', async () => {
      const vars = {
        filePath: 'C:\\downloads\\test.zip',
        fileName: 'test.zip',
        directory: 'C:\\downloads',
        category: 'compressed',
        fileSize: 1048576,
      };

      const result = await runCustomCommand('echo {fileName} ({fileSize} bytes)', vars);
      expect(result.success).toBe(true);
      expect(result.output).toContain('test.zip (1048576 bytes)');
    });

    it('gracefully handles failing commands', async () => {
      const result = await runCustomCommand('non_existent_command_12345', {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Bandwidth Speed Scheduling', () => {
    it('applies throttled speed limit inside scheduled window and removes it outside', () => {
      const limiter = new RateLimiter(0); // 0 = unlimited default
      const speedSchedule = {
        enabled: true,
        startTime: '09:00',
        stopTime: '18:00',
        speedLimitKBps: 500, // 500 KB/s
      };

      // Inside window at 12:00
      const insideDate = new Date(2026, 10, 12, 12, 0, 0);
      const isInside = insideWindow(speedSchedule, insideDate);
      expect(isInside).toBe(true);

      const targetRate = isInside ? speedSchedule.speedLimitKBps * 1024 : 0;
      limiter.setRate(targetRate);
      expect(limiter.rate).toBe(500 * 1024);

      // Outside window at 21:00
      const outsideDate = new Date(2026, 10, 12, 21, 0, 0);
      const isOutside = !insideWindow(speedSchedule, outsideDate);
      expect(isOutside).toBe(true);

      const outsideRate = insideWindow(speedSchedule, outsideDate) ? speedSchedule.speedLimitKBps * 1024 : 0;
      limiter.setRate(outsideRate);
      expect(limiter.rate).toBe(0); // Restored to unthrottled
    });

    it('handles midnight-crossing speed schedule windows (e.g. 23:00 to 07:00)', () => {
      const nightSchedule = {
        enabled: true,
        startTime: '23:00',
        stopTime: '07:00',
        speedLimitKBps: 2000,
      };

      // Late night at 23:30 -> inside
      const lateNight = new Date(2026, 10, 12, 23, 30, 0);
      expect(insideWindow(nightSchedule, lateNight)).toBe(true);

      // Early morning at 03:00 -> inside
      const earlyMorning = new Date(2026, 10, 13, 3, 0, 0);
      expect(insideWindow(nightSchedule, earlyMorning)).toBe(true);

      // Daytime at 14:00 -> outside
      const dayTime = new Date(2026, 10, 13, 14, 0, 0);
      expect(insideWindow(nightSchedule, dayTime)).toBe(false);
    });
  });
});

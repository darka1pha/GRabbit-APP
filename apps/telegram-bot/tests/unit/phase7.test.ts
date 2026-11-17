import { describe, expect, it } from 'vitest';
import { extractUrlAndTimeRange } from '@grabbit/core';
import { createFormatSelectionKeyboard } from '../../src/bot/keyboards/index.js';

describe('Telegram Bot Phase 7 features', () => {
  it('extracts URL and time range from user messages', () => {
    const parsed = extractUrlAndTimeRange('https://www.youtube.com/watch?v=dQw4w9WgXcQ 01:10-02:05');
    expect(parsed.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(parsed.timeRange).toBe('01:10-02:05');
  });

  it('includes Subtitles (.srt) button when video options are present', () => {
    const kb = createFormatSelectionKeyboard({
      locale: 'en',
      jobKey: 'abc123',
      mediaOptions: [
        { format: 'audio', qualityId: 'mp3', label: 'MP3', extension: 'mp3' },
        { format: 'video', qualityId: '720p', label: '720p', extension: 'mp4' },
      ],
    });
    const callbacks = kb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : undefined));
    expect(callbacks).toContain('dl:abc123:document:subtitles');
  });
});

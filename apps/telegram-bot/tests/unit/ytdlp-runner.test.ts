import { describe, it, expect, vi } from 'vitest';
import { YtDlpRunner } from '../../src/services/downloads/ytdlp-runner.js';
import {
  DownloadError,
  MediaUnavailableError,
  UnauthorizedContentError,
} from '../../src/core/errors/domain-errors.js';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('YtDlpRunner', () => {
  function createMockProcess(stdout: string, stderr: string, exitCode: number) {
    const emitter = new EventEmitter() as any;
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();

    setTimeout(() => {
      if (stdout) emitter.stdout.emit('data', Buffer.from(stdout));
      if (stderr) emitter.stderr.emit('data', Buffer.from(stderr));
      emitter.emit('close', exitCode);
    }, 10);

    return emitter;
  }

  it('successfully fetches and parses metadata', async () => {
    const mockMeta = {
      id: 'abc12345',
      title: 'Sample Video',
      channel: 'Sample Channel',
      duration: 120,
    };

    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      createMockProcess(JSON.stringify(mockMeta), '', 0)
    );

    const runner = new YtDlpRunner();
    const meta = await runner.getMetadata('https://www.youtube.com/watch?v=abc12345');

    expect(meta.id).toBe('abc12345');
    expect(meta.title).toBe('Sample Video');
    expect(meta.channel).toBe('Sample Channel');
  });

  it('searches YouTube via ytsearch5 and parses newline-delimited JSON results', async () => {
    const stdout = [
      JSON.stringify({
        id: 'vid001',
        title: 'The Weeknd - Blinding Lights',
        channel: 'The Weeknd',
        duration: 200,
        url: 'https://www.youtube.com/watch?v=vid001',
      }),
      JSON.stringify({
        id: 'vid002',
        title: 'Blinding Lights (Live)',
        uploader: 'VEVO',
        duration: 215,
      }),
    ].join('\n');

    vi.mocked(childProcess.spawn).mockReturnValueOnce(createMockProcess(stdout, '', 0));

    const runner = new YtDlpRunner();
    const results = await runner.search('The Weeknd Blinding Lights', 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'vid001',
      title: 'The Weeknd - Blinding Lights',
      channel: 'The Weeknd',
      duration: 200,
      url: 'https://www.youtube.com/watch?v=vid001',
      thumbnail: undefined,
    });
    expect(results[1].url).toBe('https://www.youtube.com/watch?v=vid002');
  });

  it('parses download progress lines with colons in ETA and returns final file path', async () => {
    const stdout = [
      'GRABBIT_PROGRESS| 45.5%|01:23| 5.40MiB/s',
      '/tmp/test-output/video-abc12345.mp4',
      '',
    ].join('\n');

    vi.mocked(childProcess.spawn).mockReturnValueOnce(createMockProcess(stdout, '', 0));

    const progresses: Array<{ percent: number; eta?: string; speed?: string }> = [];
    const runner = new YtDlpRunner();
    const filePath = await runner.downloadMedia({
      url: 'https://www.youtube.com/watch?v=abc12345',
      outputTemplate: '/tmp/test-output/%(title)s.%(ext)s',
      onProgress: (p) => {
        progresses.push(p);
      },
    });

    expect(filePath).toBe('/tmp/test-output/video-abc12345.mp4');
    expect(progresses).toEqual([
      {
        percent: 45.5,
        eta: '01:23',
        speed: '5.40MiB/s',
      },
    ]);
  });

  it('throws MediaUnavailableError for removed or unavailable content', async () => {
    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      createMockProcess('', 'ERROR: Video unavailable. This video has been removed.', 1)
    );

    const runner = new YtDlpRunner();
    await expect(runner.getMetadata('https://youtube.com/watch?v=missing')).rejects.toThrow(
      MediaUnavailableError
    );
  });

  it('throws UnauthorizedContentError for private or login-required media', async () => {
    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      createMockProcess('', 'ERROR: Private video. Sign in if you have been granted access', 1)
    );

    const runner = new YtDlpRunner();
    await expect(runner.getMetadata('https://youtube.com/watch?v=private')).rejects.toThrow(
      UnauthorizedContentError
    );
  });

  it('throws UnauthorizedContentError with DRM i18n key for DRM-protected media', async () => {
    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      createMockProcess('', 'ERROR: [youtube] abc123: This video is DRM protected', 1)
    );

    const runner = new YtDlpRunner();
    await expect(runner.getMetadata('https://youtube.com/watch?v=abc123')).rejects.toMatchObject({
      i18nKey: 'error-drm-protected',
    });
  });

  it('throws DownloadError for unexpected process failure', async () => {
    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      createMockProcess('', 'Unknown internal network socket timeout', 1)
    );

    const runner = new YtDlpRunner();
    await expect(runner.getMetadata('https://youtube.com/watch?v=broken')).rejects.toThrow(
      DownloadError
    );
  });
});

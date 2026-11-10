import { describe, it, expect, vi, beforeEach } from 'vitest';
import { base64ToBytes, compareSemver, md5Hex, sha1Hex, sha256Hex } from '@grabbit/utils';
import { detectCategory, mobileDownloadManager } from '../services/download-manager';
import { extractYouTubeVideoId, mobileBridge } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';
import { mobileRecognizer } from '../services/recognizer';

// Mock expo-file-system and expo-media-library
vi.mock('expo-file-system', () => ({
  documentDirectory: '/mock/grabbit/',
  cacheDirectory: '/mock/cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: vi.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  readAsStringAsync: vi.fn().mockResolvedValue('[]'),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
  createDownloadResumable: vi.fn().mockReturnValue({
    downloadAsync: vi.fn().mockResolvedValue({ uri: '/mock/file.mp4' }),
    pauseAsync: vi.fn().mockResolvedValue(undefined),
    resumeAsync: vi.fn().mockResolvedValue({ uri: '/mock/file.mp4' }),
  }),
}));

vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  saveToLibraryAsync: vi.fn().mockResolvedValue(undefined),
}));

describe('Mobile App Desktop Feature Parity', () => {
  describe('Category Auto-Detection', () => {
    it('detects video categories correctly', () => {
      expect(detectCategory('https://example.com/video.mp4')).toBe('video');
      expect(detectCategory('movie.mkv')).toBe('video');
      expect(detectCategory('clip.webm')).toBe('video');
    });

    it('detects music / audio categories correctly', () => {
      expect(detectCategory('song.mp3')).toBe('music');
      expect(detectCategory('track.flac')).toBe('music');
      expect(detectCategory('audio.m4a')).toBe('music');
    });

    it('detects documents, archives and programs', () => {
      expect(detectCategory('book.pdf')).toBe('documents');
      expect(detectCategory('data.csv')).toBe('documents');
      expect(detectCategory('archive.zip')).toBe('compressed');
      expect(detectCategory('bundle.tar.gz')).toBe('compressed');
      expect(detectCategory('app.apk')).toBe('programs');
      expect(detectCategory('installer.exe')).toBe('programs');
      expect(detectCategory('picture.png')).toBe('images');
      expect(detectCategory('unknown.xyz')).toBe('other');
    });

    it('uses mimeType when available', () => {
      expect(detectCategory('stream', 'video/mp4')).toBe('video');
      expect(detectCategory('stream', 'audio/mpeg')).toBe('music');
      expect(detectCategory('stream', 'application/pdf')).toBe('documents');
      expect(detectCategory('stream', 'application/zip')).toBe('compressed');
    });
  });

  describe('Download Queues Architecture', () => {
    it('has Main Queue and Scheduled Queue out of the box', () => {
      const queues = mobileDownloadManager.getAllQueues();
      expect(queues.some((q) => q.id === 'main' && q.enabled)).toBe(true);
      expect(queues.some((q) => q.id === 'scheduled')).toBe(true);
    });

    it('creates custom queues with daily scheduler configuration', () => {
      const custom = mobileDownloadManager.createQueue('Work Queue', {
        maxConcurrent: 4,
        scheduler: {
          enabled: true,
          startTime: '01:00',
          stopTime: '06:00',
        },
      });

      expect(custom.name).toBe('Work Queue');
      expect(custom.maxConcurrent).toBe(4);
      expect(custom.scheduler?.startTime).toBe('01:00');
      expect(mobileDownloadManager.getQueue(custom.id)).toBeDefined();
    });

    it('updates, starts and stops queues', () => {
      const custom = mobileDownloadManager.createQueue('Test Stop/Start');
      expect(custom.enabled).toBe(true);

      mobileDownloadManager.stopQueue(custom.id);
      expect(mobileDownloadManager.getQueue(custom.id)?.enabled).toBe(false);

      mobileDownloadManager.startQueue(custom.id);
      expect(mobileDownloadManager.getQueue(custom.id)?.enabled).toBe(true);

      mobileDownloadManager.updateQueue(custom.id, { maxConcurrent: 3 });
      expect(mobileDownloadManager.getQueue(custom.id)?.maxConcurrent).toBe(3);
    });

    it('moves tasks between queues', async () => {
      const taskId = await mobileDownloadManager.startHttpDownload({
        url: 'https://example.com/test.zip',
        startPaused: true,
      });

      const task = mobileDownloadManager.getTask(taskId);
      expect(task?.queueId).toBe('main');

      mobileDownloadManager.moveTaskToQueue(taskId, 'scheduled');
      expect(mobileDownloadManager.getTask(taskId)?.queueId).toBe('scheduled');
    });

    it('prevents deleting the main queue', () => {
      expect(() => mobileDownloadManager.deleteQueue('main')).toThrow();
    });
  });

  describe('Direct HTTP File Probing', () => {
    it('probes a URL and computes filename & category', async () => {
      const probe = await mobileDownloadManager.probeUrl('https://example.com/archive.zip');
      expect(probe.fileName).toBe('archive.zip');
      expect(probe.category).toBe('compressed');
    });
  });

  describe('Mobile Settings Manager', () => {
    it('reads defaults and updates settings cleanly', async () => {
      const settings = mobileSettingsManager.getSettings();
      expect(settings.defaultAudioFormat).toBe('mp3');
      expect(settings.maxConcurrent).toBeGreaterThanOrEqual(1);

      await mobileSettingsManager.updateSettings({
        maxConcurrent: 5,
        defaultAudioFormat: 'flac',
        desktopBridge: {
          enabled: true,
          host: '192.168.1.150',
          port: 31542,
          token: 'test-token-123',
        },
      });

      const updated = mobileSettingsManager.getSettings();
      expect(updated.maxConcurrent).toBe(5);
      expect(updated.defaultAudioFormat).toBe('flac');
      expect(updated.desktopBridge.enabled).toBe(true);
      expect(updated.desktopBridge.host).toBe('192.168.1.150');
      expect(updated.desktopBridge.token).toBe('test-token-123');
    });
  });

  describe('Music & Song Recognition', () => {
    it('manages recognition history and clears it', async () => {
      await mobileRecognizer.clearHistory();
      expect(mobileRecognizer.getHistory()).toEqual([]);
    });
  });

  describe('Cryptographic Checksums & Stream Extraction', () => {
    it('computes RFC-compliant MD5, SHA-1, and SHA-256 hex digests', () => {
      // "abc" in Base64 is "YWJj"
      const bytes = base64ToBytes('YWJj');
      expect(Array.from(bytes)).toEqual([97, 98, 99]);
      expect(md5Hex(bytes)).toBe('900150983cd24fb0d6963f7d28e17f72');
      expect(sha1Hex(bytes)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
      expect(sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('extracts YouTube video IDs from watch, shorts, and youtu.be URLs', () => {
      expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=123')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(extractYouTubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('resolves direct stream URL immediately when MediaOption carries directStreamUrl', async () => {
      const resolved = await mobileBridge.resolveDirectStreamUrl(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'youtube',
        {
          format: 'video',
          qualityId: '720p',
          label: '720p MP4',
          extension: 'mp4',
          estimatedSizeBytes: 5000000,
          directStreamUrl: 'https://rr1---sn.googlevideo.com/videoplayback?id=123',
        }
      );
      expect(resolved.streamUrl).toBe('https://rr1---sn.googlevideo.com/videoplayback?id=123');
      expect(resolved.sizeBytes).toBe(5000000);
    });

    it('compares semantic versions accurately for auto-updater', () => {
      expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
      expect(compareSemver('v2.0.0', '1.9.9')).toBe(1);
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', '1.2.0')).toBe(-1);
    });
  });
});


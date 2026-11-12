import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as FileSystem from 'expo-file-system';
import { base64ToBytes, compareSemver, md5Hex, sha1Hex, sha256Hex, createIncrementalHasher } from '@grabbit/utils';
import { detectCategory, mobileDownloadManager } from '../services/download-manager';
import { extractYouTubeVideoId, mobileBridge, resolverPool } from '../services/bridge';
import { mobileSettingsManager } from '../services/settings-manager';
import { mobileRecognizer } from '../services/recognizer';

// Mock react-native, expo-file-system and expo-media-library
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
  Platform: {
    OS: 'android',
  },
}));

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

  describe('Phase 4 Mobile Performance & Resilience', () => {
    it('creates honest single-stream download tasks', async () => {
      const id = await mobileDownloadManager.startDownload(
        {
          id: 'test-1',
          title: 'Test Song',
          platform: 'youtube',
          url: 'https://youtube.com/watch?v=123',
          isDownloadable: true,
          availableOptions: [],
        },
        {
          format: 'audio',
          qualityId: 'mp3',
          extension: 'mp3',
          label: 'Audio MP3',
          directStreamUrl: 'https://example.com/audio.mp3',
          estimatedSizeBytes: 1000,
        }
      );
      const task = mobileDownloadManager.getTask(id);
      expect(task).toBeDefined();
      expect(task?.connections).toBe(1);
      expect(task?.activeConnections).toBe(0);
      expect(task?.segments.length).toBe(1);
      expect(task?.segments[0].start).toBe(0);
    });

    it('manages fallback ordering and failure recording in resolverPool', () => {
      const mirrors = ['https://m1.com', 'https://m2.com', 'https://m3.com'];
      expect(resolverPool.getOrdered('twitter', mirrors)).toEqual(mirrors);

      resolverPool.markSuccess('twitter', 'https://m2.com');
      expect(resolverPool.getOrdered('twitter', mirrors)).toEqual([
        'https://m2.com',
        'https://m1.com',
        'https://m3.com',
      ]);

      resolverPool.markFailure('twitter', 'https://m2.com');
      expect(resolverPool.getOrdered('twitter', mirrors)).toEqual(mirrors);
    });

    it('produces actionable error directing users to pair with desktop when resolver fails', async () => {
      // Ensure desktop bridge is disabled for this test to test standalone failure message
      mobileSettingsManager.updateSettings({
        desktopBridge: {
          enabled: false,
          host: '',
          port: 31589,
          token: '',
        },
      });

      await expect(
        mobileBridge.resolveDirectStreamUrl(
          'https://unknown-service.com/video/123',
          'generic',
          {
            format: 'video',
            qualityId: '1080p',
            extension: 'mp4',
            label: '1080p',
          }
        )
      ).rejects.toThrow(/Resolver unavailable — pair with desktop/i);
    });

    it('verifies checksum via incremental hasher without loading entire file at once', async () => {
      const id = await mobileDownloadManager.startHttpDownload({
        url: 'https://example.com/test.bin',
        fileName: 'test.bin',
        startPaused: true,
      });
      const task = mobileDownloadManager.getTask(id);
      expect(task).toBeDefined();
      if (task) {
        task.status = 'completed';
        task.receivedBytes = 3;
      }

      // Mock FileSystem.getInfoAsync returning size & exists
      vi.spyOn(FileSystem, 'getInfoAsync').mockImplementation(async (_uri: string, opts?: any) => {
        if (opts?.md5) {
          return { exists: true, md5: '900150983cd24fb0d6963f7d28e17f72', size: 3 } as any;
        }
        return { exists: true, size: 3 } as any;
      });

      // 1. MD5 fast-path
      const md5Result = await mobileDownloadManager.verifyChecksum(id, 'md5', '900150983cd24fb0d6963f7d28e17f72');
      expect(md5Result.actual).toBe('900150983cd24fb0d6963f7d28e17f72');
      expect(md5Result.verified).toBe(true);

      // 2. Incremental SHA-256 chunked reading
      vi.spyOn(FileSystem, 'readAsStringAsync').mockResolvedValue('YWJj'); // "abc"
      const shaResult = await mobileDownloadManager.verifyChecksum(id, 'sha256');
      expect(shaResult.actual).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('supports chunked streaming hashes for MD5, SHA-1, and SHA-256', () => {
      // Stream "The quick brown fox jumps over the lazy dog" in arbitrary small chunks
      const text = 'The quick brown fox jumps over the lazy dog';
      const fullBytes = new TextEncoder().encode(text);

      const md5Hasher = createIncrementalHasher('md5');
      const sha1Hasher = createIncrementalHasher('sha1');
      const sha256Hasher = createIncrementalHasher('sha256');

      // Feed in 7-byte chunks
      for (let i = 0; i < fullBytes.length; i += 7) {
        const slice = fullBytes.subarray(i, i + 7);
        md5Hasher.update(slice);
        sha1Hasher.update(slice);
        sha256Hasher.update(slice);
      }

      expect(md5Hasher.digestHex()).toBe('9e107d9d372bb6826bd81d3542a419d6');
      expect(sha1Hasher.digestHex()).toBe('2fd4e1c67a2d28fced849ee1bb76e7391b93eb12');
      expect(sha256Hasher.digestHex()).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
    });
  });
});


import { describe, it, expect, vi } from 'vitest';
import { UserRepository } from '../../src/database/repositories/user-repository.js';
import { JobRepository } from '../../src/database/repositories/job-repository.js';
import { MediaCacheRepository } from '../../src/database/repositories/media-cache-repository.js';
import * as dbClient from '../../src/database/client.js';

describe('UserRepository Unit Tests', () => {
  const userRepo = new UserRepository();

  it('maps database rows to UserRecord properly', async () => {
    vi.spyOn(dbClient, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: '123456789',
          username: 'john_doe',
          first_name: 'John',
          last_name: 'Doe',
          language_code: 'fa',
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const user = await userRepo.getUser(123456789);
    expect(user).not.toBeNull();
    expect(user?.id).toBe(123456789);
    expect(user?.languageCode).toBe('fa');
    expect(user?.username).toBe('john_doe');
  });

  it('returns null when user does not exist', async () => {
    vi.spyOn(dbClient, 'query').mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const user = await userRepo.getUser(999999999);
    expect(user).toBeNull();
  });
});

describe('JobRepository Unit Tests', () => {
  const jobRepo = new JobRepository();

  it('creates and maps JobRecord correctly', async () => {
    vi.spyOn(dbClient, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 'job_test_1',
          user_id: '123456',
          chat_id: '987654',
          status_message_id: '111',
          platform: 'youtube',
          source_url: 'https://youtube.com/watch?v=123',
          media_id: '123',
          title: 'My Video',
          format: 'video',
          quality_id: '720p',
          locale_snapshot: 'en',
          status: 'queued',
          progress_percent: 0,
          file_size_bytes: null,
          duration_seconds: 120,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          completed_at: null,
        },
      ],
      rowCount: 1,
      command: 'INSERT',
      oid: 0,
      fields: [],
    });

    const created = await jobRepo.createJob({
      id: 'job_test_1',
      userId: 123456,
      chatId: 987654,
      statusMessageId: 111,
      platform: 'youtube',
      sourceUrl: 'https://youtube.com/watch?v=123',
      mediaId: '123',
      title: 'My Video',
      format: 'video',
      qualityId: '720p',
      localeSnapshot: 'en',
      status: 'queued',
      progressPercent: 0,
    });

    expect(created.id).toBe('job_test_1');
    expect(created.userId).toBe(123456);
    expect(created.status).toBe('queued');
    expect(created.localeSnapshot).toBe('en');
  });

  it('queries active jobs for a user with status filter', async () => {
    const querySpy = vi.spyOn(dbClient, 'query').mockResolvedValueOnce({
      rows: [
        {
          id: 'job_active_1',
          user_id: '555',
          chat_id: '555',
          status_message_id: null,
          platform: 'soundcloud',
          source_url: 'https://soundcloud.com/track',
          media_id: 'sc1',
          title: 'Song',
          format: 'audio',
          quality_id: 'bestaudio',
          locale_snapshot: 'fa',
          status: 'processing',
          progress_percent: 45,
          file_size_bytes: null,
          duration_seconds: 200,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          completed_at: null,
        },
      ],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const active = await jobRepo.getActiveUserJobs(555);
    expect(active.length).toBe(1);
    expect(active[0].status).toBe('processing');
    expect(active[0].localeSnapshot).toBe('fa');
    expect(querySpy.mock.calls[0][1]).toEqual([555]);
  });
});

describe('MediaCacheRepository Unit Tests', () => {
  const mediaRepo = new MediaCacheRepository();

  it('escapes LIKE wildcards and backslashes in searchCachedMedia', async () => {
    const querySpy = vi.spyOn(dbClient, 'query').mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    await mediaRepo.searchCachedMedia('100%_a\\b', 10);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0][0]).toContain("ESCAPE '\\'");
    expect(querySpy.mock.calls[0][1]).toEqual(['%100\\%\\_a\\\\b%', 10]);
  });
});

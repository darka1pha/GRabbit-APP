import { JobRecord } from '../../core/types/job.js';
import { JobStatus, PlatformId, MediaFormat, SupportedLocale } from '../../config/constants.js';
import { query } from '../client.js';

export interface IJobRepository {
  createJob(job: Omit<JobRecord, 'createdAt' | 'updatedAt'>): Promise<JobRecord>;
  updateJobStatus(id: string, status: JobStatus, updates?: Partial<JobRecord>): Promise<void>;
  getJob(id: string): Promise<JobRecord | null>;
  getActiveUserJobs(userId: number): Promise<JobRecord[]>;
  getRecentJobs(userId: number, limit?: number): Promise<JobRecord[]>;
}

export class JobRepository implements IJobRepository {
  public async createJob(job: Omit<JobRecord, 'createdAt' | 'updatedAt'>): Promise<JobRecord> {
    const sql = `
      INSERT INTO jobs (
        id, user_id, chat_id, status_message_id, platform, source_url,
        media_id, title, format, quality_id, locale_snapshot, status,
        progress_percent, file_size_bytes, duration_seconds, error,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
      )
      RETURNING *;
    `;

    const res = await query<JobRow>(sql, [
      job.id,
      job.userId,
      job.chatId,
      job.statusMessageId || null,
      job.platform,
      job.sourceUrl,
      job.mediaId,
      job.title,
      job.format,
      job.qualityId,
      job.localeSnapshot,
      job.status,
      job.progressPercent || 0,
      job.fileSizeBytes || null,
      job.durationSeconds || null,
      job.error || null,
    ]);

    return this.mapRow(res.rows[0]);
  }

  public async updateJobStatus(
    id: string,
    status: JobStatus,
    updates?: Partial<JobRecord>
  ): Promise<void> {
    const completedAt =
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? new Date()
        : null;

    const sql = `
      UPDATE jobs SET
        status = $1,
        progress_percent = COALESCE($2, progress_percent),
        file_size_bytes = COALESCE($3, file_size_bytes),
        duration_seconds = COALESCE($4, duration_seconds),
        error = COALESCE($5, error),
        status_message_id = COALESCE($6, status_message_id),
        completed_at = COALESCE($7, completed_at),
        updated_at = NOW()
      WHERE id = $8;
    `;

    await query(sql, [
      status,
      updates?.progressPercent !== undefined ? updates.progressPercent : null,
      updates?.fileSizeBytes || null,
      updates?.durationSeconds || null,
      updates?.error || null,
      updates?.statusMessageId || null,
      completedAt,
      id,
    ]);
  }

  public async getJob(id: string): Promise<JobRecord | null> {
    const res = await query<JobRow>('SELECT * FROM jobs WHERE id = $1;', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async getActiveUserJobs(userId: number): Promise<JobRecord[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE user_id = $1 AND status IN ('pending', 'queued', 'processing', 'uploading')
      ORDER BY created_at ASC;
    `;
    const res = await query<JobRow>(sql, [userId]);
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getRecentJobs(userId: number, limit = 10): Promise<JobRecord[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE user_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT $2;
    `;
    const res = await query<JobRow>(sql, [userId, limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getGlobalStats(): Promise<{
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    activeJobs: number;
    totalBytesDelivered: number;
    topPlatforms: { platform: string; count: number }[];
  }> {
    const summaryRes = await query<{
      total_jobs: string;
      completed_jobs: string;
      failed_jobs: string;
      active_jobs: string;
      total_bytes: string | null;
    }>(`
      SELECT
        COUNT(*) AS total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
        COUNT(*) FILTER (WHERE status IN ('pending', 'queued', 'processing', 'uploading')) AS active_jobs,
        COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'completed'), 0) AS total_bytes
      FROM jobs;
    `);

    const platformRes = await query<{ platform: string; count: string }>(`
      SELECT platform, COUNT(*) AS count
      FROM jobs
      GROUP BY platform
      ORDER BY count DESC
      LIMIT 5;
    `);

    const row = summaryRes.rows[0];
    return {
      totalJobs: Number(row?.total_jobs || 0),
      completedJobs: Number(row?.completed_jobs || 0),
      failedJobs: Number(row?.failed_jobs || 0),
      activeJobs: Number(row?.active_jobs || 0),
      totalBytesDelivered: Number(row?.total_bytes || 0),
      topPlatforms: platformRes.rows.map((r) => ({
        platform: r.platform,
        count: Number(r.count),
      })),
    };
  }

  /**
   * Failed jobs in the last `hours`, grouped by reason. The worker stores errors as
   * "[<i18n-key>] <message>"; older rows without a key are counted as "other".
   */
  public async getFailureReasons(
    hours = 24,
    limit = 5
  ): Promise<{ reason: string; count: number }[]> {
    const res = await query<{ reason: string; count: string }>(
      `
      SELECT COALESCE(substring(error from '^\\[([a-z0-9-]+)\\]'), 'other') AS reason,
             COUNT(*) AS count
      FROM jobs
      WHERE status = 'failed' AND updated_at > NOW() - make_interval(hours => $1)
      GROUP BY reason
      ORDER BY count DESC
      LIMIT $2;
    `,
      [hours, limit]
    );
    return res.rows.map((r) => ({ reason: r.reason, count: Number(r.count) }));
  }

  public async getAllActiveJobs(): Promise<JobRecord[]> {
    const sql = `
      SELECT * FROM jobs
      WHERE status IN ('pending', 'queued', 'processing', 'uploading')
      ORDER BY created_at ASC;
    `;
    const res = await query<JobRow>(sql);
    return res.rows.map((r) => this.mapRow(r));
  }

  public async getGlobalRecentJobs(limit = 8): Promise<JobRecord[]> {
    const sql = `
      SELECT * FROM jobs
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    const res = await query<JobRow>(sql, [limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: JobRow): JobRecord {
    return {
      id: row.id,
      userId: Number(row.user_id),
      chatId: Number(row.chat_id),
      statusMessageId: row.status_message_id ? Number(row.status_message_id) : undefined,
      platform: row.platform as PlatformId,
      sourceUrl: row.source_url,
      mediaId: row.media_id,
      title: row.title,
      format: row.format as MediaFormat,
      qualityId: row.quality_id,
      localeSnapshot: row.locale_snapshot as SupportedLocale,
      status: row.status as JobStatus,
      progressPercent: row.progress_percent,
      fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : undefined,
      durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
    };
  }
}

interface JobRow {
  id: string;
  user_id: string;
  chat_id: string;
  status_message_id: string | null;
  platform: string;
  source_url: string;
  media_id: string;
  title: string;
  format: string;
  quality_id: string;
  locale_snapshot: string;
  status: string;
  progress_percent: number;
  file_size_bytes: string | null;
  duration_seconds: number | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

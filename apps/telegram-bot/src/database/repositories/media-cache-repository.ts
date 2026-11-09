import { MediaFormat, PlatformId } from '../../config/constants.js';
import { query } from '../client.js';

export interface CachedMediaRecord {
  platform: PlatformId;
  mediaId: string;
  format: MediaFormat;
  qualityId: string;
  telegramFileId: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  title?: string;
  author?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MediaCacheRepository {
  public async getCachedMedia(
    platform: PlatformId,
    mediaId: string,
    format: MediaFormat,
    qualityId: string
  ): Promise<CachedMediaRecord | null> {
    const sql = `
      SELECT * FROM media_cache
      WHERE platform = $1 AND media_id = $2 AND format = $3 AND quality_id = $4
      LIMIT 1;
    `;
    const res = await query<MediaCacheRow>(sql, [platform, mediaId, format, qualityId]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async searchCachedMedia(searchQuery: string, limit = 10): Promise<CachedMediaRecord[]> {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      const sql = `
        SELECT * FROM media_cache
        ORDER BY updated_at DESC
        LIMIT $1;
      `;
      const res = await query<MediaCacheRow>(sql, [limit]);
      return res.rows.map((r) => this.mapRow(r));
    }

    const pattern = `%${trimmed}%`;
    const sql = `
      SELECT * FROM media_cache
      WHERE title ILIKE $1 OR author ILIKE $1 OR media_id ILIKE $1
      ORDER BY updated_at DESC
      LIMIT $2;
    `;
    const res = await query<MediaCacheRow>(sql, [pattern, limit]);
    return res.rows.map((r) => this.mapRow(r));
  }

  public async saveCachedMedia(entry: {
    platform: PlatformId;
    mediaId: string;
    format: MediaFormat;
    qualityId: string;
    telegramFileId: string;
    fileSizeBytes?: number;
    durationSeconds?: number;
    title?: string;
    author?: string;
  }): Promise<void> {
    const sql = `
      INSERT INTO media_cache (
        platform, media_id, format, quality_id, telegram_file_id,
        file_size_bytes, duration_seconds, title, author,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
      )
      ON CONFLICT (platform, media_id, format, quality_id) DO UPDATE SET
        telegram_file_id = EXCLUDED.telegram_file_id,
        file_size_bytes = COALESCE(EXCLUDED.file_size_bytes, media_cache.file_size_bytes),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, media_cache.duration_seconds),
        title = COALESCE(EXCLUDED.title, media_cache.title),
        author = COALESCE(EXCLUDED.author, media_cache.author),
        updated_at = NOW();
    `;
    await query(sql, [
      entry.platform,
      entry.mediaId,
      entry.format,
      entry.qualityId,
      entry.telegramFileId,
      entry.fileSizeBytes ?? null,
      entry.durationSeconds ? Math.round(entry.durationSeconds) : null,
      entry.title ?? null,
      entry.author ?? null,
    ]);
  }

  public async deleteCachedMedia(
    platform: PlatformId,
    mediaId: string,
    format: MediaFormat,
    qualityId: string
  ): Promise<void> {
    await query(
      'DELETE FROM media_cache WHERE platform = $1 AND media_id = $2 AND format = $3 AND quality_id = $4;',
      [platform, mediaId, format, qualityId]
    );
  }

  public async getCacheStats(): Promise<{ totalItems: number; totalBytes: number }> {
    const res = await query<{ total_items: string; total_bytes: string | null }>(`
      SELECT
        COUNT(*) AS total_items,
        COALESCE(SUM(file_size_bytes), 0) AS total_bytes
      FROM media_cache;
    `);
    const row = res.rows[0];
    return {
      totalItems: Number(row?.total_items || 0),
      totalBytes: Number(row?.total_bytes || 0),
    };
  }

  public async clearAllCache(): Promise<number> {
    const res = await query('DELETE FROM media_cache;');
    return res.rowCount || 0;
  }

  private mapRow(row: MediaCacheRow): CachedMediaRecord {
    return {
      platform: row.platform as PlatformId,
      mediaId: row.media_id,
      format: row.format as MediaFormat,
      qualityId: row.quality_id,
      telegramFileId: row.telegram_file_id,
      fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : undefined,
      durationSeconds: row.duration_seconds ? Number(row.duration_seconds) : undefined,
      title: row.title || undefined,
      author: row.author || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface MediaCacheRow {
  platform: string;
  media_id: string;
  format: string;
  quality_id: string;
  telegram_file_id: string;
  file_size_bytes: string | null;
  duration_seconds: number | null;
  title: string | null;
  author: string | null;
  created_at: Date;
  updated_at: Date;
}

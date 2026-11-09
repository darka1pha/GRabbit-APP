import { DefaultFormatPreference, UserRecord, UserTier } from '../../core/types/user.js';
import { SupportedLocale, DEFAULT_LOCALE } from '../../config/constants.js';
import { query } from '../client.js';

export interface IUserRepository {
  upsertUser(user: {
    id: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: SupportedLocale;
  }): Promise<UserRecord>;
  getUser(id: number): Promise<UserRecord | null>;
  updateLanguage(id: number, language: SupportedLocale): Promise<void>;
  updateDefaultFormat(id: number, defaultFormat: DefaultFormatPreference): Promise<void>;
  setUserBanned(id: number, isBanned: boolean): Promise<void>;
  setUserTier(id: number, tier: UserTier): Promise<void>;
}

export class UserRepository implements IUserRepository {
  public async upsertUser(user: {
    id: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: SupportedLocale;
  }): Promise<UserRecord> {
    const defaultLang = user.languageCode || DEFAULT_LOCALE;

    const sql = `
      INSERT INTO users (id, username, first_name, last_name, language_code, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW()
      RETURNING *;
    `;

    const res = await query<UserRow>(sql, [
      user.id,
      user.username || null,
      user.firstName || null,
      user.lastName || null,
      defaultLang,
    ]);

    return this.mapRow(res.rows[0]);
  }

  public async getUser(id: number): Promise<UserRecord | null> {
    const res = await query<UserRow>('SELECT * FROM users WHERE id = $1;', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async updateLanguage(id: number, language: SupportedLocale): Promise<void> {
    await query(
      'UPDATE users SET language_code = $1, language_selected = TRUE, updated_at = NOW() WHERE id = $2;',
      [language, id]
    );
  }

  public async updateDefaultFormat(
    id: number,
    defaultFormat: DefaultFormatPreference
  ): Promise<void> {
    await query(
      'UPDATE users SET default_format = $1, updated_at = NOW() WHERE id = $2;',
      [defaultFormat, id]
    );
  }

  public async setUserBanned(id: number, isBanned: boolean): Promise<void> {
    await query(
      'UPDATE users SET is_banned = $1, updated_at = NOW() WHERE id = $2;',
      [isBanned, id]
    );
  }

  public async setUserTier(id: number, tier: UserTier): Promise<void> {
    await query(
      'UPDATE users SET tier = $1, updated_at = NOW() WHERE id = $2;',
      [tier, id]
    );
  }

  public async getSetting(key: string): Promise<string | null> {
    try {
      const res = await query<{ value: string }>(
        'SELECT value FROM system_settings WHERE key = $1 LIMIT 1;',
        [key]
      );
      return res.rows[0]?.value ?? null;
    } catch {
      return null;
    }
  }

  public async setSetting(key: string, value: string | null): Promise<void> {
    if (!value) {
      await query('DELETE FROM system_settings WHERE key = $1;', [key]);
      return;
    }
    await query(
      `
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW();
      `,
      [key, value]
    );
  }

  public async getUserStats(): Promise<{
    totalUsers: number;
    activeLast24h: number;
    vipUsers: number;
    bannedUsers: number;
  }> {
    const res = await query<{
      total_users: string;
      active_24h: string;
      vip_users: string;
      banned_users: string;
    }>(`
      SELECT
        COUNT(*) AS total_users,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '24 hours') AS active_24h,
        COUNT(*) FILTER (WHERE tier = 'vip') AS vip_users,
        COUNT(*) FILTER (WHERE is_banned = TRUE) AS banned_users
      FROM users;
    `);
    const row = res.rows[0];
    return {
      totalUsers: Number(row?.total_users || 0),
      activeLast24h: Number(row?.active_24h || 0),
      vipUsers: Number(row?.vip_users || 0),
      bannedUsers: Number(row?.banned_users || 0),
    };
  }

  public async listUsers(
    limit = 8,
    offset = 0
  ): Promise<{ users: Array<UserRecord & { jobCount: number }>; total: number }> {
    const countRes = await query<{ total: string }>('SELECT COUNT(*) AS total FROM users;');
    const total = Number(countRes.rows[0]?.total || 0);

    const res = await query<UserRow & { job_count: string }>(
      `
      SELECT u.*, COUNT(j.id) AS job_count
      FROM users u
      LEFT JOIN jobs j ON j.user_id = u.id
      GROUP BY u.id
      ORDER BY u.updated_at DESC
      LIMIT $1 OFFSET $2;
    `,
      [limit, offset]
    );

    return {
      total,
      users: res.rows.map((r) => ({
        ...this.mapRow(r),
        jobCount: Number(r.job_count || 0),
      })),
    };
  }

  public async getAllUserIds(): Promise<number[]> {
    const res = await query<{ id: string }>(
      'SELECT id FROM users WHERE is_banned = FALSE ORDER BY created_at ASC;'
    );
    return res.rows.map((r) => Number(r.id));
  }

  private mapRow(row: UserRow): UserRecord {
    return {
      id: Number(row.id),
      username: row.username || undefined,
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      languageCode: row.language_code as SupportedLocale,
      languageSelected: Boolean(row.language_selected),
      isBanned: Boolean(row.is_banned),
      tier: (row.tier as UserTier) || 'free',
      defaultFormat: (row.default_format as DefaultFormatPreference) || 'ask',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface UserRow {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string;
  language_selected?: boolean;
  is_banned?: boolean;
  tier?: string;
  default_format?: string;
  created_at: Date;
  updated_at: Date;
}

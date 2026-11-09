import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getDatabasePool } from './client.js';
import { logger } from '../observability/logger.js';

export async function runMigrations(): Promise<void> {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows: appliedRows } = await client.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id ASC;'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    const migrationsDir = resolve(process.cwd(), 'src/database/migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        continue;
      }

      logger.info({ migration: file }, 'Applying database migration');
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1);', [file]);
    }

    await client.query('COMMIT');
    logger.info('All database migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to run database migrations');
    throw err;
  } finally {
    client.release();
  }
}

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabasePool } from './client.js';
import { logger } from '../observability/logger.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function resolveMigrationsDir(): string {
  const srcDir = resolve(PACKAGE_ROOT, 'src/database/migrations');
  if (existsSync(srcDir)) return srcDir;
  return resolve(PACKAGE_ROOT, 'dist/database/migrations');
}

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

    const migrationsDir = resolveMigrationsDir();
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

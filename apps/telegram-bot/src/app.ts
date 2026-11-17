import { Bot, webhookCallback } from 'grammy';
import { createServer } from 'node:http';
import { BotContext } from './bot/context.js';
import { createBot } from './bot/create-bot.js';
import { registerBotCommands } from './bot/commands/register-commands.js';
import { saveYouTubeCookiesFile } from './bot/commands/admin.js';
import { runMigrations } from './database/migrator.js';
import { closeDatabasePool } from './database/client.js';
import { UserRepository } from './database/repositories/user-repository.js';
import { closeRedisConnection } from './queue/redis.js';
import { closeMediaQueue } from './queue/queues.js';
import { MediaProcessingWorker } from './queue/workers/media-worker.js';
import { logger } from './observability/logger.js';
import { TempStorageManager } from './services/temp-storage/temp-storage-manager.js';
import { getConfig } from './config/env.js';
import type { Server } from 'node:http';
import { query } from './database/client.js';
import { getRedisConnection } from './queue/redis.js';
import { getMediaQueue } from './queue/queues.js';
import { startHealthServer } from './observability/health-server.js';

export class App {
  private bot: Bot<BotContext>;
  private worker: MediaProcessingWorker;
  private tempStorage: TempStorageManager;
  private staleCleanupTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private healthServer: Server | null = null;
  private webhookServer: Server | null = null;

  constructor() {
    this.bot = createBot();
    this.worker = new MediaProcessingWorker({ bot: this.bot as unknown as Bot });
    this.tempStorage = new TempStorageManager();
  }

  public async start(): Promise<void> {
    logger.info('Starting g(Rabbit) Application...');

    // 1. Validate environment configuration
    const config = getConfig();
    logger.info({ nodeEnv: config.NODE_ENV, logLevel: config.LOG_LEVEL }, 'Configuration validated');
    if (config.ADMIN_USER_IDS.length === 0) {
      logger.warn('ADMIN_USER_IDS is empty: admin commands are disabled until at least one admin ID is set');
    }

    // 2. Run Database Migrations
    try {
      await runMigrations();
      const userRepo = new UserRepository();
      const savedCookies = await userRepo.getSetting('youtube_cookies');
      if (savedCookies) {
        saveYouTubeCookiesFile(savedCookies);
        logger.info('Restored YouTube cookies.txt from database settings');
      }
    } catch (err) {
      logger.error({ err }, 'Failed during database migration on startup');
      throw err;
    }

    // 3. Health and metrics endpoint for Docker and monitoring
    if (config.HEALTH_PORT > 0) {
      this.healthServer = await startHealthServer(
        {
          checks: {
            redis: () => getRedisConnection().ping(),
            database: () => query('SELECT 1'),
          },
          jobCounts: () => getMediaQueue().getJobCounts(),
          isShuttingDown: () => this.isShuttingDown,
        },
        config.HEALTH_PORT,
        config.HEALTH_HOST
      );
    }

    // 3b. Start Background Media Worker
    this.worker.start();

    // 4. Setup periodic stale temp files cleanup
    this.staleCleanupTimer = setInterval(() => {
      this.tempStorage.cleanupStaleDirectories(config.TEMP_FILE_TTL_MINUTES);
    }, 10 * 60 * 1000).unref();

    // 5. Start Telegram Bot (Webhook if configured, else Long Polling) & Register Scoped Command Menus
    await registerBotCommands(this.bot);

    if (config.WEBHOOK_URL && config.WEBHOOK_PORT > 0) {
      const handleWebhook = webhookCallback(this.bot, 'http', {
        secretToken: config.WEBHOOK_SECRET,
      });
      this.webhookServer = createServer((req, res) => {
        void handleWebhook(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        this.webhookServer!.once('error', reject);
        this.webhookServer!.listen(config.WEBHOOK_PORT, '0.0.0.0', () => resolve());
      });
      await this.bot.api.setWebhook(config.WEBHOOK_URL, {
        secret_token: config.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result'],
      });
      logger.info({ webhookUrl: config.WEBHOOK_URL, port: config.WEBHOOK_PORT }, '🐰 g(Rabbit) Telegram Bot listening via webhook!');
    } else {
      this.bot.start({
        allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result'],
        onStart: (botInfo) => {
          logger.info(
            {
              botUsername: botInfo.username,
              botId: botInfo.id,
              supportsInlineQueries: botInfo.supports_inline_queries,
            },
            '🐰 g(Rabbit) Telegram Bot is now running and listening for updates!'
          );
        },
      });
    }

    this.registerSignalHandlers();
  }

  public async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info('Gracefully shutting down g(Rabbit)...');

    if (this.staleCleanupTimer) {
      clearInterval(this.staleCleanupTimer);
    }

    this.healthServer?.close();
    this.webhookServer?.close();

    // Stop bot polling
    try {
      await this.bot.stop();
      logger.info('Telegram bot polling stopped');
    } catch (err) {
      logger.warn({ err }, 'Error stopping Telegram bot');
    }

    // Stop queue worker
    try {
      await this.worker.close();
    } catch (err) {
      logger.warn({ err }, 'Error closing media worker');
    }

    // Close BullMQ queue & Redis
    try {
      await closeMediaQueue();
      await closeRedisConnection();
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis connections');
    }

    // Close PostgreSQL pool
    try {
      await closeDatabasePool();
    } catch (err) {
      logger.warn({ err }, 'Error closing database pool');
    }

    logger.info('g(Rabbit) has shut down gracefully');
  }

  private registerSignalHandlers(): void {
    const shutdown = async () => {
      await this.stop();
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}

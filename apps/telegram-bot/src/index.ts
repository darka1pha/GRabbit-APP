import { App } from './app.js';
import { logger } from './observability/logger.js';

const app = new App();

app.start().catch((err) => {
  logger.fatal({ err }, 'Application failed to start');
  process.exit(1);
});

import { createApp } from './app';
import { connectDb, bootstrapIndexes } from './config/db';
import { config, validateProductionSecrets } from './config';
import { startScheduler } from './jobs/scheduler';
import { logger } from './utils/logger';

async function main() {
  validateProductionSecrets();
  logger.info('api', { event: 'startup', nodeEnv: config.server.nodeEnv });

  // Connect to MongoDB
  await connectDb();
  logger.info('api', { event: 'db_connected' });

  // Bootstrap indexes
  await bootstrapIndexes();

  // Start background job scheduler
  startScheduler();

  // Create and start Express app
  const app = createApp();
  const port = config.server.port;

  app.listen(port, () => {
    logger.info('api', { event: 'listening', port });
  });
}

main().catch((err) => {
  logger.error('api', { event: 'fatal_startup_error', error: err.message });
  process.exit(1);
});

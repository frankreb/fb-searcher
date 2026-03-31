import 'dotenv/config';
import { startServer } from './backend/server';
import { initDatabase } from './backend/database';
import { startScheduler } from './backend/scheduler';
import { startBot } from './bot/telegram';
import { loadConfig } from './config/settings';
import { createLogger } from './backend/logger';
import { setupGracefulShutdown, registerCleanup } from './backend/shutdown';

const logger = createLogger('main');

async function main() {
  setupGracefulShutdown();
  logger.info('Starting up...');

  const config = loadConfig();
  const db = initDatabase(config.dbPath);
  registerCleanup('database', () => { db?.close(); });

  const bot = await startBot(config.telegram);
  registerCleanup('telegram-bot', () => bot?.stop());

  startScheduler(config);
  startServer(config.port);

  logger.info(`Running on port ${config.port}`);
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});

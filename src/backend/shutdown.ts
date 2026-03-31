import { createLogger } from './logger';

const logger = createLogger('shutdown');

type CleanupFn = () => void | Promise<void>;
const cleanupHandlers: Array<{ name: string; fn: CleanupFn }> = [];

export function registerCleanup(name: string, fn: CleanupFn): void {
  cleanupHandlers.push({ name, fn });
}

let shutdownInProgress = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  for (const handler of cleanupHandlers.reverse()) {
    try {
      logger.info(`Cleaning up: ${handler.name}`);
      await handler.fn();
    } catch (err) {
      logger.error(`Error during cleanup of ${handler.name}`, { error: String(err) });
    }
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

export function setupGracefulShutdown(): void {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  logger.info('Graceful shutdown handlers registered');
}

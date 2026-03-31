import cron from 'node-cron';
import { AppConfig } from '../config/settings';
import { processScrapedItems } from './service';
import { logError } from './database';

let config: AppConfig;
let isRunning = false;

export function startScheduler(appConfig: AppConfig): void {
  config = appConfig;
  const interval = config.scraping.intervalMinutes;

  // node-cron expression: run every N minutes
  const cronExpr = `*/${interval} * * * *`;

  console.log(`[scheduler] Scheduling scrape every ${interval} minutes (${cronExpr})`);

  cron.schedule(cronExpr, () => {
    runScrapeJob().catch((err) =>
      console.error('[scheduler] Scrape job error:', err),
    );
  });

  // Run once on startup after a short delay
  setTimeout(() => {
    runScrapeJob().catch((err) =>
      console.error('[scheduler] Initial scrape error:', err),
    );
  }, 5000);
}

export async function runScrapeJob(): Promise<void> {
  if (isRunning) {
    console.log('[scheduler] Scrape already in progress, skipping');
    return;
  }

  isRunning = true;
  console.log('[scheduler] Starting scrape job...');

  try {
    // Dynamic import to avoid circular deps and allow scrapers to be optional
    const { scrapeAll } = await import('../scraper/index');

    const items = await scrapeAll(config);
    console.log(`[scheduler] Scraped ${items.length} items`);

    await processScrapedItems(items, config);
    console.log('[scheduler] Scrape job complete');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[scheduler] Scrape job failed:', error.message);
    logError('scheduler', error.message, error.stack);
  } finally {
    isRunning = false;
  }
}

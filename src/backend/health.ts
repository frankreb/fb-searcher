import Database from 'better-sqlite3';
import { createLogger } from './logger';

const logger = createLogger('health');
const startTime = Date.now();

let lastScrapeTime: number | null = null;

export function recordScrape(): void {
  lastScrapeTime = Date.now();
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  lastScrape: string | null;
  dbConnected: boolean;
  botConnected: boolean;
  errors24h: number;
}

export function getHealthStatus(db: Database.Database | null, botRunning: boolean): HealthStatus {
  let dbConnected = false;
  let errors24h = 0;

  if (db) {
    try {
      db.prepare('SELECT 1').get();
      dbConnected = true;
    } catch (err) {
      logger.warn('Database health check failed', { error: String(err) });
    }

    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = db.prepare(
        "SELECT COUNT(*) as count FROM scrape_logs WHERE status = 'error' AND created_at > ?"
      ).get(cutoff) as { count: number } | undefined;
      errors24h = row?.count ?? 0;
    } catch {
      // scrape_logs table may not exist yet
    }
  }

  const hasIssues = !dbConnected || !botRunning;
  const status: HealthStatus['status'] = hasIssues ? 'degraded' : 'ok';

  return {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastScrape: lastScrapeTime ? new Date(lastScrapeTime).toISOString() : null,
    dbConnected,
    botConnected: botRunning,
    errors24h,
  };
}

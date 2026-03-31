import {
  findItemBySourceId,
  getActiveSearches,
  getItemCount,
  getErrorCount,
  insertItem,
  insertNotification,
  updateNotificationStatus,
  logError,
  ScrapedItemRow,
} from './database';
import { SearchCriteria, MatchResult, matchItemAgainstSearches } from './search';
import { sendNotification, sendAiNotification } from '../bot/telegram';
import { filterWithAi } from './ai-filter';
import { AppConfig } from '../config/settings';
import { createLogger } from './logger';

const logger = createLogger('service');

let lastRunAt: string | null = null;
let lastRunItemCount = 0;

export interface RawScrapedItem {
  source: string;
  source_id: string;
  title?: string;
  body?: string;
  price?: number | string;
  location?: string;
  url?: string;
  image_urls?: string[] | string;
  author?: string;
  category?: string;
  condition?: string;
  raw?: object;
}

export async function processScrapedItems(items: RawScrapedItem[], config: AppConfig): Promise<void> {
  let newCount = 0;
  const pendingNotifications: Array<{ item: ScrapedItemRow; matches: MatchResult[] }> = [];

  for (const rawItem of items) {
    try {
      if (isDuplicate(rawItem)) continue;

      const normalized = normalizeItem(rawItem);
      const id = insertItem(normalized);
      newCount++;

      const itemRow: ScrapedItemRow = { id, ...normalized, created_at: new Date().toISOString(), scraped_at: new Date().toISOString() };

      const matches = findMatches(itemRow);
      if (matches.length > 0) {
        pendingNotifications.push({ item: itemRow, matches });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logError('processScrapedItems', error.message, error.stack, { source_id: rawItem.source_id });
    }
  }

  // AI filtering step: send all matched items as a batch to Claude for review
  if (pendingNotifications.length > 0) {
    if (config.aiFilter.enabled) {
      logger.info(`Running AI filter on ${pendingNotifications.length} matched items`);
      const approved = await filterWithAi(pendingNotifications, config.aiFilter);

      for (const entry of approved) {
        await queueAiNotifications(entry.item, entry.matches, entry.aiSummary, config.telegram.chatId);
      }
    } else {
      // No AI filter — send all matches directly
      for (const entry of pendingNotifications) {
        await queueNotifications(entry.item, entry.matches, config.telegram.chatId);
      }
    }
  }

  lastRunAt = new Date().toISOString();
  lastRunItemCount = newCount;
}

export function isDuplicate(item: RawScrapedItem): boolean {
  return findItemBySourceId(item.source_id, item.source) !== undefined;
}

export function normalizeItem(raw: RawScrapedItem): Omit<ScrapedItemRow, 'id' | 'created_at' | 'scraped_at'> {
  let price: number | null = null;
  if (raw.price != null) {
    if (typeof raw.price === 'string') {
      const cleaned = raw.price.replace(/[^0-9.]/g, '');
      price = cleaned ? parseFloat(cleaned) : null;
    } else {
      price = raw.price;
    }
  }

  let imageUrls: string | null = null;
  if (raw.image_urls) {
    imageUrls = Array.isArray(raw.image_urls) ? JSON.stringify(raw.image_urls) : raw.image_urls;
  }

  return {
    source: raw.source,
    source_id: raw.source_id,
    title: raw.title?.trim() || null,
    body: raw.body?.trim() || null,
    price,
    location: raw.location?.trim() || null,
    url: raw.url || null,
    image_urls: imageUrls,
    author: raw.author?.trim() || null,
    category: raw.category?.trim() || null,
    condition: raw.condition?.trim() || null,
    raw_json: raw.raw ? JSON.stringify(raw.raw) : null,
  };
}

export function findMatches(item: ScrapedItemRow): MatchResult[] {
  const searchRows = getActiveSearches();
  const searches = searchRows.map((row) => ({
    id: row.id,
    name: row.name,
    criteria: JSON.parse(row.criteria_json) as SearchCriteria,
  }));
  return matchItemAgainstSearches(item, searches);
}

export async function queueNotifications(
  item: ScrapedItemRow,
  matches: MatchResult[],
  chatId: string,
): Promise<void> {
  for (const match of matches) {
    const notifId = insertNotification(item.id, match.searchId, chatId);
    try {
      const messageId = await sendNotification(chatId, item, match.searchName);
      updateNotificationStatus(notifId, 'sent', messageId?.toString());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      updateNotificationStatus(notifId, 'failed');
      logError('queueNotifications', error.message, error.stack, {
        item_id: item.id,
        search_id: match.searchId,
      });
    }
  }
}

export async function queueAiNotifications(
  item: ScrapedItemRow,
  matches: MatchResult[],
  aiSummary: string,
  chatId: string,
): Promise<void> {
  for (const match of matches) {
    const notifId = insertNotification(item.id, match.searchId, chatId);
    try {
      const messageId = await sendAiNotification(chatId, item, match.searchName, aiSummary);
      updateNotificationStatus(notifId, 'sent', messageId?.toString());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      updateNotificationStatus(notifId, 'failed');
      logError('queueAiNotifications', error.message, error.stack, {
        item_id: item.id,
        search_id: match.searchId,
      });
    }
  }
}

export function getStatus() {
  return {
    lastRunAt,
    lastRunItemCount,
    totalItems: getItemCount(),
    recentErrors: getErrorCount(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    ),
    activeSearches: getActiveSearches().length,
  };
}

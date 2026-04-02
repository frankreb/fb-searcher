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
import { sendNotification, sendAiNotification, sendGroupsNothingFound } from '../bot/telegram';
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

  // Group matched items by search, so each search can use its own AI prompt
  if (pendingNotifications.length > 0) {
    // Build a map of searchId → { prompt, items }
    const searchRows = getActiveSearches();
    const searchMap = new Map<string, { name: string; aiPrompt?: string }>();
    for (const row of searchRows) {
      const criteria = JSON.parse(row.criteria_json) as SearchCriteria;
      searchMap.set(row.id, { name: row.name, aiPrompt: criteria.aiPrompt });
    }

    // Group items by their matched search
    const bySearch = new Map<string, Array<{ item: ScrapedItemRow; matches: MatchResult[] }>>();
    for (const entry of pendingNotifications) {
      for (const match of entry.matches) {
        if (!bySearch.has(match.searchId)) bySearch.set(match.searchId, []);
        bySearch.get(match.searchId)!.push({ item: entry.item, matches: [match] });
      }
    }

    // Process each search group
    for (const [searchId, entries] of bySearch) {
      const searchInfo = searchMap.get(searchId);
      const searchPrompt = searchInfo?.aiPrompt;

      // Check if this is a groups search (AI is the primary filter)
      const searchCriteria = searchInfo ? JSON.parse(
        searchRows.find(r => r.id === searchId)!.criteria_json
      ) as SearchCriteria : null;
      const isGroupsSearch = searchCriteria?.source === 'groups';

      if (searchPrompt && config.aiFilter.enabled) {
        // This search has its own AI prompt — run Codex with it
        logger.info(`Running Codex for search "${searchInfo?.name}" on ${entries.length} items`);
        const approved = await filterWithAi(entries, { enabled: true, prompt: searchPrompt });

        if (approved.length > 0) {
          for (const entry of approved) {
            await queueAiNotifications(entry.item, entry.matches, entry.aiSummary, config.telegram.chatId);
          }
        } else if (isGroupsSearch) {
          // AI filtered everything out — send "nothing found" report
          const groupNames = (searchCriteria?.groupUrls || []).map(
            (u) => u.replace(/.*\/groups\//, '').replace(/\/$/, ''),
          );
          await sendGroupsNothingFound(
            config.telegram.chatId,
            searchInfo?.name || 'Unknown',
            groupNames,
            entries.length,
          );
        }
      } else if (!searchPrompt && config.aiFilter.enabled && config.aiFilter.prompt) {
        // No per-search prompt but global AI filter is on — use global prompt
        logger.info(`Running Codex (global prompt) for search "${searchInfo?.name}" on ${entries.length} items`);
        const approved = await filterWithAi(entries, config.aiFilter);

        if (approved.length > 0) {
          for (const entry of approved) {
            await queueAiNotifications(entry.item, entry.matches, entry.aiSummary, config.telegram.chatId);
          }
        } else if (isGroupsSearch) {
          const groupNames = (searchCriteria?.groupUrls || []).map(
            (u) => u.replace(/.*\/groups\//, '').replace(/\/$/, ''),
          );
          await sendGroupsNothingFound(
            config.telegram.chatId,
            searchInfo?.name || 'Unknown',
            groupNames,
            entries.length,
          );
        }
      } else if (isGroupsSearch && !searchPrompt) {
        // Groups search without AI prompt — warn, but still send items
        logger.warn(`Groups search "${searchInfo?.name}" has no AI prompt. All ${entries.length} posts will be sent. Add an AI prompt to filter them.`);
        for (const entry of entries) {
          await queueNotifications(entry.item, entry.matches, config.telegram.chatId);
        }
      } else {
        // No AI filter — send directly
        for (const entry of entries) {
          await queueNotifications(entry.item, entry.matches, config.telegram.chatId);
        }
      }
    }
  }

  // Check for groups searches that got zero posts at all
  const allSearchRows = getActiveSearches();
  for (const row of allSearchRows) {
    const criteria = JSON.parse(row.criteria_json) as SearchCriteria;
    if (criteria.source !== 'groups') continue;

    // Check if this search had any entries in pendingNotifications
    const hadEntries = pendingNotifications.some((entry) =>
      entry.matches.some((m) => m.searchId === row.id),
    );
    if (hadEntries) continue;

    // Check if any group items were scraped at all for this search's groups
    const groupPostCount = items.filter((i) => i.source === 'facebook_group').length;
    const groupNames = (criteria.groupUrls || []).map(
      (u) => u.replace(/.*\/groups\//, '').replace(/\/$/, ''),
    );

    await sendGroupsNothingFound(
      config.telegram.chatId,
      row.name,
      groupNames,
      groupPostCount,
    );
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

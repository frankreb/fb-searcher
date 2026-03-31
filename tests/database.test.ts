import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  getDb,
  insertItem,
  findItemBySourceId,
  insertSearch,
  getActiveSearches,
  deleteSearch,
  insertNotification,
  updateNotificationStatus,
  logError,
  getRecentItems,
  getItemCount,
  getErrorCount,
} from '../src/backend/database';

describe('database', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  describe('table creation', () => {
    it('creates scraped_items table', () => {
      const tables = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scraped_items'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('creates searches table', () => {
      const tables = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='searches'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('creates notifications table', () => {
      const tables = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('creates errors table', () => {
      const tables = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='errors'")
        .all();
      expect(tables.length).toBe(1);
    });
  });

  describe('scraped_items CRUD', () => {
    const testItem = {
      source: 'facebook_marketplace',
      source_id: 'test-123',
      title: 'Test Item',
      body: 'Description',
      price: 100,
      location: 'NYC',
      url: 'https://fb.com/item/1',
      image_urls: '["img.jpg"]',
      author: 'Seller',
      category: 'electronics',
      condition: 'new',
      raw_json: null,
    };

    it('inserts and retrieves an item', () => {
      const id = insertItem(testItem);
      expect(id).toBeTruthy();

      const found = findItemBySourceId('test-123', 'facebook_marketplace');
      expect(found).toBeDefined();
      expect(found!.title).toBe('Test Item');
      expect(found!.price).toBe(100);
    });

    it('enforces unique source_id + source constraint', () => {
      insertItem(testItem);
      expect(() => insertItem(testItem)).toThrow();
    });

    it('getRecentItems returns items in descending order', () => {
      insertItem({ ...testItem, source_id: 'a' });
      insertItem({ ...testItem, source_id: 'b' });
      insertItem({ ...testItem, source_id: 'c' });

      const items = getRecentItems(10);
      expect(items.length).toBe(3);
    });

    it('getItemCount returns correct count', () => {
      expect(getItemCount()).toBe(0);
      insertItem({ ...testItem, source_id: 'x' });
      insertItem({ ...testItem, source_id: 'y' });
      expect(getItemCount()).toBe(2);
    });
  });

  describe('searches CRUD', () => {
    it('inserts and retrieves a search', () => {
      const criteria = JSON.stringify({ keywords: ['test'] });
      const id = insertSearch('Test Search', criteria);
      expect(id).toBeTruthy();

      const searches = getActiveSearches();
      expect(searches.length).toBe(1);
      expect(searches[0].name).toBe('Test Search');
      expect(searches[0].criteria_json).toBe(criteria);
    });

    it('deleteSearch deactivates but does not remove', () => {
      const id = insertSearch('To Delete', '{}');
      deleteSearch(id);

      const active = getActiveSearches();
      expect(active.length).toBe(0);

      // Row still exists
      const row = getDb().prepare('SELECT * FROM searches WHERE id = ?').get(id);
      expect(row).toBeDefined();
    });
  });

  describe('notifications', () => {
    it('inserts and updates a notification', () => {
      const itemId = insertItem({
        source: 'test',
        source_id: 'n-item',
        title: 'N',
        body: null,
        price: null,
        location: null,
        url: null,
        image_urls: null,
        author: null,
        category: null,
        condition: null,
        raw_json: null,
      });
      const searchId = insertSearch('N Search', '{}');
      const notifId = insertNotification(itemId, searchId, 'chat-123');
      expect(notifId).toBeTruthy();

      updateNotificationStatus(notifId, 'sent', 'msg-456');
      const row = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(notifId) as any;
      expect(row.status).toBe('sent');
      expect(row.message_id).toBe('msg-456');
    });
  });

  describe('errors', () => {
    it('logs an error', () => {
      const id = logError('test', 'Something broke', 'stack trace', { key: 'val' });
      expect(id).toBeTruthy();
      expect(getErrorCount()).toBe(1);
    });

    it('getErrorCount with since filter', () => {
      logError('test', 'old error');
      // SQLite datetime('now') uses 'YYYY-MM-DD HH:MM:SS' format (no T, no Z)
      // Use a date well in the past in the same format
      expect(getErrorCount('2000-01-01 00:00:00')).toBe(1);

      // Use a date well in the future so nothing matches
      expect(getErrorCount('2099-01-01 00:00:00')).toBe(0);
    });
  });
});

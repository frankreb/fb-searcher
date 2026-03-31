import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(dbPath: string): Database.Database {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations();
  return db;
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scraped_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT,
      body TEXT,
      price REAL,
      location TEXT,
      url TEXT,
      image_urls TEXT,
      author TEXT,
      category TEXT,
      condition TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_items_source
      ON scraped_items(source_id, source);

    CREATE INDEX IF NOT EXISTS idx_scraped_items_created
      ON scraped_items(created_at);

    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      search_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      FOREIGN KEY (item_id) REFERENCES scraped_items(id),
      FOREIGN KEY (search_id) REFERENCES searches(id)
    );

    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      source TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      context_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// --- scraped_items CRUD ---

export interface ScrapedItemRow {
  id: string;
  source: string;
  source_id: string;
  title: string | null;
  body: string | null;
  price: number | null;
  location: string | null;
  url: string | null;
  image_urls: string | null;
  author: string | null;
  category: string | null;
  condition: string | null;
  raw_json: string | null;
  created_at: string;
  scraped_at: string;
}

export function insertItem(item: Omit<ScrapedItemRow, 'id' | 'created_at' | 'scraped_at'>): string {
  const id = uuidv4();
  const stmt = getDb().prepare(`
    INSERT INTO scraped_items (id, source, source_id, title, body, price, location, url, image_urls, author, category, condition, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    item.source,
    item.source_id,
    item.title,
    item.body,
    item.price,
    item.location,
    item.url,
    item.image_urls,
    item.author,
    item.category,
    item.condition,
    item.raw_json,
  );
  return id;
}

export function findItemBySourceId(sourceId: string, source: string): ScrapedItemRow | undefined {
  const stmt = getDb().prepare('SELECT * FROM scraped_items WHERE source_id = ? AND source = ?');
  return stmt.get(sourceId, source) as ScrapedItemRow | undefined;
}

// --- searches CRUD ---

export interface SearchRow {
  id: string;
  name: string;
  criteria_json: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export function insertSearch(name: string, criteriaJson: string): string {
  const id = uuidv4();
  const stmt = getDb().prepare(`
    INSERT INTO searches (id, name, criteria_json)
    VALUES (?, ?, ?)
  `);
  stmt.run(id, name, criteriaJson);
  return id;
}

export function getActiveSearches(): SearchRow[] {
  const stmt = getDb().prepare('SELECT * FROM searches WHERE active = 1');
  return stmt.all() as SearchRow[];
}

export function deleteSearch(id: string): void {
  const stmt = getDb().prepare('UPDATE searches SET active = 0, updated_at = datetime(\'now\') WHERE id = ?');
  stmt.run(id);
}

// --- notifications CRUD ---

export function insertNotification(itemId: string, searchId: string, chatId: string): string {
  const id = uuidv4();
  const stmt = getDb().prepare(`
    INSERT INTO notifications (id, item_id, search_id, chat_id)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, itemId, searchId, chatId);
  return id;
}

export function updateNotificationStatus(id: string, status: string, messageId?: string): void {
  const stmt = getDb().prepare(`
    UPDATE notifications SET status = ?, message_id = ?, sent_at = datetime('now') WHERE id = ?
  `);
  stmt.run(status, messageId ?? null, id);
}

// --- errors ---

export function logError(source: string, message: string, stack?: string, context?: object): string {
  const id = uuidv4();
  const stmt = getDb().prepare(`
    INSERT INTO errors (id, source, message, stack, context_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, source, message, stack ?? null, context ? JSON.stringify(context) : null);
  return id;
}

// --- queries ---

export function getRecentItems(limit: number = 50, offset: number = 0): ScrapedItemRow[] {
  const stmt = getDb().prepare('SELECT * FROM scraped_items ORDER BY created_at DESC LIMIT ? OFFSET ?');
  return stmt.all(limit, offset) as ScrapedItemRow[];
}

export function getItemCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM scraped_items').get() as { count: number };
  return row.count;
}

export function getErrorCount(since?: string): number {
  if (since) {
    const row = getDb().prepare('SELECT COUNT(*) as count FROM errors WHERE created_at >= ?').get(since) as { count: number };
    return row.count;
  }
  const row = getDb().prepare('SELECT COUNT(*) as count FROM errors').get() as { count: number };
  return row.count;
}

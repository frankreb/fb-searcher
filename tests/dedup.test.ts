import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, insertItem, findItemBySourceId } from '../src/backend/database';
import { isDuplicate, normalizeItem, RawScrapedItem } from '../src/backend/service';

function makeRawItem(overrides: Partial<RawScrapedItem> = {}): RawScrapedItem {
  return {
    source: 'facebook_marketplace',
    source_id: 'mp-001',
    title: 'Test Item',
    body: 'A test item description',
    price: 50,
    location: 'Test City',
    url: 'https://facebook.com/marketplace/item/001',
    ...overrides,
  };
}

describe('deduplication', () => {
  beforeEach(() => {
    // Use in-memory database for each test
    initDatabase(':memory:');
  });

  it('detects no duplicate for new item', () => {
    expect(isDuplicate(makeRawItem())).toBe(false);
  });

  it('detects duplicate after insertion', () => {
    const raw = makeRawItem();
    const normalized = normalizeItem(raw);
    insertItem(normalized);

    expect(isDuplicate(makeRawItem())).toBe(true);
  });

  it('treats different source_ids as unique', () => {
    const raw1 = makeRawItem({ source_id: 'mp-001' });
    insertItem(normalizeItem(raw1));

    const raw2 = makeRawItem({ source_id: 'mp-002' });
    expect(isDuplicate(raw2)).toBe(false);
  });

  it('treats same source_id with different source as unique', () => {
    const raw1 = makeRawItem({ source: 'facebook_marketplace', source_id: 'id-001' });
    insertItem(normalizeItem(raw1));

    const raw2 = makeRawItem({ source: 'facebook_group', source_id: 'id-001' });
    expect(isDuplicate(raw2)).toBe(false);
  });

  it('findItemBySourceId returns inserted item', () => {
    const raw = makeRawItem({ source_id: 'find-me', source: 'facebook_marketplace' });
    insertItem(normalizeItem(raw));

    const found = findItemBySourceId('find-me', 'facebook_marketplace');
    expect(found).toBeDefined();
    expect(found!.title).toBe('Test Item');
  });

  it('findItemBySourceId returns undefined for missing item', () => {
    const found = findItemBySourceId('nonexistent', 'facebook_marketplace');
    expect(found).toBeUndefined();
  });
});

describe('normalizeItem', () => {
  it('parses string price to number', () => {
    const normalized = normalizeItem(makeRawItem({ price: '$150.00' }));
    expect(normalized.price).toBe(150);
  });

  it('handles numeric price', () => {
    const normalized = normalizeItem(makeRawItem({ price: 75 }));
    expect(normalized.price).toBe(75);
  });

  it('sets null for unparseable price', () => {
    const normalized = normalizeItem(makeRawItem({ price: 'Free' }));
    expect(normalized.price).toBeNull();
  });

  it('trims whitespace from text fields', () => {
    const normalized = normalizeItem(makeRawItem({ title: '  Spaced Title  ', body: '  body  ' }));
    expect(normalized.title).toBe('Spaced Title');
    expect(normalized.body).toBe('body');
  });

  it('serializes image_urls array to JSON string', () => {
    const normalized = normalizeItem(makeRawItem({ image_urls: ['img1.jpg', 'img2.jpg'] }));
    expect(normalized.image_urls).toBe('["img1.jpg","img2.jpg"]');
  });

  it('passes through image_urls string as-is', () => {
    const normalized = normalizeItem(makeRawItem({ image_urls: '["already-json"]' }));
    expect(normalized.image_urls).toBe('["already-json"]');
  });
});

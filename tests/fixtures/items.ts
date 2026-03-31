import { ScrapedItemRow } from '../../src/backend/database';

export function makeItem(overrides: Partial<ScrapedItemRow> = {}): ScrapedItemRow {
  return {
    id: 'test-item-1',
    source: 'facebook_marketplace',
    source_id: 'src-001',
    title: 'Nice leather couch',
    body: 'Barely used leather couch in great condition. Pick up only.',
    price: 150,
    location: 'Brooklyn, NY',
    url: 'https://facebook.com/marketplace/item/123',
    image_urls: '["https://example.com/img1.jpg"]',
    author: 'John Doe',
    category: 'furniture',
    condition: 'used_good',
    raw_json: null,
    created_at: new Date().toISOString(),
    scraped_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeOldItem(daysOld: number): ScrapedItemRow {
  const date = new Date();
  date.setDate(date.getDate() - daysOld);
  return makeItem({
    id: `old-item-${daysOld}`,
    created_at: date.toISOString(),
  });
}

import { describe, it, expect } from 'vitest';
import { ScrapedItemRow } from '../src/backend/database';
import { makeItem } from './fixtures/items';

// Test the message formatting logic by reimplementing the format function
// (since sendNotification is tightly coupled to the bot instance).
// This tests the same logic used in telegram.ts.

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatNotificationMessage(item: ScrapedItemRow, searchName: string): string {
  const description = item.body
    ? item.body.length > 200
      ? item.body.substring(0, 200) + '...'
      : item.body
    : 'No description';

  const priceStr = item.price != null ? `${item.price}` : 'N/A';
  const locationStr = item.location || 'N/A';

  return [
    `*Match: ${escapeMarkdown(searchName)}*`,
    '',
    `*${escapeMarkdown(item.title || 'Untitled')}*`,
    `Price: ${escapeMarkdown(priceStr)}`,
    `Location: ${escapeMarkdown(locationStr)}`,
    '',
    escapeMarkdown(description),
    '',
    item.url ? `[View Listing](${item.url})` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

describe('telegram message formatting', () => {
  it('formats a basic notification message', () => {
    const msg = formatNotificationMessage(makeItem(), 'Couch Search');
    expect(msg).toContain('Match: Couch Search');
    expect(msg).toContain('Nice leather couch');
    expect(msg).toContain('150');
    expect(msg).toContain('Brooklyn');
  });

  it('shows "Untitled" for items without title', () => {
    const msg = formatNotificationMessage(makeItem({ title: null }), 'Search');
    expect(msg).toContain('Untitled');
  });

  it('shows "N/A" for items without price', () => {
    const msg = formatNotificationMessage(makeItem({ price: null }), 'Search');
    expect(msg).toContain('N/A');
  });

  it('shows "N/A" for items without location', () => {
    const msg = formatNotificationMessage(makeItem({ location: null }), 'Search');
    expect(msg).toContain('Location: N/A');
  });

  it('shows "No description" when body is null', () => {
    const msg = formatNotificationMessage(makeItem({ body: null }), 'Search');
    expect(msg).toContain('No description');
  });

  it('truncates long descriptions to 200 chars', () => {
    const longBody = 'A'.repeat(300);
    const msg = formatNotificationMessage(makeItem({ body: longBody }), 'Search');
    // The dots get markdown-escaped with backslashes
    expect(msg).toContain('\\.\\.\\.');
    // The escaped body should not contain the full 300 chars
    expect(msg).not.toContain('A'.repeat(300));
  });

  it('does not truncate short descriptions', () => {
    const shortBody = 'A short description.';
    const msg = formatNotificationMessage(makeItem({ body: shortBody }), 'Search');
    expect(msg).not.toContain('...');
  });

  it('includes listing URL when present', () => {
    const msg = formatNotificationMessage(makeItem({ url: 'https://fb.com/item/1' }), 'Search');
    expect(msg).toContain('[View Listing]');
  });

  it('omits listing URL when null', () => {
    const msg = formatNotificationMessage(makeItem({ url: null }), 'Search');
    expect(msg).not.toContain('View Listing');
  });

  it('escapes markdown special characters in title', () => {
    const msg = formatNotificationMessage(makeItem({ title: 'Item [50% off] *special*' }), 'Search');
    expect(msg).toContain('\\[');
    expect(msg).toContain('\\*special\\*');
  });
});

describe('escapeMarkdown', () => {
  it('escapes underscores', () => {
    expect(escapeMarkdown('hello_world')).toBe('hello\\_world');
  });

  it('escapes asterisks', () => {
    expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*');
  });

  it('escapes brackets', () => {
    expect(escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeMarkdown('hello world')).toBe('hello world');
  });
});

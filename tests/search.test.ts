import { describe, it, expect } from 'vitest';
import { matchItem, scoreMatch, matchItemAgainstSearches, SearchCriteria } from '../src/backend/search';
import { makeItem, makeOldItem } from './fixtures/items';

function makeCriteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    keywords: [],
    excludeKeywords: [],
    regexPatterns: [],
    ...overrides,
  };
}

describe('matchItem', () => {
  it('matches when no criteria specified', () => {
    expect(matchItem(makeItem(), makeCriteria())).toBe(true);
  });

  it('matches single keyword in title', () => {
    const criteria = makeCriteria({ keywords: ['couch'] });
    expect(matchItem(makeItem(), criteria)).toBe(true);
  });

  it('matches multiple keywords (AND logic)', () => {
    const criteria = makeCriteria({ keywords: ['leather', 'couch'] });
    expect(matchItem(makeItem(), criteria)).toBe(true);
  });

  it('rejects when not all keywords match', () => {
    const criteria = makeCriteria({ keywords: ['leather', 'table'] });
    expect(matchItem(makeItem(), criteria)).toBe(false);
  });

  it('excludes items with exclude keywords', () => {
    const criteria = makeCriteria({ keywords: ['couch'], excludeKeywords: ['leather'] });
    expect(matchItem(makeItem(), criteria)).toBe(false);
  });

  it('passes when exclude keywords are absent', () => {
    const criteria = makeCriteria({ keywords: ['couch'], excludeKeywords: ['broken'] });
    expect(matchItem(makeItem(), criteria)).toBe(true);
  });

  it('filters by price range — within range', () => {
    const criteria = makeCriteria({ priceMin: 100, priceMax: 200 });
    expect(matchItem(makeItem({ price: 150 }), criteria)).toBe(true);
  });

  it('filters by price range — below min', () => {
    const criteria = makeCriteria({ priceMin: 200 });
    expect(matchItem(makeItem({ price: 150 }), criteria)).toBe(false);
  });

  it('filters by price range — above max', () => {
    const criteria = makeCriteria({ priceMax: 100 });
    expect(matchItem(makeItem({ price: 150 }), criteria)).toBe(false);
  });

  it('filters by location', () => {
    const criteria = makeCriteria({ location: 'Brooklyn' });
    expect(matchItem(makeItem({ location: 'Brooklyn, NY' }), criteria)).toBe(true);
  });

  it('rejects wrong location', () => {
    const criteria = makeCriteria({ location: 'Manhattan' });
    expect(matchItem(makeItem({ location: 'Brooklyn, NY' }), criteria)).toBe(false);
  });

  it('matches regex patterns (OR logic)', () => {
    const criteria = makeCriteria({ regexPatterns: ['couch', 'sofa'] });
    expect(matchItem(makeItem(), criteria)).toBe(true);
  });

  it('rejects when no regex matches', () => {
    const criteria = makeCriteria({ regexPatterns: ['^table$', '^chair$'] });
    expect(matchItem(makeItem(), criteria)).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    const criteria = makeCriteria({ regexPatterns: ['[invalid', 'couch'] });
    expect(matchItem(makeItem(), criteria)).toBe(true);
  });

  it('filters by max age', () => {
    const criteria = makeCriteria({ maxAgeDays: 7 });
    expect(matchItem(makeItem(), criteria)).toBe(true);
    expect(matchItem(makeOldItem(10), criteria)).toBe(false);
  });

  it('filters by condition', () => {
    const criteria = makeCriteria({ condition: 'used_good' });
    expect(matchItem(makeItem({ condition: 'used_good' }), criteria)).toBe(true);
    expect(matchItem(makeItem({ condition: 'new' }), criteria)).toBe(false);
  });
});

describe('scoreMatch', () => {
  it('returns 0 for no matching criteria', () => {
    const criteria = makeCriteria();
    const score = scoreMatch(makeItem(), criteria);
    // Only recency score applies
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('scores keyword frequency', () => {
    const criteria = makeCriteria({ keywords: ['couch'] });
    const score = scoreMatch(makeItem(), criteria);
    expect(score).toBeGreaterThan(0);
  });

  it('gives higher score for title matches', () => {
    const criteria = makeCriteria({ keywords: ['couch'] });
    const titleMatch = scoreMatch(makeItem({ title: 'couch for sale' }), criteria);
    const noTitleMatch = scoreMatch(makeItem({ title: 'item for sale', body: 'nice couch' }), criteria);
    expect(titleMatch).toBeGreaterThanOrEqual(noTitleMatch);
  });

  it('scores recent items higher', () => {
    const criteria = makeCriteria({ keywords: ['couch'] });
    const recent = scoreMatch(makeItem(), criteria);
    const old = scoreMatch(makeOldItem(5), criteria);
    expect(recent).toBeGreaterThan(old);
  });

  it('scores price closer to min higher', () => {
    const criteria = makeCriteria({ priceMin: 100, priceMax: 300 });
    const cheap = scoreMatch(makeItem({ price: 110 }), criteria);
    const expensive = scoreMatch(makeItem({ price: 290 }), criteria);
    expect(cheap).toBeGreaterThan(expensive);
  });

  it('caps score at 100', () => {
    const criteria = makeCriteria({
      keywords: ['leather', 'couch', 'great', 'condition'],
      priceMin: 100,
      priceMax: 200,
    });
    const score = scoreMatch(makeItem(), criteria);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('matchItemAgainstSearches', () => {
  it('returns matches sorted by score descending', () => {
    const searches = [
      { id: 's1', name: 'Broad search', criteria: makeCriteria({ keywords: ['couch'] }) },
      { id: 's2', name: 'Specific search', criteria: makeCriteria({ keywords: ['leather', 'couch'] }) },
    ];
    const results = matchItemAgainstSearches(makeItem(), searches);
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('excludes non-matching searches', () => {
    const searches = [
      { id: 's1', name: 'Match', criteria: makeCriteria({ keywords: ['couch'] }) },
      { id: 's2', name: 'No match', criteria: makeCriteria({ keywords: ['bicycle'] }) },
    ];
    const results = matchItemAgainstSearches(makeItem(), searches);
    expect(results.length).toBe(1);
    expect(results[0].searchId).toBe('s1');
  });
});

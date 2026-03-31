import { ScrapedItemRow } from './database';

export type SearchSource = 'groups' | 'marketplace' | 'both';

export interface SearchCriteria {
  source?: SearchSource;
  keywords: string[];
  excludeKeywords: string[];
  groupUrls?: string[];
  category?: string;
  location?: string;
  radius?: number;
  priceMin?: number;
  priceMax?: number;
  condition?: string;
  maxAgeDays?: number;
  regexPatterns: string[];
}

export interface MatchResult {
  searchId: string;
  searchName: string;
  score: number;
}

export function matchItem(item: ScrapedItemRow, criteria: SearchCriteria): boolean {
  const text = buildSearchableText(item);

  // All keywords must match (AND logic)
  if (criteria.keywords.length > 0) {
    const allMatch = criteria.keywords.every((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (!allMatch) return false;
  }

  // Exclude keywords: if any match, reject
  if (criteria.excludeKeywords.length > 0) {
    const anyExcluded = criteria.excludeKeywords.some((kw) =>
      text.includes(kw.toLowerCase()),
    );
    if (anyExcluded) return false;
  }

  // Category filter
  if (criteria.category && item.category) {
    if (item.category.toLowerCase() !== criteria.category.toLowerCase()) return false;
  }

  // Location filter
  if (criteria.location && item.location) {
    if (!item.location.toLowerCase().includes(criteria.location.toLowerCase())) return false;
  }

  // Price range
  if (item.price != null) {
    if (criteria.priceMin != null && item.price < criteria.priceMin) return false;
    if (criteria.priceMax != null && item.price > criteria.priceMax) return false;
  }

  // Condition filter
  if (criteria.condition && item.condition) {
    if (item.condition.toLowerCase() !== criteria.condition.toLowerCase()) return false;
  }

  // Max age filter
  if (criteria.maxAgeDays != null && item.created_at) {
    const itemDate = new Date(item.created_at);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - criteria.maxAgeDays);
    if (itemDate < cutoff) return false;
  }

  // Regex patterns: at least one must match (OR logic)
  if (criteria.regexPatterns.length > 0) {
    const anyRegexMatch = criteria.regexPatterns.some((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(text);
      } catch {
        return false;
      }
    });
    if (!anyRegexMatch) return false;
  }

  return true;
}

export function scoreMatch(item: ScrapedItemRow, criteria: SearchCriteria): number {
  let score = 0;
  const text = buildSearchableText(item);

  // Keyword frequency score (up to 40 points)
  if (criteria.keywords.length > 0) {
    let keywordHits = 0;
    for (const kw of criteria.keywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      keywordHits += matches ? matches.length : 0;
    }
    score += Math.min(40, keywordHits * 10);
  }

  // Title match bonus (up to 20 points)
  if (item.title && criteria.keywords.length > 0) {
    const titleLower = item.title.toLowerCase();
    const titleMatches = criteria.keywords.filter((kw) => titleLower.includes(kw.toLowerCase()));
    score += Math.min(20, (titleMatches.length / criteria.keywords.length) * 20);
  }

  // Recency score (up to 20 points)
  if (item.created_at) {
    const ageMs = Date.now() - new Date(item.created_at).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours < 1) score += 20;
    else if (ageHours < 6) score += 15;
    else if (ageHours < 24) score += 10;
    else if (ageHours < 72) score += 5;
  }

  // Price fit score (up to 20 points)
  if (item.price != null && (criteria.priceMin != null || criteria.priceMax != null)) {
    const min = criteria.priceMin ?? 0;
    const max = criteria.priceMax ?? Infinity;
    if (item.price >= min && item.price <= max) {
      // Closer to minimum = better deal = higher score
      if (max !== Infinity) {
        const range = max - min;
        const position = (item.price - min) / range;
        score += Math.round((1 - position) * 20);
      } else {
        score += 10;
      }
    }
  }

  return Math.min(100, score);
}

export function matchItemAgainstSearches(
  item: ScrapedItemRow,
  searches: Array<{ id: string; name: string; criteria: SearchCriteria }>,
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const search of searches) {
    if (matchItem(item, search.criteria)) {
      results.push({
        searchId: search.id,
        searchName: search.name,
        score: scoreMatch(item, search.criteria),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function buildSearchableText(item: ScrapedItemRow): string {
  return [item.title, item.body, item.category, item.location, item.author]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

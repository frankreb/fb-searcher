import { initBrowser, validateSession, extractAndSaveCookies } from './auth';
import { GroupScraper } from './groups';
import { MarketplaceScraper } from './marketplace';
import { GroupPost, MarketplaceListing } from './types';
import { AppConfig } from '../config/settings';
import { RawScrapedItem } from '../backend/service';
import { sendAlert } from '../bot/telegram';
import { getActiveSearches, logError } from '../backend/database';

export async function scrapeAll(config: AppConfig): Promise<RawScrapedItem[]> {
  const { browser, page } = await initBrowser(
    config.facebook.cookiesPath,
    config.scraping.headless,
  );

  const items: RawScrapedItem[] = [];

  try {
    const sessionState = await validateSession(page);
    if (sessionState !== 'valid') {
      await sendAlert(config.telegram.chatId, 'Facebook session expired. Please update cookies.');
      return [];
    }

    // Refresh cookies after successful validation
    await extractAndSaveCookies(page, config.facebook.cookiesPath);

    // Derive group URLs and marketplace queries from active searches
    const searches = getActiveSearches();
    const groupUrls = new Set<string>();
    const marketplaceQueries: Array<{ query: string; criteria: Record<string, any> }> = [];

    for (const search of searches) {
      const criteria = JSON.parse(search.criteria_json);
      if (criteria.groupUrls && Array.isArray(criteria.groupUrls)) {
        criteria.groupUrls.forEach((url: string) => groupUrls.add(url));
      }
      if (criteria.keywords && criteria.keywords.length > 0) {
        marketplaceQueries.push({ query: criteria.keywords.join(' '), criteria });
      }
    }

    // Determine the shortest maxAgeDays across all searches (default 7)
    let maxAgeDays = 7;
    for (const search of searches) {
      const c = JSON.parse(search.criteria_json);
      if (c.maxAgeDays != null && c.maxAgeDays < maxAgeDays) {
        maxAgeDays = c.maxAgeDays;
      }
    }

    // Scrape groups
    if (groupUrls.size > 0) {
      const groupScraper = new GroupScraper(page);
      for (const url of groupUrls) {
        try {
          const posts = await groupScraper.scrapeGroup(url, {
            maxPosts: 25,
            maxAgeDays,
            headless: config.scraping.headless,
          });
          items.push(...posts.map(groupPostToRawItem));
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logError('scraper:groups', error.message, error.stack, { groupUrl: url });
        }
      }
    }

    // Scrape marketplace
    if (marketplaceQueries.length > 0) {
      const marketScraper = new MarketplaceScraper(page);
      for (const { query, criteria } of marketplaceQueries) {
        try {
          const listings = await marketScraper.searchListings(query, {
            maxResults: 50,
            headless: config.scraping.headless,
            filters: {
              location: criteria.location,
              radius: criteria.radius,
              minPrice: criteria.priceMin,
              maxPrice: criteria.priceMax,
              category: criteria.category,
              condition: criteria.condition,
            },
          });
          items.push(...listings.map(marketplaceListingToRawItem));
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          logError('scraper:marketplace', error.message, error.stack, { query });
        }
      }
    }
  } finally {
    await browser.close();
  }

  return items;
}

function groupPostToRawItem(post: GroupPost): RawScrapedItem {
  return {
    source: 'facebook_group',
    source_id: post.id || post.postUrl.replace(/[^a-zA-Z0-9]/g, '_'),
    title: post.text.substring(0, 100),
    body: post.text,
    author: post.author,
    url: post.postUrl,
    image_urls: post.images,
    category: post.groupName,
    raw: post as unknown as object,
  };
}

function marketplaceListingToRawItem(listing: MarketplaceListing): RawScrapedItem {
  return {
    source: 'facebook_marketplace',
    source_id: listing.id,
    title: listing.title,
    body: listing.description,
    price: listing.price,
    location: listing.location,
    url: listing.listingUrl,
    image_urls: listing.images,
    author: listing.seller,
    category: listing.category,
    condition: listing.condition,
    raw: listing as unknown as object,
  };
}

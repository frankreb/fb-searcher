import { Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import { MarketplaceListing, MarketplaceSearchOptions, MarketplaceFilters } from './types';

const DEFAULT_OPTIONS: Required<Omit<MarketplaceSearchOptions, 'filters'>> & { filters: MarketplaceFilters } = {
  maxPosts: 25,
  maxAgeDays: 7,
  maxResults: 50,
  minDelay: 2000,
  maxDelay: 5000,
  headless: true,
  filters: {},
};

const FB_MARKETPLACE_URL = 'https://www.facebook.com/marketplace';

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanScroll(page: Page): Promise<void> {
  const distance = 300 + Math.floor(Math.random() * 500);
  await page.evaluate((d) => window.scrollBy(0, d), distance);
}

function buildSearchUrl(query: string, filters: MarketplaceFilters): string {
  const params = new URLSearchParams();
  params.set('query', query);

  if (filters.minPrice != null) params.set('minPrice', String(filters.minPrice * 100));
  if (filters.maxPrice != null) params.set('maxPrice', String(filters.maxPrice * 100));
  if (filters.radius != null) params.set('radius', String(filters.radius));

  // Category and condition are typically set via URL path segments or UI interaction,
  // but we include them as params for completeness
  if (filters.category) params.set('category', filters.category);
  if (filters.condition) params.set('itemCondition', filters.condition);

  return `${FB_MARKETPLACE_URL}/search/?${params.toString()}`;
}

export class MarketplaceScraper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async searchListings(
    query: string,
    options: MarketplaceSearchOptions = {}
  ): Promise<MarketplaceListing[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options, filters: { ...DEFAULT_OPTIONS.filters, ...options.filters } };
    const maxResults = opts.maxResults;
    const listings: MarketplaceListing[] = [];

    const searchUrl = buildSearchUrl(query, opts.filters);
    console.log(`[marketplace] Searching: "${query}" (max ${maxResults} results)`);

    await this.page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(opts.minDelay, opts.maxDelay);

    // Apply location filter if specified
    if (opts.filters.location) {
      await this.setLocation(opts.filters.location);
      await randomDelay(opts.minDelay, opts.maxDelay);
    }

    let scrollAttempts = 0;
    const maxScrollAttempts = maxResults * 2;

    while (listings.length < maxResults && scrollAttempts < maxScrollAttempts) {
      const newListings = await this.extractListings();

      for (const listing of newListings) {
        listing.id = uuidv4();
        if (listings.length >= maxResults) break;
        if (!listings.some((l) => l.listingUrl === listing.listingUrl)) {
          listings.push(listing);
        }
      }

      await humanScroll(this.page);
      await randomDelay(opts.minDelay, opts.maxDelay);
      scrollAttempts++;
    }

    console.log(`[marketplace] Found ${listings.length} listings for "${query}"`);
    return listings;
  }

  private async setLocation(location: string): Promise<void> {
    try {
      // Click location filter button
      const locationBtn = await this.page.$('[aria-label*="Location"], [aria-label*="location"]');
      if (locationBtn) {
        await locationBtn.click();
        await randomDelay(1000, 2000);

        // Type location
        const input = await this.page.$('input[aria-label*="Location"], input[placeholder*="location"]');
        if (input) {
          await input.click({ clickCount: 3 });
          await input.type(location, { delay: 50 + Math.random() * 100 });
          await randomDelay(1000, 2000);

          // Select first suggestion
          const suggestion = await this.page.$('[role="listbox"] [role="option"]');
          if (suggestion) {
            await suggestion.click();
            await randomDelay(1000, 2000);
          }

          // Apply
          const applyBtn = await this.page.$('button[aria-label*="Apply"], [role="button"]:has-text("Apply")');
          if (applyBtn) {
            await applyBtn.click();
            await randomDelay(2000, 3000);
          }
        }
      }
    } catch (err) {
      console.warn('[marketplace] Could not set location filter:', err);
    }
  }

  private async extractListings(): Promise<MarketplaceListing[]> {
    return this.page.evaluate(() => {
      const cards = document.querySelectorAll(
        'a[href*="/marketplace/item/"], [data-testid="marketplace_feed_item"]'
      );

      const results: MarketplaceListing[] = [];

      cards.forEach((card) => {
        const linkEl = card.closest('a') ?? card.querySelector<HTMLAnchorElement>('a[href*="/marketplace/item/"]');
        const listingUrl = linkEl?.href ?? '';
        if (!listingUrl) return;

        // Title — usually the first prominent text or an aria-label
        const titleEl = card.querySelector('span[dir="auto"], [role="heading"]');
        const title = titleEl?.textContent?.trim() ?? '';

        // Price
        const priceEl = card.querySelector('span[dir="auto"]');
        const price = priceEl?.textContent?.trim() ?? '';

        // Location
        const spans = card.querySelectorAll('span[dir="auto"]');
        let location = '';
        if (spans.length >= 3) {
          location = spans[2]?.textContent?.trim() ?? '';
        }

        // Image
        const imgEl = card.querySelector<HTMLImageElement>('img[src*="scontent"], img[src*="fbcdn"]');
        const images: string[] = [];
        if (imgEl?.src) images.push(imgEl.src);

        results.push({
          id: '',
          title,
          price,
          description: '',
          location,
          images,
          listingUrl,
          seller: '',
          category: '',
          condition: '',
          scrapedAt: new Date().toISOString(),
        });
      });

      return results;
    });
  }

  /**
   * Scrape full details from an individual listing page.
   */
  async getListingDetails(listing: MarketplaceListing): Promise<MarketplaceListing> {
    await this.page.goto(listing.listingUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(2000, 4000);

    const details = await this.page.evaluate(() => {
      const getText = (selector: string) =>
        document.querySelector(selector)?.textContent?.trim() ?? '';

      // Description
      const descEl = document.querySelector('[data-testid="marketplace_listing_description"], [role="main"] span[dir="auto"]');
      const description = descEl?.textContent?.trim() ?? '';

      // Seller
      const sellerEl = document.querySelector('a[href*="/marketplace/profile/"], a[role="link"] span');
      const seller = sellerEl?.textContent?.trim() ?? '';

      // Condition
      const conditionEl = Array.from(document.querySelectorAll('span[dir="auto"]')).find(
        (el) => el.textContent?.match(/new|used|like new|good|fair/i)
      );
      const condition = conditionEl?.textContent?.trim() ?? '';

      // All images
      const imageEls = document.querySelectorAll<HTMLImageElement>('img[src*="scontent"], img[src*="fbcdn"]');
      const images: string[] = [];
      imageEls.forEach((img) => {
        if (img.src && img.naturalWidth > 100) images.push(img.src);
      });

      return { description, seller, condition, images };
    });

    return {
      ...listing,
      description: details.description || listing.description,
      seller: details.seller || listing.seller,
      condition: details.condition || listing.condition,
      images: details.images.length > 0 ? details.images : listing.images,
    };
  }
}

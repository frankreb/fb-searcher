import type { Page, Browser } from 'puppeteer';

// --- Session & Auth Types ---

export type SessionState = 'valid' | 'expired' | 'unknown';

export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SessionInfo {
  state: SessionState;
  cookies: CookieData[];
  lastValidated?: string;
}

// --- Scraper Options ---

export interface ScraperOptions {
  maxPosts?: number;
  maxAgeDays?: number;
  minDelay?: number;
  maxDelay?: number;
  headless?: boolean;
}

export interface MarketplaceFilters {
  location?: string;
  radius?: number;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
  condition?: 'new' | 'used_like_new' | 'used_good' | 'used_fair';
}

export interface MarketplaceSearchOptions extends ScraperOptions {
  maxResults?: number;
  filters?: MarketplaceFilters;
}

// --- Data Types ---

export interface GroupPost {
  id: string;
  groupName: string;
  groupUrl: string;
  postUrl: string;
  author: string;
  text: string;
  timestamp: string;
  images: string[];
  scrapedAt: string;
}

export interface MarketplaceListing {
  id: string;
  title: string;
  price: string;
  description: string;
  location: string;
  images: string[];
  listingUrl: string;
  seller: string;
  category: string;
  condition: string;
  scrapedAt: string;
}

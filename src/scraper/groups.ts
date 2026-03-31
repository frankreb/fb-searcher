import { Page } from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import { GroupPost, ScraperOptions } from './types';
import { findItemBySourceId } from '../backend/database';

const DEFAULT_OPTIONS: Required<ScraperOptions> = {
  maxPosts: 25,
  maxAgeDays: 7,
  minDelay: 2000,
  maxDelay: 5000,
  headless: true,
};

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanScroll(page: Page): Promise<void> {
  const distance = 300 + Math.floor(Math.random() * 500);
  await page.evaluate((d) => window.scrollBy(0, d), distance);
}

export class GroupScraper {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async scrapeGroup(
    groupUrl: string,
    options: ScraperOptions = {}
  ): Promise<GroupPost[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const posts: GroupPost[] = [];

    console.log(`[groups] Scraping group: ${groupUrl} (max ${opts.maxPosts} posts)`);

    await this.page.goto(groupUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await randomDelay(opts.minDelay, opts.maxDelay);

    // Extract group name from page
    const groupName = await this.page.evaluate(() => {
      const el =
        document.querySelector('h1') ??
        document.querySelector('[role="main"] span[dir="auto"]');
      return el?.textContent?.trim() ?? 'Unknown Group';
    });

    let scrollAttempts = 0;
    const maxScrollAttempts = opts.maxPosts * 2;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - opts.maxAgeDays);
    let hitOldOrSeen = false;

    while (posts.length < opts.maxPosts && scrollAttempts < maxScrollAttempts && !hitOldOrSeen) {
      const newPosts = await this.extractPosts(groupUrl, groupName);
      let newPostsFound = false;

      for (const post of newPosts) {
        if (posts.length >= opts.maxPosts) break;
        // Deduplicate by postUrl within this run
        if (posts.some((p) => p.postUrl === post.postUrl)) continue;

        // Generate a stable source_id from the post URL
        const sourceId = post.postUrl.replace(/[^a-zA-Z0-9]/g, '_');
        post.id = sourceId;

        // Skip if we've already seen this post in the database
        if (findItemBySourceId(sourceId, 'facebook_group')) {
          hitOldOrSeen = true;
          continue;
        }

        // Skip posts older than maxAgeDays (best-effort timestamp parsing)
        if (post.timestamp) {
          const postDate = new Date(post.timestamp);
          if (!isNaN(postDate.getTime()) && postDate < cutoffDate) {
            hitOldOrSeen = true;
            continue;
          }
        }

        newPostsFound = true;
        posts.push(post);
      }

      // If no new posts were found in this scroll, we're likely at the end
      if (!newPostsFound && newPosts.length > 0) {
        hitOldOrSeen = true;
      }

      await humanScroll(this.page);
      await randomDelay(opts.minDelay, opts.maxDelay);
      scrollAttempts++;
    }

    console.log(`[groups] Scraped ${posts.length} posts from "${groupName}"`);
    return posts;
  }

  private async extractPosts(
    groupUrl: string,
    groupName: string
  ): Promise<GroupPost[]> {
    return this.page.evaluate(
      (gUrl, gName) => {
        const postElements = document.querySelectorAll(
          '[role="article"], [data-pagelet*="GroupFeed"] > div > div'
        );

        const results: GroupPost[] = [];

        postElements.forEach((el) => {
          // Try to extract post link
          const linkEl = el.querySelector<HTMLAnchorElement>(
            'a[href*="/groups/"][href*="/posts/"], a[href*="/permalink/"]'
          );
          const postUrl = linkEl?.href ?? '';
          if (!postUrl) return;

          // Author
          const authorEl = el.querySelector<HTMLAnchorElement>(
            'a[role="link"] > strong, h3 a, h4 a'
          );
          const author = authorEl?.textContent?.trim() ?? 'Unknown';

          // Post text
          const textEl = el.querySelector(
            '[data-ad-preview="message"], [dir="auto"]'
          );
          const text = textEl?.textContent?.trim() ?? '';

          // Timestamp
          const timeEl = el.querySelector<HTMLElement>(
            'abbr[data-utime], a[href*="/posts/"] span, [role="link"] span'
          );
          const timestamp =
            timeEl?.getAttribute('title') ??
            timeEl?.textContent?.trim() ??
            '';

          // Images
          const imageEls = el.querySelectorAll<HTMLImageElement>(
            'img[src*="scontent"], img[data-src*="scontent"]'
          );
          const images: string[] = [];
          imageEls.forEach((img) => {
            const src = img.src || img.dataset.src;
            if (src) images.push(src);
          });

          results.push({
            id: '', // filled in outside evaluate
            groupName: gName,
            groupUrl: gUrl,
            postUrl,
            author,
            text,
            timestamp,
            images,
            scrapedAt: new Date().toISOString(),
          });
        });

        return results;
      },
      groupUrl,
      groupName
    );
  }
}

import { Telegraf } from 'telegraf';
import { TelegramConfig } from '../config/settings';
import { getActiveSearches, deleteSearch, getRecentItems, ScrapedItemRow, getItemCount, getErrorCount } from '../backend/database';
import { getStatus } from '../backend/service';

let bot: Telegraf;
let lastSendTimestamps: number[] = [];

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function startBot(config: TelegramConfig): Promise<Telegraf> {
  bot = new Telegraf(config.botToken);

  bot.command('start', (ctx) => {
    ctx.reply(
      [
        '👋 *FB Searcher is running\\!*',
        '',
        'I monitor Facebook Groups and Marketplace for you and send matches here\\.',
        '',
        'Use /help to see all commands\\.',
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      [
        '*📋 Commands*',
        '',
        '/searches — List all active searches',
        '/search\\_1 /search\\_2 \\.\\.\\. — View search details',
        '/delete\\_1 /delete\\_2 \\.\\.\\. — Delete a search',
        '/status — Scraper status \\& stats',
        '/recent — Last 5 scraped items',
        '/scrape — Trigger a manual scrape now',
        '/help — This message',
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
  });

  bot.command('searches', (ctx) => {
    const searches = getActiveSearches();
    if (searches.length === 0) {
      ctx.reply('No active searches. Create one from the web dashboard.');
      return;
    }

    const lines = searches.map((s, i) => {
      const c = JSON.parse(s.criteria_json);
      const source = c.source || 'both';
      const sourceIcon = source === 'groups' ? '👥' : source === 'marketplace' ? '🏪' : '🔄';
      const hasAi = c.aiPrompt ? ' 🤖' : '';
      const keywords = (c.keywords || []).join(', ');
      const groups = (c.groupUrls || []).length;

      let detail = '';
      if (keywords) detail += `Keywords: ${keywords}`;
      if (groups > 0) detail += `${detail ? ' | ' : ''}${groups} group(s)`;
      if (c.priceMax) detail += ` | Max $${c.priceMax}`;

      return `${sourceIcon} *${i + 1}\\. ${escapeV2(s.name)}*${hasAi}\n   ${escapeV2(detail || 'No filters')}\n   /search\\_${i + 1}  •  /delete\\_${i + 1}`;
    });

    ctx.reply(['*🔍 Active Searches:*', '', ...lines].join('\n'), { parse_mode: 'MarkdownV2' });
  });

  // Dynamic /search_N command — show details for search N
  bot.hears(/^\/search_(\d+)$/, (ctx) => {
    const index = parseInt(ctx.match[1]) - 1;
    const searches = getActiveSearches();
    if (index < 0 || index >= searches.length) {
      ctx.reply('Search not found. Use /searches to see the list.');
      return;
    }

    const s = searches[index];
    const c = JSON.parse(s.criteria_json);
    const source = c.source || 'both';

    const lines = [
      `*📋 ${escapeV2(s.name)}*`,
      '',
      `*Source:* ${escapeV2(source)}`,
    ];

    if (c.keywords?.length) lines.push(`*Keywords:* ${escapeV2(c.keywords.join(', '))}`);
    if (c.excludeKeywords?.length) lines.push(`*Exclude:* ${escapeV2(c.excludeKeywords.join(', '))}`);
    if (c.groupUrls?.length) {
      lines.push(`*Groups \\(${c.groupUrls.length}\\):*`);
      c.groupUrls.forEach((url: string) => {
        const name = url.replace(/.*\/groups\//, '').replace(/\/$/, '');
        lines.push(`  • ${escapeV2(name)}`);
      });
    }
    if (c.location) lines.push(`*Location:* ${escapeV2(c.location)}`);
    if (c.radius) lines.push(`*Radius:* ${c.radius}km`);
    if (c.priceMin != null || c.priceMax != null) lines.push(`*Price:* $${c.priceMin || 0} \\- $${c.priceMax || '\\.\\.\\.'}`);
    if (c.category) lines.push(`*Category:* ${escapeV2(c.category)}`);
    if (c.condition) lines.push(`*Condition:* ${escapeV2(c.condition)}`);
    if (c.maxAgeDays) lines.push(`*Max age:* ${c.maxAgeDays} days`);

    if (c.aiPrompt) {
      const promptPreview = c.aiPrompt.length > 200 ? c.aiPrompt.substring(0, 200) + '...' : c.aiPrompt;
      lines.push('');
      lines.push(`🤖 *AI Prompt:*`);
      lines.push(escapeV2(promptPreview));
    } else {
      lines.push('');
      lines.push('_No AI prompt configured_');
    }

    lines.push('');
    lines.push(`Created: ${escapeV2(new Date(s.created_at).toLocaleString())}`);

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  });

  // Dynamic /delete_N command
  bot.hears(/^\/delete_(\d+)$/, (ctx) => {
    const index = parseInt(ctx.match[1]) - 1;
    const searches = getActiveSearches();
    if (index < 0 || index >= searches.length) {
      ctx.reply('Search not found. Use /searches to see the list.');
      return;
    }

    const s = searches[index];
    deleteSearch(s.id);
    ctx.reply(`✅ Deleted search: *${escapeV2(s.name)}*`, { parse_mode: 'MarkdownV2' });
  });

  bot.command('status', (ctx) => {
    const s = getStatus();
    const lines = [
      '*📊 Scraper Status*',
      '',
      `*Total items:* ${s.totalItems}`,
      `*Active searches:* ${s.activeSearches}`,
      `*Last scrape:* ${s.lastRunAt ? escapeV2(formatAgo(s.lastRunAt)) : 'never'}`,
      `*Items last run:* ${s.lastRunItemCount}`,
      `*Errors \\(24h\\):* ${s.recentErrors}`,
    ];
    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  });

  bot.command('recent', (ctx) => {
    const items = getRecentItems(5, 0);
    if (items.length === 0) {
      ctx.reply('No items scraped yet.');
      return;
    }

    const lines = ['*📦 Last 5 Items:*', ''];
    for (const item of items) {
      const sourceIcon = item.source === 'facebook_group' ? '👥' : '🏪';
      const title = item.title || (item.body ? item.body.substring(0, 60) : 'Untitled');
      const price = item.price != null ? `$${item.price}` : '';
      const link = item.url ? `[View](${item.url})` : '';
      lines.push(`${sourceIcon} *${escapeV2(title)}* ${escapeV2(price)}`);
      lines.push(`   ${escapeV2(item.location || '')} • ${escapeV2(formatAgo(item.created_at))} ${link}`);
      lines.push('');
    }

    ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  });

  bot.command('scrape', async (ctx) => {
    ctx.reply('⏳ Starting scrape job...');
    try {
      const { runScrapeJob } = await import('../backend/scheduler');
      runScrapeJob().catch(() => {});
      // Don't await — it'll take minutes. The user will get notifications when matches arrive.
    } catch {
      ctx.reply('❌ Failed to trigger scrape.');
    }
  });

  bot.launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

// ── Notification functions ──────────────────────────

export async function sendNotification(
  chatId: string,
  item: ScrapedItemRow,
  searchName: string,
): Promise<number | undefined> {
  if (!bot) throw new Error('Bot not initialized. Call startBot() first.');
  await waitForRateLimit();

  const sourceIcon = item.source === 'facebook_group' ? '👥' : '🏪';
  const description = item.body
    ? item.body.length > 200 ? item.body.substring(0, 200) + '...' : item.body
    : 'No description';
  const priceStr = item.price != null ? `$${item.price}` : '';
  const locationStr = item.location || '';

  const message = [
    `🔔 *Match: ${escapeV2(searchName)}*  ${sourceIcon}`,
    '',
    `*${escapeV2(item.title || 'Untitled')}*`,
    priceStr ? `💰 ${escapeV2(priceStr)}` : '',
    locationStr ? `📍 ${escapeV2(locationStr)}` : '',
    '',
    escapeV2(description),
    '',
    item.url ? `[View on Facebook](${item.url})` : '',
    `_${escapeV2(new Date().toLocaleString())}_`,
  ].filter(Boolean).join('\n');

  const sent = await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'MarkdownV2',
    link_preview_options: { is_disabled: true },
  });
  recordSend();
  return sent.message_id;
}

export async function sendAiNotification(
  chatId: string,
  item: ScrapedItemRow,
  searchName: string,
  aiSummary: string,
): Promise<number | undefined> {
  if (!bot) throw new Error('Bot not initialized. Call startBot() first.');
  await waitForRateLimit();

  const sourceIcon = item.source === 'facebook_group' ? '👥' : '🏪';
  const description = item.body
    ? item.body.length > 200 ? item.body.substring(0, 200) + '...' : item.body
    : 'No description';
  const priceStr = item.price != null ? `$${item.price}` : '';
  const locationStr = item.location || '';

  const message = [
    `🔔 *Match: ${escapeV2(searchName)}*  ${sourceIcon}`,
    '',
    `*${escapeV2(item.title || 'Untitled')}*`,
    priceStr ? `💰 ${escapeV2(priceStr)}` : '',
    locationStr ? `📍 ${escapeV2(locationStr)}` : '',
    '',
    escapeV2(description),
    '',
    aiSummary ? `🤖 *AI:* ${escapeV2(aiSummary)}` : '',
    '',
    item.url ? `[View on Facebook](${item.url})` : '',
    `_${escapeV2(new Date().toLocaleString())}_`,
  ].filter(Boolean).join('\n');

  const sent = await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'MarkdownV2',
    link_preview_options: { is_disabled: true },
  });
  recordSend();
  return sent.message_id;
}

export async function sendAlert(chatId: string, alertMessage: string): Promise<void> {
  if (!bot) throw new Error('Bot not initialized. Call startBot() first.');
  await waitForRateLimit();

  await bot.telegram.sendMessage(chatId, `⚠️ *Alert*\n\n${escapeV2(alertMessage)}`, {
    parse_mode: 'MarkdownV2',
  });
  recordSend();
}

// ── Helpers ─────────────────────────────────────────

function escapeV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function formatAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return diff + 'm ago';
  if (diff < 1440) return Math.floor(diff / 60) + 'h ago';
  return Math.floor(diff / 1440) + 'd ago';
}

function recordSend(): void {
  lastSendTimestamps.push(Date.now());
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  lastSendTimestamps = lastSendTimestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (lastSendTimestamps.length >= RATE_LIMIT) {
    const oldest = lastSendTimestamps[0];
    const waitMs = RATE_WINDOW_MS - (now - oldest) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastSendTimestamps = lastSendTimestamps.filter((t) => Date.now() - t < RATE_WINDOW_MS);
  }
}

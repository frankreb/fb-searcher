import { Telegraf } from 'telegraf';
import { TelegramConfig } from '../config/settings';
import { getActiveSearches } from '../backend/database';
import { ScrapedItemRow } from '../backend/database';

let bot: Telegraf;
let lastSendTimestamps: number[] = [];

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function startBot(config: TelegramConfig): Promise<Telegraf> {
  bot = new Telegraf(config.botToken);

  bot.command('start', (ctx) => {
    ctx.reply('FB Searcher bot is running. Use /help for available commands.');
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      [
        '*FB Searcher Bot Commands*',
        '',
        '/start — Initialize the bot',
        '/searches — List active searches',
        '/status — Show scraper status',
        '/help — Show this help message',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('searches', (ctx) => {
    const searches = getActiveSearches();
    if (searches.length === 0) {
      ctx.reply('No active searches configured.');
      return;
    }
    const lines = searches.map((s, i) => `${i + 1}. *${escapeMarkdown(s.name)}*`);
    ctx.reply(['*Active Searches:*', '', ...lines].join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('status', (ctx) => {
    ctx.reply('Scraper is running. Use the web dashboard for detailed status.');
  });

  bot.launch();

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

export async function sendNotification(
  chatId: string,
  item: ScrapedItemRow,
  searchName: string,
): Promise<number | undefined> {
  if (!bot) throw new Error('Bot not initialized. Call startBot() first.');

  await waitForRateLimit();

  const description = item.body
    ? item.body.length > 200
      ? item.body.substring(0, 200) + '...'
      : item.body
    : 'No description';

  const priceStr = item.price != null ? `${item.price}` : 'N/A';
  const locationStr = item.location || 'N/A';

  const message = [
    `🔔 *Match: ${escapeMarkdown(searchName)}*`,
    '',
    `*${escapeMarkdown(item.title || 'Untitled')}*`,
    `💰 Price: ${escapeMarkdown(priceStr)}`,
    `📍 Location: ${escapeMarkdown(locationStr)}`,
    '',
    escapeMarkdown(description),
    '',
    item.url ? `[View Listing](${item.url})` : '',
    `_Found: ${new Date().toLocaleString()}_`,
  ]
    .filter(Boolean)
    .join('\n');

  const sent = await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
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

  const description = item.body
    ? item.body.length > 200
      ? item.body.substring(0, 200) + '...'
      : item.body
    : 'No description';

  const priceStr = item.price != null ? `${item.price}` : 'N/A';
  const locationStr = item.location || 'N/A';

  const message = [
    `🔔 *Match: ${escapeMarkdown(searchName)}*`,
    '',
    `*${escapeMarkdown(item.title || 'Untitled')}*`,
    `💰 Price: ${escapeMarkdown(priceStr)}`,
    `📍 Location: ${escapeMarkdown(locationStr)}`,
    '',
    escapeMarkdown(description),
    '',
    aiSummary ? `🤖 *AI:* ${escapeMarkdown(aiSummary)}` : '',
    '',
    item.url ? `[View Listing](${item.url})` : '',
    `_Found: ${new Date().toLocaleString()}_`,
  ]
    .filter(Boolean)
    .join('\n');

  const sent = await bot.telegram.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true },
  });

  recordSend();
  return sent.message_id;
}

export async function sendAlert(chatId: string, message: string): Promise<void> {
  if (!bot) throw new Error('Bot not initialized. Call startBot() first.');

  await waitForRateLimit();

  await bot.telegram.sendMessage(chatId, `⚠️ *Alert*\n\n${escapeMarkdown(message)}`, {
    parse_mode: 'Markdown',
  });

  recordSend();
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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

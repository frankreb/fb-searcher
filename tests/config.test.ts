import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/settings';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Restore clean env and set only required vars
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.SCRAPE_INTERVAL_MINUTES;
    delete process.env.SCRAPE_HEADLESS;
    delete process.env.SCRAPE_PROXY_URL;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.FB_COOKIES_PATH;
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_CHAT_ID = 'test-chat-456';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads config with all required vars set', () => {
    const config = loadConfig();
    expect(config.telegram.botToken).toBe('test-token-123');
    expect(config.telegram.chatId).toBe('test-chat-456');
  });

  it('uses default values for optional vars', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.scraping.intervalMinutes).toBe(30);
    expect(config.scraping.headless).toBe(true);
    expect(config.dbPath).toBe('./data/fb-searcher.db');
    expect(config.logging.level).toBe('info');
  });

  it('overrides defaults when env vars are set', () => {
    process.env.PORT = '8080';
    process.env.SCRAPE_INTERVAL_MINUTES = '15';
    process.env.SCRAPE_HEADLESS = 'false';
    process.env.DB_PATH = '/custom/path.db';
    process.env.LOG_LEVEL = 'debug';

    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.scraping.intervalMinutes).toBe(15);
    expect(config.scraping.headless).toBe(false);
    expect(config.dbPath).toBe('/custom/path.db');
    expect(config.logging.level).toBe('debug');
  });

  it('throws on missing TELEGRAM_BOT_TOKEN', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => loadConfig()).toThrow('Missing required env var: TELEGRAM_BOT_TOKEN');
  });

  it('throws on missing TELEGRAM_CHAT_ID', () => {
    delete process.env.TELEGRAM_CHAT_ID;
    expect(() => loadConfig()).toThrow('Missing required env var: TELEGRAM_CHAT_ID');
  });

  it('sets proxy URL when provided', () => {
    process.env.SCRAPE_PROXY_URL = 'http://proxy:8080';
    const config = loadConfig();
    expect(config.scraping.proxyUrl).toBe('http://proxy:8080');
  });

  it('leaves proxy undefined when not set', () => {
    const config = loadConfig();
    expect(config.scraping.proxyUrl).toBeUndefined();
  });
});

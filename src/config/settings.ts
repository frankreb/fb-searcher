export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface ScrapingConfig {
  intervalMinutes: number;
  headless: boolean;
  proxyUrl?: string;
}

export interface DatabaseConfig {
  dbPath: string;
}

export interface ServerConfig {
  port: number;
}

export interface FacebookConfig {
  cookiesPath: string;
}

export interface AiFilterConfig {
  enabled: boolean;
  prompt: string;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface AppConfig {
  telegram: TelegramConfig;
  scraping: ScrapingConfig;
  aiFilter: AiFilterConfig;
  dbPath: string;
  port: number;
  facebook: FacebookConfig;
  logging: LoggingConfig;
}

export function loadConfig(): AppConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('Missing required env var: TELEGRAM_BOT_TOKEN');
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    throw new Error('Missing required env var: TELEGRAM_CHAT_ID');
  }

  return {
    telegram: {
      botToken,
      chatId,
    },
    scraping: {
      intervalMinutes: parseInt(process.env.SCRAPE_INTERVAL_MINUTES || '30', 10),
      headless: process.env.SCRAPE_HEADLESS !== 'false',
      proxyUrl: process.env.SCRAPE_PROXY_URL || undefined,
    },
    aiFilter: {
      enabled: process.env.AI_FILTER_ENABLED === 'true',
      prompt: process.env.AI_FILTER_PROMPT || 'Send me only items that look like genuine good deals. Skip spam, scams, or irrelevant posts.',
    },
    dbPath: process.env.DB_PATH || './data/fb-searcher.db',
    port: parseInt(process.env.PORT || '3000', 10),
    facebook: {
      cookiesPath: process.env.FB_COOKIES_PATH || './data/cookies.json',
    },
    logging: {
      level: (process.env.LOG_LEVEL as LoggingConfig['level']) || 'info',
    },
  };
}

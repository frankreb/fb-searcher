# FB Searcher

Automated Facebook Marketplace and Groups scraper with Telegram notifications. Define search criteria, and get notified when matching listings appear.

## Features

- **Facebook Marketplace scraping** -- search by keyword, price range, location, category, and condition
- **Facebook Groups scraping** -- monitor group posts for items of interest
- **Configurable search criteria** -- keyword matching (AND/OR), exclude keywords, regex patterns, price ranges, location filtering
- **Relevance scoring** -- items are scored based on keyword frequency, title matches, recency, and price fit
- **Deduplication** -- tracks seen items by source ID to avoid duplicate notifications
- **Telegram bot** -- receive instant notifications with formatted listing details; manage searches via bot commands
- **Admin API** -- REST endpoints for managing searches, viewing items, triggering scrapes, and checking status
- **Structured logging** -- JSON-formatted logs with configurable log levels
- **Docker support** -- multi-stage Dockerfile and docker-compose for easy deployment

## Quick Start

### Prerequisites

- Node.js >= 20
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Facebook session cookies (see [docs/SETUP.md](docs/SETUP.md))

### Install and Run

```bash
git clone <repo-url> && cd fb-searcher
npm install
cp .env.example .env   # edit with your credentials
npm run dev
```

### Docker

```bash
docker compose up -d
```

## Architecture

```
src/
  index.ts              # Entry point, startup orchestration
  config/
    settings.ts         # Environment-based configuration
  scraper/
    auth.ts             # Cookie-based Facebook authentication
    groups.ts           # Facebook Groups scraper (Puppeteer)
    marketplace.ts      # Facebook Marketplace scraper (Puppeteer)
    types.ts            # Scraper data types
    index.ts            # Scraper orchestration
  backend/
    database.ts         # SQLite schema and CRUD operations
    search.ts           # Search criteria matching and scoring engine
    service.ts          # Data ingestion, normalization, deduplication
    scheduler.ts        # Cron-based scrape scheduling
    server.ts           # Express API server
    logger.ts           # Structured JSON logging
    health.ts           # Health check module
    shutdown.ts         # Graceful shutdown handling
  bot/
    telegram.ts         # Telegram bot commands and notifications
  ui/                   # Admin panel (web UI)
tests/                  # Vitest test suite
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Service status and health |
| GET | `/api/searches` | List active searches |
| POST | `/api/searches` | Create a new search |
| DELETE | `/api/searches/:id` | Deactivate a search |
| GET | `/api/items` | List recent scraped items |
| POST | `/api/scrape` | Trigger a manual scrape |

## Documentation

- [Setup Guide](docs/SETUP.md) -- detailed installation and configuration
- [Operations Guide](docs/OPERATIONS.md) -- running in production, monitoring, troubleshooting

## License

ISC

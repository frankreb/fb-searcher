# Setup Guide

## Requirements

- **Node.js** >= 20 (recommended: latest LTS)
- **npm** >= 10
- **Docker** and **Docker Compose** (for containerized deployment)

## 1. Install Dependencies

```bash
npm install
```

## 2. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to name your bot
3. Copy the **bot token** (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
4. Start a conversation with your new bot (send `/start`)
5. To get your **chat ID**, message [@userinfobot](https://t.me/userinfobot) or use the Telegram API:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Look for `"chat":{"id": ...}` in the response.

## 3. Extract Facebook Cookies

FB Searcher uses saved cookies to authenticate with Facebook. You need to extract them from a logged-in browser session.

### Using Chrome DevTools

1. Log in to Facebook in Chrome
2. Open DevTools (F12) > Application tab > Cookies > `https://www.facebook.com`
3. You need these cookies at minimum: `c_user`, `xs`, `datr`, `fr`
4. Create a JSON file with the cookies in this format:

```json
[
  {
    "name": "c_user",
    "value": "YOUR_VALUE",
    "domain": ".facebook.com",
    "path": "/",
    "httpOnly": true,
    "secure": true
  },
  {
    "name": "xs",
    "value": "YOUR_VALUE",
    "domain": ".facebook.com",
    "path": "/",
    "httpOnly": true,
    "secure": true
  },
  {
    "name": "datr",
    "value": "YOUR_VALUE",
    "domain": ".facebook.com",
    "path": "/",
    "httpOnly": true,
    "secure": true
  },
  {
    "name": "fr",
    "value": "YOUR_VALUE",
    "domain": ".facebook.com",
    "path": "/",
    "httpOnly": true,
    "secure": true
  }
]
```

### Using a browser extension

Alternatively, use a cookie export extension (e.g., "EditThisCookie" or "Cookie-Editor") to export all Facebook cookies as JSON.

5. Save the file to `./data/cookies.json` (or the path specified by `FB_COOKIES_PATH`)

## 4. Environment Configuration

Create a `.env` file in the project root:

```bash
# Required
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=987654321

# Optional (defaults shown)
PORT=3000
DB_PATH=./data/fb-searcher.db
FB_COOKIES_PATH=./data/cookies.json
SCRAPE_INTERVAL_MINUTES=30
SCRAPE_HEADLESS=true
SCRAPE_PROXY_URL=
LOG_LEVEL=info
```

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | -- | Telegram bot API token |
| `TELEGRAM_CHAT_ID` | Yes | -- | Telegram chat ID for notifications |
| `PORT` | No | `3000` | HTTP server port |
| `DB_PATH` | No | `./data/fb-searcher.db` | SQLite database file path |
| `FB_COOKIES_PATH` | No | `./data/cookies.json` | Facebook cookies JSON file path |
| `SCRAPE_INTERVAL_MINUTES` | No | `30` | Minutes between scrape runs |
| `SCRAPE_HEADLESS` | No | `true` | Run browser in headless mode |
| `SCRAPE_PROXY_URL` | No | -- | HTTP proxy for scraping |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |

## 5. Run

### Development

```bash
npm run dev
```

### Production (compiled)

```bash
npm run build
npm start
```

### Docker

```bash
docker compose up -d
```

## 6. Create Your First Search

Use the API to create a search:

```bash
curl -X POST http://localhost:3000/api/searches \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Cheap furniture",
    "criteria": {
      "keywords": ["couch", "sofa"],
      "excludeKeywords": ["broken"],
      "priceMin": 0,
      "priceMax": 200,
      "location": "Brooklyn",
      "regexPatterns": []
    }
  }'
```

The scraper will automatically check for matching listings on each scheduled run and send Telegram notifications for new matches.

# Operations Guide

## Running in Production

### Docker (recommended)

```bash
docker compose up -d
```

The container uses:
- `unless-stopped` restart policy -- auto-restarts on crash
- Health check on `/api/status` every 30 seconds
- Non-root user for security
- Volumes for persistent data (`./data`) and cookies (`./cookies`)

### View logs

```bash
docker compose logs -f fb-searcher
```

Logs are JSON-structured and written to stdout, making them compatible with log aggregators (e.g., Loki, Datadog, CloudWatch).

### Restart

```bash
docker compose restart fb-searcher
```

### Rebuild after code changes

```bash
docker compose up -d --build
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/status
```

Response:

```json
{
  "lastRunAt": "2026-03-31T10:00:00.000Z",
  "lastRunItemCount": 12,
  "totalItems": 456,
  "recentErrors": 0,
  "activeSearches": 3
}
```

### Telegram Bot Commands

- `/status` -- quick status check
- `/searches` -- list active searches
- `/help` -- show available commands

## Common Issues and Troubleshooting

### "Facebook session expired" alert

**Cause:** The saved cookies have expired or been invalidated by Facebook.

**Fix:**
1. Log in to Facebook in your browser
2. Re-extract cookies (see [SETUP.md](SETUP.md#3-extract-facebook-cookies))
3. Replace the cookies file:
   ```bash
   cp new-cookies.json ./data/cookies.json
   ```
4. Restart the service:
   ```bash
   docker compose restart fb-searcher
   ```

### No listings being scraped

1. Check that cookies are valid (see above)
2. Check logs for errors:
   ```bash
   docker compose logs fb-searcher | grep '"level":"error"'
   ```
3. Verify at least one active search exists:
   ```bash
   curl http://localhost:3000/api/searches
   ```
4. Try a manual scrape:
   ```bash
   curl -X POST http://localhost:3000/api/scrape
   ```

### Database locked errors

**Cause:** Multiple processes accessing the SQLite database.

**Fix:** Ensure only one instance is running. The database uses WAL mode for better concurrency, but SQLite is single-writer.

### High memory usage

Puppeteer/Chromium can be memory-intensive. Adjust the scrape interval or reduce `maxPosts`/`maxResults` in search options.

### Container health check failing

```bash
docker inspect --format='{{.State.Health.Status}}' fb-searcher-fb-searcher-1
```

If unhealthy, check that the API server is starting correctly:
```bash
docker compose logs fb-searcher | tail -20
```

## Updating Cookies

Facebook cookies typically expire after a few weeks to months. When they expire:

1. The bot will send a Telegram alert: "Facebook session expired. Please update cookies."
2. Follow the cookie extraction steps in [SETUP.md](SETUP.md#3-extract-facebook-cookies)
3. Replace the file at the configured `FB_COOKIES_PATH`
4. No restart needed -- cookies are re-read on each scrape run

## Log Analysis

Logs are JSON-structured with these fields:

```json
{
  "timestamp": "2026-03-31T12:00:00.000Z",
  "level": "info",
  "module": "scheduler",
  "message": "Starting scrape job..."
}
```

### Filter by level

```bash
docker compose logs fb-searcher | grep '"level":"error"'
```

### Filter by module

```bash
docker compose logs fb-searcher | grep '"module":"scheduler"'
```

### Count errors in last 24h

```bash
curl http://localhost:3000/api/status | jq '.recentErrors'
```

## Backup

Back up the SQLite database periodically:

```bash
cp ./data/fb-searcher.db ./backups/fb-searcher-$(date +%Y%m%d).db
```

The database uses WAL mode, so also copy the WAL file if it exists:

```bash
cp ./data/fb-searcher.db-wal ./backups/ 2>/dev/null
```

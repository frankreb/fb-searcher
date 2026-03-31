import express from 'express';
import * as path from 'path';
import {
  getActiveSearches,
  insertSearch,
  deleteSearch,
  getRecentItems,
} from './database';
import { getStatus } from './service';

export function startServer(port: number): void {
  const app = express();
  app.use(express.json());

  // Serve admin UI
  const frontendDir = path.join(__dirname, '..', 'frontend');
  app.get('/', (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });

  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
  });

  app.get('/api/searches', (_req, res) => {
    const searches = getActiveSearches();
    res.json(searches.map((s) => ({
      ...s,
      criteria: JSON.parse(s.criteria_json),
    })));
  });

  app.post('/api/searches', (req, res) => {
    const { name, criteria } = req.body;
    if (!name || !criteria) {
      res.status(400).json({ error: 'name and criteria are required' });
      return;
    }
    const id = insertSearch(name, JSON.stringify(criteria));
    res.status(201).json({ id, name, criteria });
  });

  app.delete('/api/searches/:id', (req, res) => {
    deleteSearch(req.params.id);
    res.json({ success: true });
  });

  app.get('/api/items', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const items = getRecentItems(limit, offset);
    res.json(items);
  });

  app.post('/api/scrape', async (_req, res) => {
    // Manual trigger — the scheduler's runScrapeJob handles actual scraping
    try {
      const { runScrapeJob } = await import('./scheduler');
      runScrapeJob().catch((err) => console.error('[server] Manual scrape error:', err));
      res.json({ message: 'Scrape job triggered' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to trigger scrape' });
    }
  });

  app.listen(port, () => {
    console.log(`[server] API listening on port ${port}`);
  });
}

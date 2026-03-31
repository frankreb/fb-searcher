import express from 'express';
import * as path from 'path';
import {
  getActiveSearches,
  getSearchById,
  insertSearch,
  updateSearch,
  deleteSearch,
  getRecentItems,
} from './database';
import { getStatus } from './service';

export function startServer(port: number): void {
  const app = express();
  app.use(express.json());

  // Serve admin UI — check both src (dev) and dist (prod) locations
  let frontendDir = path.join(__dirname, '..', 'frontend');
  try {
    require('fs').accessSync(path.join(frontendDir, 'index.html'));
  } catch {
    // Fallback for when running from dist/
    frontendDir = path.join(__dirname, '..', '..', 'src', 'frontend');
  }
  app.use('/static', express.static(frontendDir));
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

  app.get('/api/searches/:id', (req, res) => {
    try {
      const search = getSearchById(req.params.id);
      if (!search) {
        res.status(404).json({ error: 'Search not found' });
        return;
      }
      res.json({ ...search, criteria: JSON.parse(search.criteria_json) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/searches/:id', (req, res) => {
    try {
      const { name, criteria } = req.body;
      const searchId = req.params.id;
      const existing = getSearchById(searchId);
      if (!existing) {
        res.status(404).json({ error: 'Search not found' });
        return;
      }
      updateSearch(
        searchId,
        name || existing.name,
        criteria ? JSON.stringify(criteria) : existing.criteria_json,
      );
      res.json({ success: true, id: searchId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/searches/:id', (req, res) => {
    try {
      deleteSearch(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/items', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const items = getRecentItems(limit, offset);
    res.json(items);
  });

  app.post('/api/generate-prompt', async (req, res) => {
    try {
      const { source, name, keywords, excludeKeywords, groupUrls, location, priceMin, priceMax, category, condition, userInput } = req.body;

      // Build a description of the search for Codex
      const parts: string[] = [];
      parts.push(`I have a Facebook ${source === 'groups' ? 'Groups' : 'Marketplace'} scraper.`);
      if (name) parts.push(`Search name: "${name}".`);
      if (keywords?.length) parts.push(`Keywords: ${keywords.join(', ')}.`);
      if (excludeKeywords?.length) parts.push(`Exclude: ${excludeKeywords.join(', ')}.`);
      if (groupUrls?.length) parts.push(`Monitoring ${groupUrls.length} Facebook group(s).`);
      if (location) parts.push(`Location: ${location}.`);
      if (priceMin || priceMax) parts.push(`Price range: $${priceMin || 0} - $${priceMax || 'any'}.`);
      if (category) parts.push(`Category: ${category}.`);
      if (condition) parts.push(`Condition: ${condition}.`);
      if (userInput) parts.push(`Additional context from user: ${userInput}`);

      const codexPrompt = `I need you to write a filtering prompt for an AI that reviews Facebook ${source === 'groups' ? 'group posts' : 'Marketplace listings'} and decides which ones to forward to me via Telegram.

Here is my search context:
${parts.join('\n')}

Write a clear, specific filtering prompt (about 5-10 lines) that tells the AI:
1. What I'm looking for (be specific based on the context above)
2. What to skip (spam, scams, irrelevant posts, overpriced items)
3. What makes a result worth sending to me
4. Any special rules based on the search criteria

Output ONLY the prompt text, nothing else. No markdown, no quotes, no explanation. Just the raw prompt I'll give to the AI.`;

      const { execFile } = await import('child_process');
      const fs = await import('fs');
      const os = await import('os');
      const tmpFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);

      console.log('[generate-prompt] Running Codex CLI...');

      await new Promise<void>((resolve, reject) => {
        execFile('codex', [
          'exec',
          '--full-auto',
          '--skip-git-repo-check',
          '-o', tmpFile,
          codexPrompt,
        ],
          { timeout: 90000, maxBuffer: 1024 * 1024 * 5 },
          (error, stdout, stderr) => {
            if (error) {
              console.error('[generate-prompt] Codex error:', error.message);
              console.error('[generate-prompt] stderr:', stderr);
              reject(new Error(`Codex failed: ${error.message}\n${stderr}`));
            } else {
              console.log('[generate-prompt] Codex completed successfully');
              resolve();
            }
          }
        );
      });

      // Read the output file
      let output = '';
      try {
        output = fs.readFileSync(tmpFile, 'utf-8').trim();
        fs.unlinkSync(tmpFile);
      } catch {
        console.error('[generate-prompt] Could not read Codex output file:', tmpFile);
      }

      if (!output) {
        throw new Error('Codex produced empty output');
      }

      console.log('[generate-prompt] Generated prompt:', output.substring(0, 100) + '...');
      res.json({ prompt: output });
    } catch (err) {
      // Fallback: generate a basic prompt without Codex
      const { source, name, keywords, excludeKeywords, location, priceMin, priceMax } = req.body;
      const lines: string[] = [];
      lines.push(`Review the following Facebook ${source === 'groups' ? 'group posts' : 'Marketplace listings'} and decide which ones I should see.`);
      if (name) lines.push(`This search is about: ${name}.`);
      if (keywords?.length) lines.push(`I am looking for: ${keywords.join(', ')}.`);
      if (excludeKeywords?.length) lines.push(`Skip anything mentioning: ${excludeKeywords.join(', ')}.`);
      if (location) lines.push(`Preferred location: ${location}.`);
      if (priceMin || priceMax) lines.push(`Price range: $${priceMin || 0} - $${priceMax || 'any'}.`);
      lines.push('');
      lines.push('Only send me genuinely relevant items. Skip spam, scams, and overpriced listings.');
      lines.push('For each approved item, write a short summary of why it is worth my attention.');

      res.json({ prompt: lines.join('\n'), fallback: true, error: String(err) });
    }
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

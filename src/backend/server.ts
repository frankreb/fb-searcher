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
      if (source === 'groups') {
        parts.push('I monitor Facebook buy/sell groups. I am a SELLER — I want to find people who are LOOKING TO BUY things I can sell them.');
      } else {
        parts.push('I have a Facebook Marketplace scraper.');
      }
      if (name) parts.push(`Search name: "${name}".`);
      if (keywords?.length) parts.push(`Keywords: ${keywords.join(', ')}.`);
      if (excludeKeywords?.length) parts.push(`Exclude: ${excludeKeywords.join(', ')}.`);
      if (groupUrls?.length) parts.push(`Monitoring ${groupUrls.length} Facebook group(s).`);
      if (location) parts.push(`Location: ${location}.`);
      if (priceMin || priceMax) parts.push(`Price range: $${priceMin || 0} - $${priceMax || 'any'}.`);
      if (category) parts.push(`Category: ${category}.`);
      if (condition) parts.push(`Condition: ${condition}.`);
      if (userInput) parts.push(`Additional context from user: ${userInput}`);

      let codexPrompt: string;

      if (source === 'groups') {
        codexPrompt = `I need you to write a filtering prompt for an AI that reviews Facebook group posts and decides which ones to forward to me via Telegram.

IMPORTANT CONTEXT: I am a SELLER. I want to find posts from people who are LOOKING TO BUY — "WTB", "looking for", "ISO", "anyone selling", "need", "want to buy", "in search of", etc. I do NOT want posts from other sellers listing items for sale.

Here is my search context:
${parts.join('\n')}

Write a clear, specific filtering prompt (about 5-10 lines) that tells the AI:
1. I am looking for BUYER posts — people wanting to buy things I sell (be specific based on the context above)
2. Skip posts from other sellers listing their items for sale — I only want demand/buyer posts
3. Skip spam, memes, off-topic discussions, admin posts, and irrelevant chatter
4. What makes a buyer post worth sending to me (relevant to what I sell)
5. Any special rules based on the search criteria

Output ONLY the prompt text, nothing else. No markdown, no quotes, no explanation. Just the raw prompt I'll give to the AI.`;
      } else {
        codexPrompt = `I need you to write a filtering prompt for an AI that reviews Facebook Marketplace listings and decides which ones to forward to me via Telegram.

Here is my search context:
${parts.join('\n')}

Write a clear, specific filtering prompt (about 5-10 lines) that tells the AI:
1. What I'm looking for (be specific based on the context above)
2. What to skip (spam, scams, irrelevant posts, overpriced items)
3. What makes a result worth sending to me
4. Any special rules based on the search criteria

Output ONLY the prompt text, nothing else. No markdown, no quotes, no explanation. Just the raw prompt I'll give to the AI.`;
      }

      const { spawn } = await import('child_process');
      const fs = await import('fs');
      const os = await import('os');
      const tmpFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);

      console.log('[generate-prompt] Running Codex CLI via stdin...');
      console.log('[generate-prompt] Output file:', tmpFile);

      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn('codex', [
          'exec',
          '--full-auto',
          '--skip-git-repo-check',
          '-o', tmpFile,
          '-',
        ], { timeout: 90000 });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        // Send prompt via stdin
        proc.stdin.write(codexPrompt);
        proc.stdin.end();

        proc.on('close', (code) => {
          console.log('[generate-prompt] Codex exit code:', code);
          console.log('[generate-prompt] stdout length:', stdout.length);
          console.log('[generate-prompt] stdout preview:', JSON.stringify(stdout.substring(0, 500)));
          console.log('[generate-prompt] stderr:', JSON.stringify(stderr.substring(0, 500)));

          // Try -o file first
          let result = '';
          try {
            if (fs.existsSync(tmpFile)) {
              result = fs.readFileSync(tmpFile, 'utf-8').trim();
              fs.unlinkSync(tmpFile);
              console.log('[generate-prompt] Read from -o file, length:', result.length);
              console.log('[generate-prompt] -o file preview:', JSON.stringify(result.substring(0, 300)));
            } else {
              console.log('[generate-prompt] -o file does not exist');
            }
          } catch {}

          // Fallback to stdout (strip ANSI codes)
          if (!result && stdout) {
            result = stdout
              .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/[\x00-\x09\x0b-\x1f]/g, '')
              .trim();
            console.log('[generate-prompt] Using cleaned stdout, length:', result.length);
          }

          if (code !== 0 && !result) {
            reject(new Error(`Codex exit code ${code}: ${stderr}`));
          } else if (!result) {
            reject(new Error('Codex produced empty output'));
          } else {
            resolve(result);
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`Codex spawn error: ${err.message}`));
        });
      });

      console.log('[generate-prompt] Final prompt:', output.substring(0, 200));
      res.json({ prompt: output });
    } catch (err) {
      // Fallback: generate a basic prompt without Codex
      const { source, name, keywords, excludeKeywords, location, priceMin, priceMax } = req.body;
      const lines: string[] = [];
      if (source === 'groups') {
        lines.push('Review the following Facebook group posts. I am a SELLER — find posts from people who want to BUY.');
        if (name) lines.push(`This search is about: ${name}.`);
        if (excludeKeywords?.length) lines.push(`Skip anything mentioning: ${excludeKeywords.join(', ')}.`);
        lines.push('');
        lines.push('Only send me posts where someone is LOOKING TO BUY (WTB, ISO, "looking for", "anyone selling", "need", etc.).');
        lines.push('Skip posts from other sellers listing items for sale, spam, memes, admin posts, and off-topic chatter.');
        lines.push('For each approved post, summarize what the person wants to buy.');
      } else {
        lines.push('Review the following Facebook Marketplace listings and decide which ones I should see.');
        if (name) lines.push(`This search is about: ${name}.`);
        if (keywords?.length) lines.push(`I am looking for: ${keywords.join(', ')}.`);
        if (excludeKeywords?.length) lines.push(`Skip anything mentioning: ${excludeKeywords.join(', ')}.`);
        if (location) lines.push(`Preferred location: ${location}.`);
        if (priceMin || priceMax) lines.push(`Price range: $${priceMin || 0} - $${priceMax || 'any'}.`);
        lines.push('');
        lines.push('Only send me genuinely relevant items. Skip spam, scams, and overpriced listings.');
        lines.push('For each approved item, write a short summary of why it is worth my attention.');
      }

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

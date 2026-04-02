import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import * as path from 'path';
import { ScrapedItemRow } from './database';
import { MatchResult } from './search';
import { createLogger } from './logger';

const logger = createLogger('ai-filter');

export interface AiFilteredItem {
  item: ScrapedItemRow;
  matches: MatchResult[];
  aiSummary: string;
}

export interface AiFilterConfig {
  enabled: boolean;
  prompt: string;
}

interface ItemForAi {
  index: number;
  source: string;
  title: string | null;
  body: string | null;
  price: number | null;
  location: string | null;
  category: string | null;
  condition: string | null;
  url: string | null;
  author: string | null;
  matchedSearches: string[];
}

interface AiDecision {
  index: number;
  send: boolean;
  summary: string;
}

function runCodex(prompt: string, timeoutMs: number = 120_000): Promise<string> {
  const tmpOutput = path.join(process.cwd(), 'data', `codex-output-${Date.now()}.txt`);

  return new Promise((resolve, reject) => {
    execFile(
      'codex',
      [
        'exec',
        '--full-auto',
        '--skip-git-repo-check',
        '-o', tmpOutput,
        prompt,
      ],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 },
      (error, _stdout, stderr) => {
        if (error) {
          try { unlinkSync(tmpOutput); } catch {}
          reject(new Error(`Codex CLI failed: ${error.message}\nstderr: ${stderr}`));
          return;
        }

        // Read the output from the temp file
        try {
          const { readFileSync } = require('fs') as typeof import('fs');
          const output = readFileSync(tmpOutput, 'utf-8').trim();
          unlinkSync(tmpOutput);
          resolve(output);
        } catch (readErr) {
          reject(new Error(`Codex completed but could not read output: ${readErr}`));
        }
      },
    );
  });
}

export async function filterWithAi(
  items: Array<{ item: ScrapedItemRow; matches: MatchResult[] }>,
  config: AiFilterConfig,
): Promise<AiFilteredItem[]> {
  if (items.length === 0) return [];

  // Prepare items for Codex
  const itemsForAi: ItemForAi[] = items.map((entry, i) => ({
    index: i,
    source: entry.item.source,
    title: entry.item.title,
    body: entry.item.body,
    price: entry.item.price,
    location: entry.item.location,
    category: entry.item.category,
    condition: entry.item.condition,
    url: entry.item.url,
    author: entry.item.author,
    matchedSearches: entry.matches.map((m) => m.searchName),
  }));

  // Write items to a temp file so Codex can read them
  const tmpDir = path.join(process.cwd(), 'data');
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `ai-filter-input-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(itemsForAi, null, 2));

  // Detect if these are group posts (buyer detection) or marketplace listings
  const isGroupPosts = items.length > 0 && items[0].item.source === 'facebook_group';

  const contextLine = isGroupPosts
    ? 'These are Facebook group posts from buy/sell groups. I am a SELLER — I want to find posts from people who are LOOKING TO BUY (WTB, ISO, "looking for", "anyone selling", "need", "want to buy"). Skip posts from other sellers listing items for sale, spam, memes, admin announcements, and off-topic chatter.'
    : 'These are Facebook Marketplace listings that matched my search criteria.';

  const summaryHint = isGroupPosts
    ? 'For buyer posts: summarize what the person wants to buy. For skipped posts: briefly say why (seller post, spam, off-topic, etc.).'
    : 'The "summary" should be 1-2 sentences explaining why it is relevant or why it was skipped.';

  const prompt = `Read the file "${tmpFile}" which contains a JSON array of posts/listings.

${contextLine}

My filtering instructions:
${config.prompt}

For each item in the JSON array, decide if it should be sent to me or skipped based on my instructions above.

Output ONLY a valid JSON array (no markdown, no code blocks, no explanation) with this format:
[{"index": 0, "send": true, "summary": "Person looking to buy a sim rig, budget $500"}, {"index": 1, "send": false, "summary": "Seller listing their own item, not a buyer"}]

Every item must have a decision. Use the "index" field from the input. ${summaryHint}`;

  try {
    logger.info(`Running Codex CLI to filter ${items.length} matched items`);

    const output = await runCodex(prompt);

    // Clean up temp file
    try { unlinkSync(tmpFile); } catch {}

    // Extract JSON from output — Codex may include extra text
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.error('Codex output did not contain a JSON array, sending all items', { output: output.substring(0, 500) });
      return fallback(items);
    }

    const decisions: AiDecision[] = JSON.parse(jsonMatch[0]);
    const approved: AiFilteredItem[] = [];

    for (const decision of decisions) {
      if (decision.send && decision.index >= 0 && decision.index < items.length) {
        approved.push({
          item: items[decision.index].item,
          matches: items[decision.index].matches,
          aiSummary: decision.summary,
        });
      } else if (!decision.send) {
        logger.info(`Codex skipped item ${decision.index}: ${decision.summary}`);
      }
    }

    logger.info(`Codex approved ${approved.length}/${items.length} items`);
    return approved;
  } catch (err) {
    // Clean up temp file on error
    try { unlinkSync(tmpFile); } catch {}

    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Codex CLI filter failed, falling back to sending all items', { error: error.message });
    return fallback(items);
  }
}

function fallback(
  items: Array<{ item: ScrapedItemRow; matches: MatchResult[] }>,
): AiFilteredItem[] {
  return items.map((entry) => ({
    item: entry.item,
    matches: entry.matches,
    aiSummary: '',
  }));
}

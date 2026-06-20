/**
 * Bulk knowledge loader.
 *
 * Reads all .md files from the knowledge/ directory and loads them
 * into the knowledge base with embeddings.
 *
 * Usage: pnpm tsx src/scripts/load-knowledge.ts
 *
 * Each file should have a YAML-like header:
 *   ---
 *   title: Arbitraje cambiario
 *   category: arbitraje
 *   ---
 *   Content here...
 */

import fs from 'fs';
import path from 'path';
import { saveDocument } from '../shared/db/repositories/kb.repo.js';
import { config } from '../shared/config/index.js';

const KNOWLEDGE_DIR = path.resolve(import.meta.dirname, '../../knowledge');

interface DocMeta {
  title: string;
  category: string;
}

function parseFrontmatter(raw: string): { meta: DocMeta; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return {
      meta: { title: 'Untitled', category: 'general' },
      content: raw.trim(),
    };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      meta[key.trim()] = rest.join(':').trim();
    }
  }

  return {
    meta: {
      title: meta.title || 'Untitled',
      category: meta.category || 'general',
    },
    content: match[2].trim(),
  };
}

async function main() {
  if (!config.openai.apiKey) {
    console.error('OPENAI_API_KEY is required for generating embeddings');
    process.exit(1);
  }

  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.error(`Knowledge directory not found: ${KNOWLEDGE_DIR}`);
    console.error('Create it and add .md files with domain knowledge.');
    process.exit(1);
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('No .md files found in knowledge/ directory.');
    process.exit(0);
  }

  console.log(`Found ${files.length} knowledge file(s). Loading...\n`);

  let totalChunks = 0;

  for (const file of files) {
    const filePath = path.join(KNOWLEDGE_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, content } = parseFrontmatter(raw);
    const sourceId = `doc_${file.replace('.md', '')}`;

    console.log(`  ${file} → "${meta.title}" (${meta.category})`);

    try {
      const chunks = await saveDocument(sourceId, meta.title, content, {
        category: meta.category,
        file: file,
      });
      totalChunks += chunks;
      console.log(`    ✓ ${chunks} chunk(s) saved\n`);
    } catch (err) {
      console.error(`    ✗ Error: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  console.log(`Done. ${totalChunks} total chunks loaded from ${files.length} file(s).`);
  process.exit(0);
}

main();

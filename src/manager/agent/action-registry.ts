import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'registry' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ActionDef {
  id: string;
  description: string;
}

interface Registry {
  capabilities: Record<string, ActionDef[]>;
  restrictions: ActionDef[];
}

let registry: Registry | null = null;

/** Load action-registry.yaml (parsed as simple YAML). */
export function loadRegistry(): Registry {
  if (registry) return registry;

  // Simple YAML parser — the file is structured enough to parse without a lib
  const yamlPath = path.resolve(__dirname, '..', '..', '..', 'docs', 'action-registry.yaml');

  if (!fs.existsSync(yamlPath)) {
    log.warn('action-registry.yaml not found, using empty registry');
    registry = { capabilities: {}, restrictions: [] };
    return registry;
  }

  const raw = fs.readFileSync(yamlPath, 'utf8');
  registry = parseRegistryYaml(raw);
  log.info(
    {
      categories: Object.keys(registry.capabilities),
      restrictions: registry.restrictions.length,
    },
    'Action registry loaded',
  );
  return registry;
}

/** Format the registry as a text block for injection into the system prompt. */
export function registryToPromptSection(): string {
  const reg = loadRegistry();
  const lines: string[] = ['## Tus capacidades'];

  for (const [category, actions] of Object.entries(reg.capabilities)) {
    lines.push(`\n### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const a of actions) {
      lines.push(`- ${a.description}`);
    }
  }

  lines.push('\n## Restricciones absolutas');
  for (const r of reg.restrictions) {
    lines.push(`- ${r.description}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Minimal YAML parser (only handles our flat structure)
// ---------------------------------------------------------------------------

function parseRegistryYaml(raw: string): Registry {
  const capabilities: Record<string, ActionDef[]> = {};
  const restrictions: ActionDef[] = [];

  let currentSection: 'capabilities' | 'restrictions' | null = null;
  let currentCategory: string | null = null;
  let currentItem: Partial<ActionDef> | null = null;

  /** Flush currentItem into the right list before switching context. */
  const flushItem = () => {
    if (currentItem?.id && currentItem?.description) {
      if (currentSection === 'restrictions') {
        restrictions.push(currentItem as ActionDef);
      } else if (currentCategory && capabilities[currentCategory]) {
        capabilities[currentCategory].push(currentItem as ActionDef);
      }
    }
    currentItem = null;
  };

  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();

    if (trimmed === 'capabilities:') {
      flushItem();
      currentSection = 'capabilities';
      continue;
    }
    if (trimmed === '  restrictions:') {
      flushItem();
      currentSection = 'restrictions';
      currentCategory = null;
      continue;
    }

    if (currentSection === 'capabilities') {
      // Category line like "  read:" or "  analyze:"
      const catMatch = trimmed.match(/^  (\w+):$/);
      if (catMatch) {
        flushItem();
        currentCategory = catMatch[1];
        capabilities[currentCategory] = [];
        continue;
      }

      // Item start "    - id: xyz"
      const idMatch = trimmed.match(/^\s+- id:\s*(.+)/);
      if (idMatch && currentCategory) {
        flushItem();
        currentItem = { id: idMatch[1].trim() };
        continue;
      }

      // Description line
      const descMatch = trimmed.match(/^\s+description:\s*"?(.+?)"?\s*$/);
      if (descMatch && currentItem) {
        currentItem.description = descMatch[1];
        continue;
      }
    }

    if (currentSection === 'restrictions') {
      const idMatch = trimmed.match(/^\s+- id:\s*(.+)/);
      if (idMatch) {
        flushItem();
        currentItem = { id: idMatch[1].trim() };
        continue;
      }

      const descMatch = trimmed.match(/^\s+description:\s*"?(.+?)"?\s*$/);
      if (descMatch && currentItem) {
        currentItem.description = descMatch[1];
        continue;
      }
    }
  }

  // Flush last item
  flushItem();

  return { capabilities, restrictions };
}

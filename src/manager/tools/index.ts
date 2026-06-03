import type Anthropic from '@anthropic-ai/sdk';
import { erpToolDefinitions, executeErpTool } from '../../shared/ai/tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';

// ---------------------------------------------------------------------------
// Manager-specific tool definitions
// ---------------------------------------------------------------------------

const managerToolDefinitions: Anthropic.Tool[] = [
  {
    name: 'read_memory',
    description:
      'Read your own long-term memory. Search for past observations, decisions, insights, or rules you have stored. Use this to recall what you have learned before making recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category: observation, decision, insight, rule, escalation, feedback',
        },
        subject_pattern: {
          type: 'string',
          description: 'Search term to match against the subject (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'write_memory',
    description:
      'Save a new observation, insight, decision, or rule to your long-term memory. Use this when you discover something worth remembering for future analyses.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['observation', 'decision', 'insight', 'rule', 'feedback'],
          description: 'Type of memory to store',
        },
        subject: {
          type: 'string',
          description: 'Short topic identifier (e.g., "sales_trend_weekly", "rate_cop_friday")',
        },
        content: {
          type: 'string',
          description: 'The content of the memory — what you learned or decided',
        },
        confidence: {
          type: 'number',
          description: 'How confident you are in this observation (0.0-1.0, default 0.8)',
        },
      },
      required: ['category', 'subject', 'content'],
    },
  },
];

/** All tools available to the Manager: shared ERP tools + manager-specific. */
export const allManagerTools: Anthropic.Tool[] = [
  ...erpToolDefinitions,
  ...managerToolDefinitions,
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

export async function executeManagerTool(
  name: string,
  input: ToolInput,
): Promise<string> {
  // Try shared ERP tools first
  if (['search_products', 'get_prices', 'get_exchange_rates', 'get_categories'].includes(name)) {
    return executeErpTool(name, input);
  }

  // Manager-specific tools
  switch (name) {
    case 'read_memory': {
      const category = input.category as string | undefined;
      const subjectPattern = input.subject_pattern as string | undefined;
      const limit = (input.limit as number) ?? 10;

      try {
        const memories = await memoryRepo.findMemories(category, subjectPattern, limit);
        if (memories.length === 0) {
          return JSON.stringify({ result: 'No memories found matching your search.' });
        }
        return JSON.stringify(
          memories.map((m) => ({
            id: m.id,
            category: m.category,
            subject: m.subject,
            content: m.content,
            confidence: m.confidence,
            outcome: m.outcome,
            created_at: m.created_at,
          })),
        );
      } catch {
        return JSON.stringify({ error: 'Database not available — memory read failed.' });
      }
    }

    case 'write_memory': {
      const category = input.category as string;
      const subject = input.subject as string;
      const content = input.content as string;
      const confidence = (input.confidence as number) ?? 0.8;

      try {
        const saved = await memoryRepo.saveMemory({
          category,
          subject,
          content,
          confidence,
          source: 'diagnostic',
        });
        return JSON.stringify({ result: 'Memory saved.', id: saved.id });
      } catch {
        return JSON.stringify({ error: 'Database not available — memory write failed.' });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

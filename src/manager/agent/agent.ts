import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, MODEL_SONNET } from '../../shared/ai/client.js';
import { createLogger } from '../../shared/logger.js';
import { buildManagerPrompt } from './system-prompt.js';
import { allManagerTools, executeManagerTool } from '../tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';

const log = createLogger('manager').child({ module: 'agent' });

const MAX_TOOL_ROUNDS = 8;

interface AgentOptions {
  /** Extra context to prepend (e.g., "This is an hourly diagnostic run"). */
  preamble?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
}

/**
 * Run the Manager agent with a given prompt.
 * Returns the final text response from Claude.
 */
export async function runManagerAgent(
  userPrompt: string,
  options: AgentOptions = {},
): Promise<string> {
  const client = getAnthropicClient();

  // Load recent memories as context
  let memoryContext: string | undefined;
  try {
    const memories = await memoryRepo.findMemories(undefined, undefined, 15);
    if (memories.length > 0) {
      memoryContext = memories
        .map((m) => `[${m.category}] ${m.subject}: ${m.content}` + (m.outcome ? ` → Resultado: ${m.outcome}` : ''))
        .join('\n');
    }
  } catch {
    // DB not available — proceed without memory
    log.debug('Memory not available, proceeding without context');
  }

  const systemPrompt = buildManagerPrompt(memoryContext);
  const fullUserMessage = options.preamble
    ? `${options.preamble}\n\n${userPrompt}`
    : userPrompt;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: fullUserMessage },
  ];

  let toolRounds = 0;

  while (toolRounds < MAX_TOOL_ROUNDS) {
    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: options.maxTokens ?? 2048,
      system: systemPrompt,
      tools: allManagerTools,
      messages,
    });

    if (response.stop_reason === 'tool_use') {
      toolRounds++;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use',
      );

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        log.debug({ tool: toolUse.name, input: toolUse.input }, 'Tool call');
        try {
          const result = await executeManagerTool(toolUse.name, toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ tool: toolUse.name, err: msg }, 'Tool execution failed');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error: ${msg}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Final text response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const fullText = textBlocks.map((b) => b.text).join('\n');

    log.info(
      {
        toolRounds,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
      },
      'Manager agent response',
    );

    return fullText;
  }

  log.warn('Max tool rounds exceeded');
  return 'No pude completar el análisis — se excedió el límite de consultas. Escalando al equipo técnico.';
}

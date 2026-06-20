import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { getOpenAIClient, MODEL_GPT4O } from '../../shared/ai/client.js';
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

// ---------------------------------------------------------------------------
// Convert Anthropic tool definitions to OpenAI format
// ---------------------------------------------------------------------------

function toOpenAITools(anthropicTools: Anthropic.Tool[]): OpenAI.ChatCompletionTool[] {
  return anthropicTools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

const openaiTools = toOpenAITools(allManagerTools);

// ---------------------------------------------------------------------------
// Agent: OpenAI GPT-4o with tool-use loop
// ---------------------------------------------------------------------------

/**
 * Run the Manager agent with a given prompt.
 * Returns the final text response from GPT-4o.
 */
export async function runManagerAgent(
  userPrompt: string,
  options: AgentOptions = {},
): Promise<string> {
  const client = getOpenAIClient();

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
    log.debug('Memory not available, proceeding without context');
  }

  const systemPrompt = buildManagerPrompt(memoryContext);
  const memoryReminder = 'RECUERDA: Después de analizar, usa write_memory para guardar hallazgos importantes antes de responder.';
  const fullUserMessage = options.preamble
    ? `${options.preamble}\n\n${userPrompt}\n\n${memoryReminder}`
    : `${userPrompt}\n\n${memoryReminder}`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fullUserMessage },
  ];

  let toolRounds = 0;

  while (toolRounds < MAX_TOOL_ROUNDS) {
    const response = await client.chat.completions.create({
      model: MODEL_GPT4O,
      max_tokens: options.maxTokens ?? 2048,
      tools: openaiTools,
      messages,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    if (assistantMessage.tool_calls?.length) {
      toolRounds++;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const toolName = toolCall.function.name;
        let toolInput: Record<string, unknown> = {};
        try {
          toolInput = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          log.warn({ tool: toolName }, 'Failed to parse tool arguments');
        }

        log.debug({ tool: toolName, input: toolInput }, 'Tool call');

        let result: string;
        try {
          result = await executeManagerTool(toolName, toolInput);
        } catch (err: unknown) {
          const errObj = err as Record<string, unknown>;
          const msg = err instanceof Error
            ? err.message || errObj.code || errObj.status || 'Unknown error'
            : String(err);
          log.error({ tool: toolName, err: msg, code: errObj?.code, status: errObj?.status }, 'Tool execution failed');
          result = `Error: ${msg}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      continue;
    }

    // Final text response
    const fullText = assistantMessage.content ?? '';

    log.info(
      {
        toolRounds,
        tokensIn: response.usage?.prompt_tokens,
        tokensOut: response.usage?.completion_tokens,
      },
      'Manager agent response',
    );

    return fullText;
  }

  log.warn('Max tool rounds exceeded');
  return 'No pude completar el análisis — se excedió el límite de consultas. Escalando al equipo técnico.';
}

import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { getZaiClient, MODEL_GLM_5_2, MODEL_GLM_FLASH } from '../../shared/ai/client.js';
import { createLogger } from '../../shared/logger.js';
import { buildManagerPrompt } from './system-prompt.js';
import { allManagerTools, executeManagerTool } from '../tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';
import * as kbRepo from '../../shared/db/repositories/kb.repo.js';

const log = createLogger('manager').child({ module: 'agent' });

const MAX_TOOL_ROUNDS_MINI = 4;
const MAX_TOOL_ROUNDS_FULL = 8;

// ---------------------------------------------------------------------------
// Model router: GLM-5.2 for complex analysis, GLM-4.7-Flash for simple lookups
// ---------------------------------------------------------------------------

const COMPLEX_PATTERNS = [
  /an[aá]li(sis|za|ce)/i,
  /estrat[eé]gi/i,
  /compar[ae]/i,
  /tendencia/i,
  /correlaci[oó]n/i,
  /reporte/i,
  /diagn[oó]stic/i,
  /recomend/i,
  /oportunidad/i,
  /riesgo/i,
  /proyecci[oó]n/i,
  /impacto/i,
  /por\s*qu[eé]/i,
  /c[oó]mo\s+(mejor|aument|reduc|optimi)/i,
  /cross.*analy/i,
  /margin|margen/i,
  /rentabilidad/i,
  /segmenta/i,
  /churn/i,
  /retenci[oó]n/i,
  /cruza|cruzar|cruce/i,
  /plan\s+de\s+acci[oó]n/i,
  /plan\s+para/i,
  /resumen.*(semana|mes|dia)/i,
  /qu[eé]\s+(hago|hacemos|sugieres|recomiendas)/i,
  /evalua|eval[uú]a/i,
  /optimiz/i,
  /priori(za|dad)/i,
];

function selectModel(prompt: string): string {
  const isComplex = COMPLEX_PATTERNS.some((p) => p.test(prompt));
  const model = isComplex ? MODEL_GLM_5_2 : MODEL_GLM_FLASH;
  log.debug({ model, isComplex, prompt: prompt.slice(0, 80) }, 'Model selected');
  return model;
}

interface AgentOptions {
  /** Extra context to prepend (e.g., "This is an hourly diagnostic run"). */
  preamble?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  /** Force a specific model (bypasses router). */
  model?: string;
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
// Agent: Z.ai GLM with tool-use loop
// ---------------------------------------------------------------------------

/**
 * Run the Manager agent with a given prompt.
 * Returns the final text response from the GLM model.
 */
export async function runManagerAgent(
  userPrompt: string,
  options: AgentOptions = {},
): Promise<string> {
  const client = getZaiClient();

  // Load memories: semantic search (RAG) with fallback to recent
  let memoryContext: string | undefined;
  try {
    let memories = await memoryRepo.searchMemoriesBySimilarity(userPrompt, 8).catch(() => null);
    if (!memories || memories.length === 0) {
      memories = await memoryRepo.findMemories(undefined, undefined, 10);
    }
    if (memories.length > 0) {
      memoryContext = memories
        .map((m) => `[${m.category}] ${m.subject}: ${m.content}` + (m.outcome ? ` → Resultado: ${m.outcome}` : ''))
        .join('\n');
    }
  } catch {
    log.debug('Memory not available, proceeding without context');
  }

  // Load relevant domain knowledge from KB
  let knowledgeContext: string | undefined;
  try {
    const kbResults = await kbRepo.searchKnowledge(userPrompt, 5).catch(() => null);
    if (kbResults && kbResults.length > 0) {
      const relevant = kbResults.filter((r) => r.score > 0.3);
      if (relevant.length > 0) {
        knowledgeContext = relevant.map((r) => r.content).join('\n\n');
      }
    }
  } catch {
    log.debug('Knowledge base not available, proceeding without KB context');
  }

  const systemPrompt = buildManagerPrompt(memoryContext, knowledgeContext);
  const fullUserMessage = options.preamble
    ? `${options.preamble}\n\n${userPrompt}`
    : userPrompt;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fullUserMessage },
  ];

  const model = options.model ?? selectModel(userPrompt);
  const maxRounds = model === MODEL_GLM_FLASH ? MAX_TOOL_ROUNDS_MINI : MAX_TOOL_ROUNDS_FULL;
  let toolRounds = 0;

  while (toolRounds < maxRounds) {
    const response = await client.chat.completions.create({
      model,
      max_tokens: options.maxTokens ?? 8192,
      tools: openaiTools,
      messages,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // GLM reasoning models put thinking in reasoning_content and answer in content.
    // If content is empty but reasoning happened, the model ran out of tokens.
    if (!assistantMessage.content && !assistantMessage.tool_calls?.length) {
      log.warn({ finish_reason: choice.finish_reason }, 'Empty content from reasoning model — retrying with more tokens');
      const retry = await client.chat.completions.create({
        model,
        max_tokens: 16384,
        messages,
      });
      assistantMessage.content = retry.choices[0].message.content ?? '';
    }

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
    let fullText = assistantMessage.content ?? '';

    // Safety net: if the response is just a memory confirmation without real content,
    // re-prompt to get the actual analysis. The user can't see tool results.
    if (fullText.length < 200 && /guard(ado|é)|memoria|referencia futura|ha sido (guardad|registrad)/i.test(fullText)) {
      log.warn('Response is just a memory confirmation — re-prompting for actual content');
      messages.push(assistantMessage);
      messages.push({
        role: 'user',
        content: 'No respondiste con el análisis. El usuario NO puede ver los resultados de las herramientas — solo ve tu respuesta de texto. Responde con el análisis completo: datos, números y recomendaciones concretas. NO menciones la memoria ni que guardaste algo.',
      });

      const retry = await client.chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 8192,
        messages,
      });

      const retryText = retry.choices[0].message.content;
      if (retryText && retryText.length > fullText.length) {
        fullText = retryText;
      }
    }

    log.info(
      {
        model,
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

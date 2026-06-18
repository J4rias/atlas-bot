import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, MODEL_SONNET } from '../../shared/ai/client.js';
import { erpToolDefinitions, executeErpTool } from '../../shared/ai/tools/index.js';
import { quotePriceToolDef, executeQuotePrice, upsellSuggestToolDef, executeUpsellSuggest } from '../tools/index.js';
import { createLogger } from '../../shared/logger.js';
import { buildSystemPrompt } from './system-prompt.js';
import type { ConversationState, CustomerProfile } from './manager.js';
import { addAssistantMessage, setStage, setProfile } from './manager.js';
import type { SalesStage } from './stages.js';
import { SALES_STAGES } from './stages.js';

const log = createLogger('consultant').child({ module: 'agent' });

// Max tool-use iterations to prevent infinite loops
const MAX_TOOL_ROUNDS = 5;

// All tools available to the Consultant
const consultantTools: Anthropic.Tool[] = [
  ...erpToolDefinitions,
  quotePriceToolDef,
  upsellSuggestToolDef,
];

/**
 * Process a user message through Claude and return the text response.
 *
 * Handles the full tool-use loop: Claude may call tools multiple times
 * before producing a final text response.
 */
export async function getAgentResponse(
  conversation: ConversationState,
): Promise<string> {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(conversation.stage, conversation.profile);

  let toolRounds = 0;
  // Build a working copy of messages for this request
  const messages: Anthropic.MessageParam[] = [...conversation.messages];

  while (toolRounds < MAX_TOOL_ROUNDS) {
    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1024,
      system: systemPrompt,
      tools: consultantTools,
      messages,
    });

    // Check if Claude wants to use tools
    if (response.stop_reason === 'tool_use') {
      toolRounds++;

      // Collect all tool uses from the response
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use',
      );

      // Add Claude's response (with tool_use blocks) to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        log.debug({ tool: toolUse.name, input: toolUse.input }, 'Tool call');
        try {
          let result: string;
          if (toolUse.name === 'quote_price') {
            result = await executeQuotePrice(toolUse.input as unknown as Parameters<typeof executeQuotePrice>[0]);
          } else if (toolUse.name === 'suggest_upsell') {
            result = await executeUpsellSuggest(toolUse.input as unknown as Parameters<typeof executeUpsellSuggest>[0]);
          } else {
            result = await executeErpTool(toolUse.name, toolUse.input);
          }
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
            content: `Error al consultar: ${msg}`,
            is_error: true,
          });
        }
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Claude produced a final text response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const fullText = textBlocks.map((b) => b.text).join('\n');

    // Save the final assistant message to conversation history
    addAssistantMessage(conversation, fullText);

    // Detect sales stage and customer profile from conversation
    detectStage(conversation, fullText);
    detectProfile(conversation);

    log.info(
      {
        senderId: conversation.senderId,
        stage: conversation.stage,
        profile: conversation.profile,
        toolRounds,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
      },
      'Agent response',
    );

    return fullText;
  }

  // Safety: exceeded max tool rounds
  log.warn({ senderId: conversation.senderId }, 'Max tool rounds exceeded');
  const fallback =
    'Disculpe, estoy teniendo dificultades para consultar la información. ¿Podría intentarlo de nuevo en un momento?';
  addAssistantMessage(conversation, fallback);
  return fallback;
}

// ---------------------------------------------------------------------------
// Simple stage detection based on response content
// ---------------------------------------------------------------------------

function detectStage(conversation: ConversationState, text: string) {
  const lower = text.toLowerCase();

  // Detection heuristics — order matters (later stages override earlier)
  if (conversation.stage === 'greeting' && conversation.messages.length > 2) {
    setStage(conversation, 'discovery');
  }

  if (lower.includes('precio') || lower.includes('cuesta') || lower.includes('cotizac')) {
    if (conversation.stage === 'discovery' || conversation.stage === 'greeting') {
      setStage(conversation, 'presentation');
    }
  }

  if (lower.includes('tasa') || lower.includes('moneda') || lower.includes('pagar en')) {
    if (conversation.stage === 'presentation') {
      setStage(conversation, 'quotation');
    }
  }

  if (lower.includes('pre-orden') || lower.includes('pedido') || lower.includes('confirmar')) {
    setStage(conversation, 'closing');
  }
}

// ---------------------------------------------------------------------------
// Customer profile detection based on user messages
// ---------------------------------------------------------------------------

const MAYORISTA_SIGNALS = [
  'por mayor', 'al mayor', 'mayoreo', 'bulto', 'bultos',
  'para mi negocio', 'para el negocio', 'para la tienda',
  'tengo un local', 'tengo una tienda', 'mi bodega',
  'cajas completas', 'por cantidad', 'en cantidad',
  'compro bastante', 'compro regular',
];

const MINORISTA_SIGNALS = [
  'para mi casa', 'personal', 'unidad', 'poquito',
  'una sola', 'un solo', 'al detal', 'al detalle',
  'para consumo', 'para la casa',
];

function detectProfile(conversation: ConversationState) {
  // Don't downgrade once detected (mayorista/minorista are sticky)
  if (conversation.profile === 'mayorista' || conversation.profile === 'minorista') return;

  // Scan user messages for signals
  const userTexts = conversation.messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : '').toLowerCase());

  const combined = userTexts.join(' ');

  const mayorista = MAYORISTA_SIGNALS.some((s) => combined.includes(s));
  const minorista = MINORISTA_SIGNALS.some((s) => combined.includes(s));

  if (mayorista && !minorista) {
    setProfile(conversation, 'mayorista');
  } else if (minorista && !mayorista) {
    setProfile(conversation, 'minorista');
  } else if (conversation.profile === 'unknown' && conversation.messages.length >= 6) {
    // After several exchanges without clear signals → indeciso
    setProfile(conversation, 'indeciso');
  }
}

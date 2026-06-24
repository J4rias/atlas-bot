import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config/index.js';

let anthropicInstance: Anthropic | null = null;
let openaiInstance: OpenAI | null = null;
let zaiInstance: OpenAI | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicInstance) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    anthropicInstance = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropicInstance;
}

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    if (!config.openai.apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    openaiInstance = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiInstance;
}

/** Z.ai client — OpenAI-compatible SDK pointed at Z.ai's base URL. */
export function getZaiClient(): OpenAI {
  if (!zaiInstance) {
    if (!config.zai.apiKey) {
      throw new Error('ZAI_API_KEY is not configured');
    }
    zaiInstance = new OpenAI({
      apiKey: config.zai.apiKey,
      baseURL: 'https://api.z.ai/api/paas/v4',
    });
  }
  return zaiInstance;
}

// Anthropic models (Consultant)
export const MODEL_SONNET = 'claude-sonnet-4-6-20250514';
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

// Z.ai models (Manager)
export const MODEL_GLM_5_2 = 'glm-5.2';
export const MODEL_GLM_FLASH = 'glm-4.7-flash';


import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../config/index.js';

let anthropicInstance: Anthropic | null = null;
let openaiInstance: OpenAI | null = null;

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

export const MODEL_SONNET = 'claude-sonnet-4-6-20250514';
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_GPT4O = 'gpt-4o';
export const MODEL_GPT4O_MINI = 'gpt-4o-mini';

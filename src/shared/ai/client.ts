import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';

let instance: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!instance) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    instance = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return instance;
}

export const MODEL_SONNET = 'claude-sonnet-4-6-20250514';
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

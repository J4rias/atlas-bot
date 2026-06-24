import dotenv from 'dotenv';
dotenv.config();

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function envOptional(key: string): string | undefined {
  return process.env[key] || undefined;
}

export const config = {
  port: parseInt(env('PORT', '3001'), 10),
  nodeEnv: env('NODE_ENV', 'development'),
  isDev: env('NODE_ENV', 'development') === 'development',

  erp: {
    baseUrl: env('ERP_BASE_URL', 'http://localhost:3000'),
    token: env('ERP_API_TOKEN', ''),
  },

  db: {
    url: envOptional('DATABASE_URL'),
  },

  anthropic: {
    apiKey: envOptional('ANTHROPIC_API_KEY'),
  },

  openai: {
    apiKey: envOptional('OPENAI_API_KEY'),
  },

  zai: {
    apiKey: envOptional('ZAI_API_KEY'),
  },

  // Mode 1: Consultant (Messenger)
  meta: {
    verifyToken: envOptional('META_VERIFY_TOKEN'),
    pageAccessToken: envOptional('META_PAGE_ACCESS_TOKEN'),
    appSecret: envOptional('META_APP_SECRET'),
  },

  // Mode 2: Manager (Telegram)
  telegram: {
    botToken: envOptional('TELEGRAM_BOT_TOKEN'),
  },
} as const;

/** Validate that required vars for a specific mode are present. */
export function validateMode(mode: 'consultant' | 'manager'): void {
  const missing: string[] = [];

  // Both modes need at least one AI provider
  if (!config.anthropic.apiKey && !config.openai.apiKey) missing.push('ANTHROPIC_API_KEY or OPENAI_API_KEY');
  if (!config.db.url) missing.push('DATABASE_URL');

  if (mode === 'consultant') {
    if (!config.meta.verifyToken) missing.push('META_VERIFY_TOKEN');
    if (!config.meta.pageAccessToken) missing.push('META_PAGE_ACCESS_TOKEN');
    if (!config.meta.appSecret) missing.push('META_APP_SECRET');
  }

  if (mode === 'manager') {
    if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
  }

  if (missing.length > 0) {
    console.warn(
      `[${mode}] Missing env vars (some features disabled): ${missing.join(', ')}`,
    );
  }
}

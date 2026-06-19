import type { Recipient } from './types.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'recipients' });

// Cache recipients for 5 minutes
let cachedRecipients: Recipient[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60_000;

/**
 * Get authorized recipients.
 *
 * Phase 2 (now): reads from MANAGER_RECIPIENTS env var as JSON array.
 * Future: fetches from ERP GET /api/bot-config/manager/recipients.
 */
export async function getRecipients(): Promise<Recipient[]> {
  if (cachedRecipients && Date.now() < cacheExpiry) {
    return cachedRecipients;
  }

  // TODO: fetch from ERP when endpoint is available
  // try {
  //   const { data } = await erpClient.get('/api/bot-config/manager/recipients');
  //   cachedRecipients = data;
  // }

  // Fallback: parse from env vars
  // Simple format: MANAGER_BOSS_CHATS=-5251715600,1141337487
  //                MANAGER_TECH_CHATS=1141337487
  // Legacy JSON format: MANAGER_RECIPIENTS=[{...}]
  const bossChats = process.env.MANAGER_BOSS_CHATS;
  const techChats = process.env.MANAGER_TECH_CHATS;

  if (bossChats || techChats) {
    const parsed: Recipient[] = [];
    if (bossChats) {
      for (const id of bossChats.split(',')) {
        const chatId = id.trim();
        if (chatId) parsed.push({ chatId, name: `boss_${chatId}`, role: 'boss', active: true });
      }
    }
    if (techChats) {
      for (const id of techChats.split(',')) {
        const chatId = id.trim();
        if (chatId) parsed.push({ chatId, name: `tech_${chatId}`, role: 'tech', active: true });
      }
    }
    cachedRecipients = parsed;
    cacheExpiry = Date.now() + CACHE_TTL;
    return cachedRecipients;
  }

  // Legacy JSON format
  const raw = process.env.MANAGER_RECIPIENTS;
  if (raw) {
    try {
      cachedRecipients = JSON.parse(raw) as Recipient[];
      cacheExpiry = Date.now() + CACHE_TTL;
      return cachedRecipients;
    } catch {
      log.error('Invalid MANAGER_RECIPIENTS JSON');
    }
  }

  // Default: empty (no one authorized)
  cachedRecipients = [];
  cacheExpiry = Date.now() + CACHE_TTL;
  return cachedRecipients;
}

/** Get only boss-role recipients. */
export async function getBossRecipients(): Promise<Recipient[]> {
  const all = await getRecipients();
  return all.filter((r) => r.role === 'boss' && r.active);
}

/** Get only tech-role recipients. */
export async function getTechRecipients(): Promise<Recipient[]> {
  const all = await getRecipients();
  return all.filter((r) => r.role === 'tech' && r.active);
}

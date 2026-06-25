import { EventEmitter } from 'node:events';

/** Central event bus for cross-cutting triggers between scheduler jobs and notifications. */
export const eventBus = new EventEmitter();

// Event types for type safety
export interface ArbitrageFlashAnalysis {
  actionable: boolean;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
  direction: 'buy_usdt' | 'sell_usdt' | 'cross_fiat' | 'none';
  summary: string;
}

export interface ManagerEvents {
  'arbitrage:opportunity': {
    premiums: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    deltas: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    erpRates: { usd_ves: number; ves_cop: number; usd_cop: number };
    p2pMedians: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    flashAnalysis: ArbitrageFlashAnalysis;
    timestamp: string;
  };
  'stock:critical-low-batch': { productId: number; productName: string; currentStock: number; stockDisplay: string }[];
  'diagnostic:complete': { wasRelevant: boolean; summary: string };
}

export type EventName = keyof ManagerEvents;

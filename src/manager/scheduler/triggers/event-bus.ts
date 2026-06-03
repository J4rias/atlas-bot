import { EventEmitter } from 'node:events';

/** Central event bus for cross-cutting triggers between scheduler jobs and notifications. */
export const eventBus = new EventEmitter();

// Event types for type safety
export interface ManagerEvents {
  'rate:significant-change': { currency: string; oldRate: number; newRate: number; deltaPct: number };
  'stock:critical-low': { productId: number; productName: string; currentStock: number; averageSales: number };
  'diagnostic:complete': { wasRelevant: boolean; summary: string };
}

export type EventName = keyof ManagerEvents;

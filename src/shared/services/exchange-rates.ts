import { getExchangeRates, type ExchangeRate } from './erp.js';
import { createLogger } from '../logger.js';

const log = createLogger('consultant').child({ module: 'rates' });

// ---------------------------------------------------------------------------
// Rate snapshot — captures rates at a specific moment with expiry
// ---------------------------------------------------------------------------

export interface RateSnapshot {
  rates: Record<string, number>;
  capturedAt: Date;
  expiresAt: Date;
}

/** Default snapshot validity in minutes. */
const SNAPSHOT_VALIDITY_MIN = 15;

/**
 * Capture a rate snapshot from current ERP rates.
 * The snapshot is valid for `validityMinutes` (default 15).
 */
export async function captureRateSnapshot(
  validityMinutes = SNAPSHOT_VALIDITY_MIN,
): Promise<RateSnapshot> {
  const erpRates = await getExchangeRates();

  const rates: Record<string, number> = {};
  for (const r of erpRates) {
    rates[r.to_currency] = r.rate;
  }
  // Alias: ERP uses 'VES', consultant code uses 'BS'
  if (rates['VES'] && !rates['BS']) {
    rates['BS'] = rates['VES'];
  }

  const now = new Date();
  const snapshot: RateSnapshot = {
    rates,
    capturedAt: now,
    expiresAt: new Date(now.getTime() + validityMinutes * 60_000),
  };

  log.debug({ currencies: Object.keys(rates), validityMinutes }, 'Rate snapshot captured');
  return snapshot;
}

/** Check if a snapshot is still valid. */
export function isSnapshotValid(snapshot: RateSnapshot): boolean {
  return new Date() < snapshot.expiresAt;
}

/**
 * Convert an amount from USD to a target currency using a snapshot.
 * Returns null if the currency is not in the snapshot.
 */
export function convertFromUsd(
  amountUsd: number,
  targetCurrency: string,
  snapshot: RateSnapshot,
): number | null {
  if (targetCurrency === 'USD') return amountUsd;

  const rate = snapshot.rates[targetCurrency];
  if (rate == null) return null;

  return amountUsd * rate;
}

/** List of supported currencies with display names. */
export const CURRENCIES: Record<string, string> = {
  USD: 'Dólares (USD)',
  COP: 'Pesos colombianos (COP)',
  BS: 'Bolívares (BS)',
  USDT: 'USDT (Tether)',
  BANCOLOMBIA: 'Bancolombia (COP transferencia)',
};

/**
 * Format a price in a given currency for display.
 */
export function formatPrice(amount: number, currency: string): string {
  switch (currency) {
    case 'USD':
    case 'USDT':
      return `$${amount.toFixed(2)} ${currency}`;
    case 'COP':
    case 'BANCOLOMBIA':
      return `$${amount.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP`;
    case 'BS':
      return `Bs. ${amount.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
    default:
      return `${amount.toFixed(2)} ${currency}`;
  }
}

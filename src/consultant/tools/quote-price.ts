import type Anthropic from '@anthropic-ai/sdk';
import * as erp from '../../shared/services/erp.js';
import {
  captureRateSnapshot,
  convertFromUsd,
  formatPrice,
  isSnapshotValid,
  CURRENCIES,
  type RateSnapshot,
} from '../../shared/services/exchange-rates.js';

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const quotePriceToolDef: Anthropic.Tool = {
  name: 'quote_price',
  description:
    'Generate a formal multi-currency price quotation for one or more products. ' +
    'Takes a list of items (presentation IDs + quantities) and a target currency. ' +
    'Returns a detailed quotation with unit prices, line totals, grand total, ' +
    'the exchange rate used, and the quotation expiry time. ' +
    'Use this when the customer wants a formal quote or asks to pay in a specific currency.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        description: 'List of items to quote',
        items: {
          type: 'object',
          properties: {
            presentation_id: {
              type: 'number',
              description: 'The presentation ID from the price list',
            },
            quantity: {
              type: 'number',
              description: 'Number of packages to quote',
            },
            product_name: {
              type: 'string',
              description: 'Product name for display in the quotation',
            },
            presentation_name: {
              type: 'string',
              description: 'Presentation name (e.g., "Paquete 12 uds")',
            },
          },
          required: ['presentation_id', 'quantity'],
        },
      },
      currency: {
        type: 'string',
        enum: Object.keys(CURRENCIES),
        description: 'Target currency for the quotation (USD, COP, BS, USDT, BANCOLOMBIA)',
      },
    },
    required: ['items', 'currency'],
  },
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface QuoteItem {
  presentation_id: number;
  quantity: number;
  product_name?: string;
  presentation_name?: string;
}

interface QuoteInput {
  items: QuoteItem[];
  currency: string;
}

export async function executeQuotePrice(input: QuoteInput): Promise<string> {
  const { items, currency } = input;

  if (!items || items.length === 0) {
    return JSON.stringify({ error: 'No items provided for quotation.' });
  }

  // Get price map and rate snapshot
  const [priceMap, snapshot] = await Promise.all([
    erp.getPriceMap(),
    captureRateSnapshot(),
  ]);

  const lineItems: {
    product: string;
    presentation: string;
    quantity: number;
    unitPriceUsd: number;
    unitPriceLocal: number;
    lineTotalLocal: number;
  }[] = [];

  let grandTotalUsd = 0;

  for (const item of items) {
    const prices = priceMap.get(item.presentation_id);
    if (!prices) {
      return JSON.stringify({
        error: `No price found for presentation_id ${item.presentation_id}. Check the price list.`,
      });
    }

    const unitPriceUsd = prices.packagePrice;
    const unitPriceLocal = convertFromUsd(unitPriceUsd, currency, snapshot);

    if (unitPriceLocal == null) {
      return JSON.stringify({
        error: `Currency "${currency}" not found in exchange rates. Available: ${Object.keys(snapshot.rates).join(', ')}`,
      });
    }

    const lineTotalLocal = unitPriceLocal * item.quantity;
    grandTotalUsd += unitPriceUsd * item.quantity;

    lineItems.push({
      product: item.product_name ?? `Producto #${item.presentation_id}`,
      presentation: item.presentation_name ?? `Presentación #${item.presentation_id}`,
      quantity: item.quantity,
      unitPriceUsd,
      unitPriceLocal,
      lineTotalLocal,
    });
  }

  const grandTotalLocal = convertFromUsd(grandTotalUsd, currency, snapshot) ?? grandTotalUsd;
  const rateUsed = snapshot.rates[currency] ?? 1;

  // Build quotation response
  const quotation = {
    currency,
    currency_name: CURRENCIES[currency] ?? currency,
    rate_used: rateUsed,
    rate_captured_at: snapshot.capturedAt.toISOString(),
    quotation_valid_until: snapshot.expiresAt.toISOString(),
    items: lineItems.map((li) => ({
      product: li.product,
      presentation: li.presentation,
      quantity: li.quantity,
      unit_price: formatPrice(li.unitPriceLocal, currency),
      line_total: formatPrice(li.lineTotalLocal, currency),
    })),
    grand_total_usd: formatPrice(grandTotalUsd, 'USD'),
    grand_total: formatPrice(grandTotalLocal, currency),
    note:
      currency === 'USD'
        ? 'Precios en dólares americanos.'
        : `Tasa Atlas aplicada: 1 USD = ${rateUsed} ${currency}. Cotización válida por 15 minutos.`,
  };

  return JSON.stringify(quotation);
}

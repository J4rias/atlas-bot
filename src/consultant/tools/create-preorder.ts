import type Anthropic from '@anthropic-ai/sdk';
import { createPreOrder } from '../../shared/services/erp.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('consultant').child({ module: 'preorder' });

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const createPreorderToolDef: Anthropic.Tool = {
  name: 'create_preorder',
  description:
    'Create a pre-order in the ERP system. Use this when the customer confirms they want to buy. ' +
    'The pre-order will be reviewed and approved by a human operator — no sale is final until approved. ' +
    'You MUST confirm the product list, quantities, and currency with the customer before calling this tool.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        description: 'List of items for the pre-order',
        items: {
          type: 'object',
          properties: {
            presentation_id: {
              type: 'number',
              description: 'The presentation ID from the product catalog',
            },
            quantity: {
              type: 'number',
              description: 'Number of packages (or units if is_unit=true)',
            },
            unit_price: {
              type: 'number',
              description: 'Unit price in USD (from the price list). Optional — ERP uses current price if omitted.',
            },
            is_unit: {
              type: 'boolean',
              description: 'True if quantity refers to individual units instead of packages (default false)',
            },
          },
          required: ['presentation_id', 'quantity'],
        },
      },
      customer_name: {
        type: 'string',
        description: 'Customer name if provided during conversation (optional)',
      },
      customer_phone: {
        type: 'string',
        description: 'Customer phone number if provided (optional)',
      },
      currency: {
        type: 'string',
        description: 'Currency for the pre-order (default USD)',
      },
      notes: {
        type: 'string',
        description: 'Any relevant notes about the order (delivery preferences, special requests, etc.)',
      },
    },
    required: ['items'],
  },
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface PreorderToolInput {
  items: Array<{
    presentation_id: number;
    quantity: number;
    unit_price?: number;
    is_unit?: boolean;
  }>;
  customer_name?: string;
  customer_phone?: string;
  currency?: string;
  notes?: string;
}

export async function executeCreatePreorder(
  input: PreorderToolInput,
  channel: 'messenger' | 'telegram' | 'web' = 'messenger',
): Promise<string> {
  const { items, customer_name, customer_phone, currency, notes } = input;

  if (!items || items.length === 0) {
    return JSON.stringify({ error: 'No se proporcionaron productos para la pre-orden.' });
  }

  log.info(
    { itemCount: items.length, channel, customer: customer_name ?? 'anonymous' },
    'Creating pre-order',
  );

  const preOrder = await createPreOrder({
    customer_name,
    customer_phone,
    channel,
    currency: currency ?? 'USD',
    notes,
    items: items.map((i) => ({
      presentation_id: i.presentation_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      is_unit: i.is_unit,
    })),
  });

  return JSON.stringify({
    success: true,
    code: preOrder.code,
    status: preOrder.status,
    total: preOrder.total,
    currency: preOrder.currency,
    items_count: preOrder.details.length,
    message: `Pre-orden ${preOrder.code} creada exitosamente. Un operador la revisará pronto.`,
  });
}

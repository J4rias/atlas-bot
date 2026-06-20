import type Anthropic from '@anthropic-ai/sdk';
import * as erp from '../../services/erp.js';

// ---------------------------------------------------------------------------
// Tool definitions (passed to Claude API)
// ---------------------------------------------------------------------------

export const erpToolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the product catalog. Returns products with name, SKU, category, brand, presentations, and stock. Use this when the customer asks about a product or you need to look up availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category_id: {
          type: 'number',
          description: 'Filter by category ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_prices',
    description:
      'Get the current price list. Returns prices per presentation (package and unit). Prices are in the base currency (USD). Use this to quote prices to the customer.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_exchange_rates',
    description:
      'Get current exchange rates (Tasa Atlas). Returns rates for all currencies: USD, COP, BS (VES), USDT, Bancolombia. Use this to convert prices to the customer\'s preferred currency.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_categories',
    description:
      'List all product categories. Returns category names, codes, and product counts.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

export async function executeErpTool(
  name: string,
  input: ToolInput,
): Promise<string> {
  switch (name) {
    case 'search_products': {
      const categoryId = input.category_id as number | undefined;
      const products = await erp.getProducts(categoryId);
      const summary = products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category?.name ?? 'Sin categoría',
        brand: p.brand?.name ?? null,
        stock: erp.totalStock(p),
        presentations: p.presentations.map((pr) => ({
          id: pr.id,
          name: pr.name,
          units_per_package: pr.units_per_package,
        })),
      }));
      return JSON.stringify(summary);
    }

    case 'get_prices': {
      const priceMap = await erp.getPriceMap();
      const entries: Record<string, { packagePrice: number; unitPrice: number }> = {};
      for (const [id, prices] of priceMap) {
        entries[String(id)] = prices;
      }
      return JSON.stringify(entries);
    }

    case 'get_exchange_rates': {
      const rates = await erp.getExchangeRates();
      const formatted = rates.map((r) => ({
        from: r.from_currency,
        to: r.to_currency,
        rate: r.rate,
        date: r.effective_date,
      }));
      return JSON.stringify(formatted);
    }

    case 'get_categories': {
      const categories = await erp.getCategories();
      return JSON.stringify(
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          productCount: c.productCount,
        })),
      );
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

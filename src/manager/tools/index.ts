import type Anthropic from '@anthropic-ai/sdk';
import { erpToolDefinitions, executeErpTool } from '../../shared/ai/tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';
import * as erp from '../../shared/services/erp.js';

// ---------------------------------------------------------------------------
// Manager-specific tool definitions
// ---------------------------------------------------------------------------

const memoryTools: Anthropic.Tool[] = [
  {
    name: 'read_memory',
    description:
      'Read your own long-term memory. Search for past observations, decisions, insights, or rules you have stored. Use this to recall what you have learned before making recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category: observation, decision, insight, rule, escalation, feedback',
        },
        subject_pattern: {
          type: 'string',
          description: 'Search term to match against the subject (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'write_memory',
    description:
      'Save a new observation, insight, decision, or rule to your long-term memory. Use this when you discover something worth remembering for future analyses.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['observation', 'decision', 'insight', 'rule', 'feedback'],
          description: 'Type of memory to store',
        },
        subject: {
          type: 'string',
          description: 'Short topic identifier (e.g., "sales_trend_weekly", "rate_cop_friday")',
        },
        content: {
          type: 'string',
          description: 'The content of the memory — what you learned or decided',
        },
        confidence: {
          type: 'number',
          description: 'How confident you are in this observation (0.0-1.0, default 0.8)',
        },
      },
      required: ['category', 'subject', 'content'],
    },
  },
];

const businessIntelligenceTools: Anthropic.Tool[] = [
  {
    name: 'get_sales_summary',
    description:
      'Get a sales summary for a date range: total count, revenue, paid vs credit, and top-selling products. ' +
      'Defaults to today if no dates provided. Use this for a quick executive overview of sales performance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (default: today)',
        },
        to: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (default: same as from)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_sales_stats',
    description:
      'Get detailed sales statistics: breakdown by sale type (cash/credit/mixed), by currency, by status, ' +
      'and top products by revenue. Use this for deeper analysis when the summary is not enough.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        warehouse_id: {
          type: 'number',
          description: 'Filter by warehouse ID (optional)',
        },
        top_limit: {
          type: 'number',
          description: 'How many top products to return (default 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_inventory_health',
    description:
      'Get a consolidated inventory health report: products below reorder point (low stock), ' +
      'products expiring soon, and total inventory valuation. Returns all three in a single call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        warehouse_id: {
          type: 'number',
          description: 'Filter by warehouse ID (optional — all warehouses by default)',
        },
        expiring_days: {
          type: 'number',
          description: 'Show products expiring within this many days (default 30)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_rate_history',
    description:
      'Get historical exchange rates to analyze trends. Filter by currency pair and date range. ' +
      'Use this to detect rate volatility and advise on pricing adjustments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_currency: {
          type: 'string',
          description: 'Source currency (e.g., "USD")',
        },
        to_currency: {
          type: 'string',
          description: 'Target currency (e.g., "VES", "COP")',
        },
        date_from: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        date_to: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
        limit: {
          type: 'number',
          description: 'Max records to return (default 50)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_preorder_pipeline',
    description:
      'Get pre-order pipeline status: counts (pending/approved/today) and list of recent pre-orders. ' +
      'Use this to track bot-generated demand and conversion to actual sales.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'rejected', 'converted', 'expired'],
          description: 'Filter by status (optional — all statuses by default)',
        },
        channel: {
          type: 'string',
          enum: ['messenger', 'telegram', 'web'],
          description: 'Filter by channel (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max pre-orders to return (default 20)',
        },
      },
      required: [],
    },
  },
];

/** All tools available to the Manager: shared ERP tools + BI tools + memory tools. */
export const allManagerTools: Anthropic.Tool[] = [
  ...erpToolDefinitions,
  ...businessIntelligenceTools,
  ...memoryTools,
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

const SHARED_ERP_TOOLS = new Set([
  'search_products', 'get_prices', 'get_exchange_rates', 'get_categories',
]);

export async function executeManagerTool(
  name: string,
  input: ToolInput,
): Promise<string> {
  // Shared ERP tools (catalog, prices, rates, categories)
  if (SHARED_ERP_TOOLS.has(name)) {
    return executeErpTool(name, input);
  }

  switch (name) {
    // ----- Memory tools -----

    case 'read_memory': {
      const category = input.category as string | undefined;
      const subjectPattern = input.subject_pattern as string | undefined;
      const limit = (input.limit as number) ?? 10;

      try {
        const memories = await memoryRepo.findMemories(category, subjectPattern, limit);
        if (memories.length === 0) {
          return JSON.stringify({ result: 'No memories found matching your search.' });
        }
        return JSON.stringify(
          memories.map((m) => ({
            id: m.id,
            category: m.category,
            subject: m.subject,
            content: m.content,
            confidence: m.confidence,
            outcome: m.outcome,
            created_at: m.created_at,
          })),
        );
      } catch {
        return JSON.stringify({ error: 'Database not available — memory read failed.' });
      }
    }

    case 'write_memory': {
      const category = input.category as string;
      const subject = input.subject as string;
      const content = input.content as string;
      const confidence = (input.confidence as number) ?? 0.8;

      try {
        const saved = await memoryRepo.saveMemory({
          category,
          subject,
          content,
          confidence,
          source: 'diagnostic',
        });
        return JSON.stringify({ result: 'Memory saved.', id: saved.id });
      } catch {
        return JSON.stringify({ error: 'Database not available — memory write failed.' });
      }
    }

    // ----- Business intelligence tools -----

    case 'get_sales_summary': {
      const from = input.from as string | undefined;
      const to = input.to as string | undefined;
      const summary = await erp.getSalesSummary(from, to);
      return JSON.stringify(summary);
    }

    case 'get_sales_stats': {
      const stats = await erp.getSalesStats({
        startDate: input.start_date as string | undefined,
        endDate: input.end_date as string | undefined,
        warehouseId: input.warehouse_id as number | undefined,
        topLimit: input.top_limit as number | undefined,
      });
      return JSON.stringify(stats);
    }

    case 'get_inventory_health': {
      const warehouseId = input.warehouse_id as number | undefined;
      const expiringDays = (input.expiring_days as number) ?? 30;

      const [lowStock, expiring, valuation] = await Promise.all([
        erp.getLowStockAlerts(warehouseId),
        erp.getExpiringAlerts(expiringDays, warehouseId),
        erp.getInventoryValuation(warehouseId),
      ]);

      return JSON.stringify({
        low_stock: {
          count: lowStock.length,
          items: lowStock.map((a) => ({
            product: a.product?.name ?? `ID ${a.product_id}`,
            sku: a.product?.sku,
            quantity: a.quantity,
            available: a.available_quantity,
            reorder_point: a.product?.reorder_point,
            category: a.product?.category?.name,
            warehouse: a.warehouse?.name,
          })),
        },
        expiring: {
          count: expiring.length,
          days_threshold: expiringDays,
          items: expiring.map((a) => ({
            product: a.product?.name ?? 'Unknown',
            sku: a.product?.sku,
            batch: a.batch_number,
            expiration_date: a.expiration_date,
            quantity: a.quantity,
            category: a.product?.category?.name,
            warehouse: a.warehouse?.name,
          })),
        },
        valuation: {
          total_usd: valuation.totalValue,
          total_cop: valuation.totalValueCOP,
          products_with_stock: valuation.productsWithStock,
          by_currency: valuation.totalsByCurrency,
        },
      });
    }

    case 'get_rate_history': {
      const history = await erp.getRateHistory({
        fromCurrency: input.from_currency as string | undefined,
        toCurrency: input.to_currency as string | undefined,
        dateFrom: input.date_from as string | undefined,
        dateTo: input.date_to as string | undefined,
        limit: input.limit as number | undefined,
      });

      return JSON.stringify(
        history.map((r) => ({
          from: r.from_currency,
          to: r.to_currency,
          rate: r.rate,
          date: r.effective_date,
          source: r.source,
        })),
      );
    }

    case 'get_preorder_pipeline': {
      const [stats, list] = await Promise.all([
        erp.getPreOrderStats(),
        erp.getPreOrders({
          status: input.status as 'pending' | 'approved' | 'rejected' | 'converted' | 'expired' | undefined,
          channel: input.channel as 'messenger' | 'telegram' | 'web' | undefined,
          limit: (input.limit as number) ?? 20,
        }),
      ]);

      return JSON.stringify({
        stats,
        recent_orders: list.data.map((o) => ({
          code: o.code,
          status: o.status,
          channel: o.channel,
          customer: o.customerName,
          total: o.total,
          currency: o.currency,
          items: o.details.length,
          created_at: o.created_at,
        })),
        total: list.pagination.total,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

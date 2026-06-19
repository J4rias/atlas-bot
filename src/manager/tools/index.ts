import type Anthropic from '@anthropic-ai/sdk';
import { erpToolDefinitions, executeErpTool } from '../../shared/ai/tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';
import * as erp from '../../shared/services/erp.js';
import {
  computeRateSalesCorrelation,
  computeWeeklySeasonality,
  computeCustomerProfitability,
} from '../analysis/computations.js';

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
      'top products by revenue, and gross profit margins. Includes totalCost, grossProfit, grossMarginPct ' +
      'at the global level and per top product. Note: cost data is only reliable from 2026-06-17 onwards.',
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
      'Get a consolidated inventory health report: products below reorder point (low stock) ' +
      'and total inventory valuation. Returns both in a single call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        warehouse_id: {
          type: 'number',
          description: 'Filter by warehouse ID (optional — all warehouses by default)',
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
  {
    name: 'get_customer_insights',
    description:
      'Get CRM insights: customers at churn risk, upcoming reorders, and new customers who never returned. ' +
      'Use this to analyze customer retention and identify sales opportunities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days (default 90)',
        },
        customer_id: {
          type: 'number',
          description: 'Get purchase history for a specific customer (optional)',
        },
      },
      required: [],
    },
  },
];

const crossAnalysisTools: Anthropic.Tool[] = [
  {
    name: 'analyze_rate_sales_impact',
    description:
      'Analyze the correlation between exchange rate movements and sales volume over a date range. ' +
      'Uses Pearson correlation to quantify how rate changes affect sales. ' +
      'Use this reactively when rates change significantly, or in the daily strategic report.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days (default 7)',
        },
        currency: {
          type: 'string',
          description: 'Currency pair to analyze — the "from" currency (e.g., "USD"). Default: all currencies.',
        },
      },
      required: [],
    },
  },
  {
    name: 'analyze_sales_patterns',
    description:
      'Analyze sales patterns: weekly seasonality (best/worst day), volume trends. ' +
      'Use this in the daily strategic report to detect shifts in buying behavior.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days (default 28 — 4 weeks)',
        },
      },
      required: [],
    },
  },
  {
    name: 'analyze_customer_value',
    description:
      'Analyze customer profitability and value segmentation. Ranks customers by revenue, ' +
      'assigns value tiers (high/medium/low), and calculates revenue concentration (top 20% share). ' +
      'Cross-reference with churn risk from get_customer_insights for high-priority retention alerts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days for customer activity (default 30)',
        },
        top_n: {
          type: 'number',
          description: 'Max customers to return in the ranking (default 20)',
        },
      },
      required: [],
    },
  },
];

/** All tools available to the Manager: shared ERP tools + BI tools + cross-analysis tools + memory tools. */
export const allManagerTools: Anthropic.Tool[] = [
  ...erpToolDefinitions,
  ...businessIntelligenceTools,
  ...crossAnalysisTools,
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

      const [lowStock, valuation] = await Promise.all([
        erp.getLowStockAlerts(warehouseId),
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

    case 'get_customer_insights': {
      // If a specific customer is requested, return their purchase history
      if (input.customer_id) {
        const purchases = await erp.getCustomerPurchases(input.customer_id as number);
        return JSON.stringify({
          customer_id: input.customer_id,
          purchases: purchases.map((p) => ({
            date: p.date,
            total_usd: p.total_usd,
            payment_type: p.payment_type,
            items: p.items.map((i) => ({
              product: i.product_name,
              quantity: i.quantity,
              total: i.total,
            })),
          })),
          total_purchases: purchases.length,
        });
      }

      // Otherwise, return aggregated activity with analysis
      const days = (input.days as number) ?? 90;
      const customers = await erp.getCustomerActivity({ days, min_purchases: 1 });

      const today = new Date();
      const churnRisk: Array<Record<string, unknown>> = [];
      const reorderDue: Array<Record<string, unknown>> = [];
      const newInactive: Array<Record<string, unknown>> = [];
      const healthy: Array<Record<string, unknown>> = [];

      for (const c of customers) {
        const daysSinceLast = Math.floor(
          (today.getTime() - new Date(c.last_purchase).getTime()) / 86_400_000,
        );

        if (
          c.total_purchases >= 2 &&
          c.avg_days_between_purchases > 0 &&
          daysSinceLast > c.avg_days_between_purchases * 1.5
        ) {
          churnRisk.push({
            name: c.customer_name,
            phone: c.customer_phone,
            avg_cycle: Math.round(c.avg_days_between_purchases),
            days_since_last: daysSinceLast,
            total_spent: c.total_spent_usd,
            purchases: c.total_purchases,
          });
        } else if (
          c.total_purchases >= 2 &&
          c.avg_days_between_purchases > 0 &&
          daysSinceLast >= c.avg_days_between_purchases - 2
        ) {
          reorderDue.push({
            name: c.customer_name,
            phone: c.customer_phone,
            avg_cycle: Math.round(c.avg_days_between_purchases),
            days_since_last: daysSinceLast,
          });
        } else if (c.total_purchases === 1 && daysSinceLast >= 14) {
          newInactive.push({
            name: c.customer_name,
            phone: c.customer_phone,
            days_since: daysSinceLast,
            spent: c.total_spent_usd,
          });
        } else {
          healthy.push({
            name: c.customer_name,
            purchases: c.total_purchases,
            avg_cycle: Math.round(c.avg_days_between_purchases),
            total_spent: c.total_spent_usd,
          });
        }
      }

      return JSON.stringify({
        period_days: days,
        total_customers: customers.length,
        churn_risk: { count: churnRisk.length, customers: churnRisk },
        reorder_due: { count: reorderDue.length, customers: reorderDue },
        new_inactive: { count: newInactive.length, customers: newInactive },
        healthy: { count: healthy.length },
      });
    }

    // ----- Cross-analysis tools -----

    case 'analyze_rate_sales_impact': {
      const days = (input.days as number) ?? 7;
      const currency = input.currency as string | undefined;
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

      const [dailySales, rateHistory] = await Promise.all([
        erp.getDailySalesSeries(from, to),
        erp.getRateHistory({
          fromCurrency: currency,
          dateFrom: from,
          dateTo: to,
          limit: days * 5, // multiple currencies per day
        }),
      ]);

      const correlation = computeRateSalesCorrelation(dailySales, rateHistory);

      return JSON.stringify({
        period: { from, to, days },
        currency_filter: currency ?? 'all',
        daily_sales_points: dailySales.length,
        rate_data_points: rateHistory.length,
        correlation,
      });
    }

    case 'analyze_sales_patterns': {
      const days = (input.days as number) ?? 28;
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

      const dailySales = await erp.getDailySalesSeries(from, to);
      const seasonality = computeWeeklySeasonality(dailySales);

      // Simple trend: compare first half vs second half
      const mid = Math.floor(dailySales.length / 2);
      const firstHalf = dailySales.slice(0, mid);
      const secondHalf = dailySales.slice(mid);
      const avgFirst = firstHalf.length > 0
        ? firstHalf.reduce((s, d) => s + d.total_usd, 0) / firstHalf.length
        : 0;
      const avgSecond = secondHalf.length > 0
        ? secondHalf.reduce((s, d) => s + d.total_usd, 0) / secondHalf.length
        : 0;
      const trendPct = avgFirst > 0
        ? Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10
        : 0;

      return JSON.stringify({
        period: { from, to, days },
        total_days_with_data: dailySales.length,
        seasonality,
        trend: {
          first_half_avg_usd: Math.round(avgFirst * 100) / 100,
          second_half_avg_usd: Math.round(avgSecond * 100) / 100,
          change_pct: trendPct,
          direction: trendPct > 5 ? 'creciente' : trendPct < -5 ? 'decreciente' : 'estable',
        },
      });
    }

    case 'analyze_customer_value': {
      const days = (input.days as number) ?? 30;
      const topN = (input.top_n as number) ?? 20;

      const [customers, salesStats] = await Promise.all([
        erp.getCustomerActivity({ days, min_purchases: 1 }),
        erp.getSalesStats({
          startDate: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
          endDate: new Date().toISOString().slice(0, 10),
          summaryOnly: true,
        }),
      ]);

      const globalMarginPct = salesStats.grossMarginPct ?? 0;
      const result = computeCustomerProfitability(customers, globalMarginPct);

      return JSON.stringify({
        period_days: days,
        global_gross_margin_pct: globalMarginPct,
        total_customers: result.customers.length,
        top_20pct_revenue_share: result.top20PctRevenueShare,
        total_revenue: result.totalRevenueAllCustomers,
        top_customers: result.customers.slice(0, topN).map((c) => ({
          name: c.customerName,
          revenue: c.totalRevenue,
          margin: c.estimatedMargin,
          purchases: c.purchaseCount,
          avg_order: c.avgOrderValue,
          tier: c.valueTier,
        })),
        tier_summary: {
          high: result.customers.filter((c) => c.valueTier === 'high').length,
          medium: result.customers.filter((c) => c.valueTier === 'medium').length,
          low: result.customers.filter((c) => c.valueTier === 'low').length,
        },
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

import type Anthropic from '@anthropic-ai/sdk';
import { erpToolDefinitions, executeErpTool } from '../../shared/ai/tools/index.js';
import * as memoryRepo from '../../shared/db/repositories/memory.repo.js';
import * as kbRepo from '../../shared/db/repositories/kb.repo.js';
import * as erp from '../../shared/services/erp.js';
import { getUsdtRate, type FiatCurrency } from '../../shared/services/binance-p2p.js';
import { notifyTech } from '../telegram/notifications.js';
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

const knowledgeTools: Anthropic.Tool[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge base for domain expertise: arbitrage rules, regional dynamics, customer behavior patterns, ' +
      'currency behavior, seasonal patterns, and business rules taught by the team. ' +
      'Use this BEFORE making recommendations to ground your analysis in real domain knowledge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to search for (e.g., "tasa sube clientes frenan", "harina diciembre", "colombianos pago COP")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 5)',
        },
      },
      required: ['query'],
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
      'and total inventory valuation. Returns both in a single call. ' +
      'Quantities include quantity_display and available_display formatted as Bultos + unidades sueltas.',
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

const accountsReceivableTools: Anthropic.Tool[] = [
  {
    name: 'get_accounts_receivable',
    description:
      'Get accounts receivable (cuentas por cobrar) from the ERP. Returns aging distribution ' +
      '(vigente, 0-30, 31-60, 61-90, +90 days overdue), total pending amounts in COP, ' +
      'and per-customer breakdown with blocked status. Critical for calculating net liquidity ' +
      '(liquidez neta = assets - liabilities). The pending amount is money owed TO us by customers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        view: {
          type: 'string',
          enum: ['summary', 'customers'],
          description:
            'summary = aging + invoice list (default). customers = grouped by customer with blocked/overdue status.',
        },
        bucket: {
          type: 'string',
          enum: ['vigente', '0_30', '31_60', '61_90', '+90', 'sin_termino'],
          description: 'Filter by aging bucket (optional)',
        },
        search: {
          type: 'string',
          description: 'Search by customer name or invoice number (optional)',
        },
      },
      required: [],
    },
  },
];

const closureTools: Anthropic.Tool[] = [
  {
    name: 'get_daily_closure',
    description:
      'Get the daily cash register closure (cierre de caja) from the ERP. Returns totals in USD and COP, ' +
      'payments breakdown by method and currency, credit collected by currency, and cash refunds. ' +
      'Use this for the end-of-day closing report to match the ERP cierre de caja exactly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (default: today)',
        },
      },
      required: [],
    },
  },
];

const marketDataTools: Anthropic.Tool[] = [
  {
    name: 'get_usdt_rate',
    description:
      'Get current USDT rate from Binance P2P for COP or VES. ' +
      'Returns median, lowest, highest prices plus individual ad details (price, available USDT, merchant, payment methods). ' +
      'USDT has its own market price — NOT 1:1 with USD cash. ' +
      'trade_type BUY = you pay fiat to get USDT. SELL = you give USDT to receive fiat. ' +
      'ARBITRAGE LOGIC: To find the best way to convert fiat to USDT, compare routes: ' +
      '(1) Direct COP→USDT: call with fiat=COP, trade_type=BUY. ' +
      '(2) Indirect COP→VES(frontera)→USDT: call with fiat=VES, trade_type=BUY, then divide the COP amount by the VES/COP frontier rate to get VES, then divide by P2P VES price. ' +
      'If route 2 yields more USDT, the difference is the arbitrage gain. The break-even is when P2P_COP_price / P2P_VES_price equals the frontier VES/COP rate. ' +
      'To sell USDT for fiat, compare SELL prices in COP vs VES — higher price = more fiat per USDT. ' +
      'Use limit=10 for quick rate checks, limit=20 (default) for analysis with ad details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'number',
          description:
            'Transaction amount in USDT to filter ads by availability (optional)',
        },
        trade_type: {
          type: 'string',
          enum: ['BUY', 'SELL'],
          description:
            'BUY = you pay fiat to get USDT. SELL = you give USDT to receive fiat. Default: SELL.',
        },
        fiat: {
          type: 'string',
          enum: ['COP', 'VES'],
          description:
            'Fiat currency. COP = pesos colombianos, VES = bolívares. Default: COP.',
        },
        limit: {
          type: 'number',
          description:
            'Max ads to fetch. Use 10 for quick checks, 20 for default, higher for deep analysis. Default: 20.',
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

const escalationTools: Anthropic.Tool[] = [
  {
    name: 'escalate_to_tech',
    description:
      'Send a technical escalation message to the tech team via Telegram. ' +
      'Use when you encounter API errors, missing data, broken endpoints, or any technical issue ' +
      'that requires developer intervention. Include what failed, the error details, and what you need fixed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The escalation message describing the technical issue, what failed, and what needs fixing',
        },
        priority: {
          type: 'string',
          enum: ['alta', 'media', 'baja'],
          description: 'Priority level: alta (blocking), media (degraded), baja (cosmetic)',
        },
      },
      required: ['message'],
    },
  },
];

/** All tools available to the Manager. */
export const allManagerTools: Anthropic.Tool[] = [
  ...erpToolDefinitions,
  ...businessIntelligenceTools,
  ...accountsReceivableTools,
  ...closureTools,
  ...marketDataTools,
  ...crossAnalysisTools,
  ...escalationTools,
  ...knowledgeTools,
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
    // ----- Knowledge base tools -----

    case 'search_knowledge': {
      const searchQuery = input.query as string;
      const limit = (input.limit as number) ?? 5;

      try {
        const results = await kbRepo.searchKnowledge(searchQuery, limit);
        if (results.length === 0) {
          return JSON.stringify({ results: [], message: 'No matching knowledge found.' });
        }
        return JSON.stringify(
          results.map((r) => ({
            content: r.content,
            category: (r.metadata as Record<string, unknown>).category ?? 'general',
            relevance: Math.round(r.score * 100) + '%',
          })),
        );
      } catch {
        return JSON.stringify({ error: 'Knowledge base not available.' });
      }
    }

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
        // Check if a memory with this subject already exists — supersede instead of duplicating
        const existing = await memoryRepo.findMemories(undefined, subject, 1);
        const exactMatch = existing.find((m) => m.subject === subject);

        let saved;
        if (exactMatch) {
          saved = await memoryRepo.supersedeMemory(exactMatch.id, {
            category,
            subject,
            content,
            confidence,
            source: 'diagnostic',
          });
        } else {
          saved = await memoryRepo.saveMemory({
            category,
            subject,
            content,
            confidence,
            source: 'diagnostic',
          });
        }
        // Generate embedding for semantic search (non-blocking — don't fail the save)
        memoryRepo.saveMemoryEmbedding(saved.id, category, subject, content).catch(() => {});

        return JSON.stringify({ result: exactMatch ? 'Memory updated (superseded previous).' : 'Memory saved.', id: saved.id });
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

      const [lowStock, valuation, products] = await Promise.all([
        erp.getLowStockAlerts(warehouseId),
        erp.getInventoryValuation(warehouseId),
        erp.getProducts(), // cached — used to get presentations for stock display
      ]);

      // Build product_id → presentations map for stock formatting
      const presentationsById = new Map(products.map((p) => [p.id, p.presentations]));

      return JSON.stringify({
        low_stock: {
          count: lowStock.length,
          items: lowStock.map((a) => ({
            product: a.product?.name ?? `ID ${a.product_id}`,
            sku: a.product?.sku,
            quantity: a.quantity,
            quantity_display: erp.formatStock(a.quantity, presentationsById.get(a.product_id) ?? []),
            available: a.available_quantity,
            available_display: erp.formatStock(a.available_quantity, presentationsById.get(a.product_id) ?? []),
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
      const stats = await erp.getPreOrderStats();
      let recentOrders: unknown[] = [];
      let total = 0;
      try {
        const list = await erp.getPreOrders({
          status: input.status as 'pending' | 'approved' | 'rejected' | 'converted' | 'expired' | undefined,
          channel: input.channel as 'messenger' | 'telegram' | 'web' | undefined,
          limit: (input.limit as number) ?? 20,
        });
        recentOrders = list.data.map((o) => ({
          code: o.code,
          status: o.status,
          channel: o.channel,
          customer: o.customerName,
          total: o.total,
          currency: o.currency,
          items: o.details.length,
          created_at: o.created_at,
        }));
        total = list.pagination.total;
      } catch {
        // ERP pre-orders list endpoint has a known bug — return stats only
      }

      return JSON.stringify({ stats, recent_orders: recentOrders, total });
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

    // ----- Accounts Receivable tools -----

    case 'get_accounts_receivable': {
      const view = (input.view as string) ?? 'summary';
      const bucket = input.bucket as string | undefined;
      const search = input.search as string | undefined;

      if (view === 'customers') {
        const result = await erp.getARCustomers({ bucket, search });
        return JSON.stringify({
          totals: result.totals,
          customers: result.customers.slice(0, 30).map((c) => ({
            name: c.customer_name,
            code: c.customer_code,
            pending_invoices: c.pending_invoices,
            adeudado_cop: c.total_adeudado_cop,
            overdue_cop: c.overdue_cop,
            worst_bucket: c.worst_bucket,
            blocked: c.blocked,
            blocked_reason: c.blocked_reason,
            last_payment: c.last_payment_date,
          })),
        });
      }

      const result = await erp.getARSummary({ bucket, search });
      return JSON.stringify({
        aging: result.aging_distribution,
        totals: result.totals,
        top_invoices: result.invoices.slice(0, 20).map((inv) => ({
          sale_number: inv.sale_number,
          customer: inv.customer_name,
          pending_usd: inv.pending_usd,
          pending_cop: inv.pending_cop,
          days_overdue: inv.days_overdue,
          aging: inv.aging_label,
        })),
      });
    }

    // ----- Closure tools -----

    case 'get_daily_closure': {
      const date = input.date as string | undefined;
      const closure = await erp.getDailyClosure(date);
      return JSON.stringify(closure);
    }

    // ----- Market data tools -----

    case 'get_usdt_rate': {
      const amount = input.amount as number | undefined;
      const tradeType = (input.trade_type as 'BUY' | 'SELL') ?? 'SELL';
      const fiat = (input.fiat as FiatCurrency) ?? 'COP';
      const limit = (input.limit as number) ?? 20;
      const result = await getUsdtRate(amount, tradeType, fiat, limit);
      return JSON.stringify({
        fiat,
        median_per_usdt: result.median,
        lowest: result.lowest,
        highest: result.highest,
        spread: result.spread,
        ads_count: result.adsCount,
        trade_type: tradeType,
        top_5_ads: result.ads.slice(0, 5).map((a) => ({
          price: a.price,
          available: a.available,
          merchant: a.merchant,
          payment_methods: a.paymentMethods,
        })),
        timestamp: result.timestamp,
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

    case 'escalate_to_tech': {
      const message = input.message as string;
      const priority = (input.priority as string) ?? 'media';
      const text = `ESCALACION TECNICA (${priority.toUpperCase()})\n\n${message}`;
      await notifyTech(text);
      return JSON.stringify({ sent: true, priority });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

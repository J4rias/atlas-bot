import axios, { type AxiosInstance } from 'axios';
import { config } from '../config/index.js';
import type {
  Category,
  Presentation,
  Product,
  PriceList,
  PriceListSummary,
  ExchangeRate,
  SalesSummary,
  SalesStats,
  DailyClosure,
  ProductSalesItem,
  LowStockAlert,
  InventoryValuation,
  ExchangeRateHistoryItem,
  PreOrder,
  PreOrderStats,
  CreatePreOrderInput,
  CustomerPurchase,
  CustomerActivity,
  DailySalesPoint,
} from '../types/index.js';

// Re-export types so consumers can import from services/erp
export type { Category, Product, PriceList, PriceListSummary, ExchangeRate };
export type { Presentation, PriceListDetail } from '../types/index.js';
export type {
  SalesSummary,
  SalesStats,
  DailyClosure,
  ProductSalesItem,
  LowStockAlert,
  InventoryValuation,
  ExchangeRateHistoryItem,
  PreOrder,
  PreOrderStats,
  CreatePreOrderInput,
  CustomerPurchase,
  CustomerActivity,
  DailySalesPoint,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Simple TTL cache
// ---------------------------------------------------------------------------

class Cache<T> {
  private data: T | null = null;
  private expiresAt = 0;

  constructor(private ttlMs: number) {}

  get(): T | null {
    if (Date.now() > this.expiresAt) {
      this.data = null;
      return null;
    }
    return this.data;
  }

  set(value: T): void {
    this.data = value;
    this.expiresAt = Date.now() + this.ttlMs;
  }
}

// ---------------------------------------------------------------------------
// ERP client
// ---------------------------------------------------------------------------

const client: AxiosInstance = axios.create({
  baseURL: config.erp.baseUrl,
  timeout: 15_000,
});

// Attach auth header if token is configured
client.interceptors.request.use((req) => {
  if (config.erp.token) {
    req.headers['X-API-Key'] = config.erp.token;
  }
  return req;
});

// 5-minute caches
const categoriesCache = new Cache<Category[]>(5 * 60_000);
const productsCache = new Cache<Product[]>(5 * 60_000);
const priceMapCache = new Cache<Map<number, { packagePrice: number; unitPrice: number }>>(5 * 60_000);
const ratesCache = new Cache<ExchangeRate[]>(2 * 60_000); // 2 min for rates

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCategories(): Promise<Category[]> {
  const cached = categoriesCache.get();
  if (cached) return cached;

  const { data: res } = await client.get('/api/categories', {
    params: { limit: 200 },
  });
  const categories: Category[] = res.data;
  categoriesCache.set(categories);
  return categories;
}

export async function getProducts(categoryId?: number): Promise<Product[]> {
  // When filtering by category we skip the cache (lightweight call)
  if (!categoryId) {
    const cached = productsCache.get();
    if (cached) return cached;
  }

  const params: Record<string, string | number | boolean> = {
    is_active: true,
    limit: 500,
  };
  if (categoryId) params.category_id = categoryId;

  const { data: res } = await client.get('/api/products', { params });
  const products: Product[] = res.data;

  if (!categoryId) productsCache.set(products);
  return products;
}

export async function getPriceMap(): Promise<Map<number, { packagePrice: number; unitPrice: number }>> {
  const cached = priceMapCache.get();
  if (cached) return cached;

  // 1. Find default active price list
  const { data: listsRes } = await client.get('/api/price-lists/active');
  const lists: PriceListSummary[] = listsRes.data;
  const defaultList = lists.find((l) => l.isDefault) || lists[0];

  if (!defaultList) {
    const empty = new Map<number, { packagePrice: number; unitPrice: number }>();
    priceMapCache.set(empty);
    return empty;
  }

  // 2. Fetch full price list with details
  const { data: plRes } = await client.get(`/api/price-lists/${defaultList.id}`);
  const priceList: PriceList = plRes.data;

  // 3. Build presentation_id → prices map
  const map = new Map<number, { packagePrice: number; unitPrice: number }>();
  for (const d of priceList.details) {
    map.set(d.presentation_id, {
      packagePrice: parseFloat(d.package_price) || 0,
      unitPrice: parseFloat(d.unit_price) || 0,
    });
  }

  priceMapCache.set(map);
  return map;
}

/** Fetch current exchange rates (Tasa Atlas). */
export async function getExchangeRates(): Promise<ExchangeRate[]> {
  const cached = ratesCache.get();
  if (cached) return cached;

  const { data: res } = await client.get('/api/exchange-rates/latest');
  const rates: ExchangeRate[] = res.data;
  ratesCache.set(rates);
  return rates;
}

/** Total stock across all warehouses for a product. */
export function totalStock(product: Product): number {
  if (!product.inventories) return 0;
  return product.inventories.reduce((sum, inv) => sum + (parseFloat(inv.quantity) || 0), 0);
}

/**
 * Format stock as "X Bulto(s) + Y uds" using the product's bulk presentation.
 * E.g. 106 units with 20 uds/bulto → "5 Bulto(s) + 6 uds"
 */
export function formatStock(totalUnits: number, presentations: Presentation[]): string {
  if (totalUnits <= 0) return '0 uds';

  // Find bulk presentation: prefer default, then highest units_per_package
  const bulk = presentations.find((p) => p.is_default && p.units_per_package > 1)
    ?? presentations
        .filter((p) => p.units_per_package > 1)
        .sort((a, b) => b.units_per_package - a.units_per_package)[0];

  if (!bulk || bulk.units_per_package <= 1) return `${totalUnits} uds`;

  const upp = bulk.units_per_package;
  const pkgs = Math.floor(totalUnits / upp);
  const rem = totalUnits % upp;
  const label = bulk.packagingType?.name ?? 'Bulto';

  if (pkgs === 0) return `${rem} uds`;
  if (rem === 0) return `${pkgs} ${label}(s)`;
  return `${pkgs} ${label}(s) + ${rem} uds`;
}

/** Expose the raw axios client for advanced ERP queries. */
export function getErpClient(): AxiosInstance {
  return client;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/** Sales summary for a date range (defaults to today). */
export async function getSalesSummary(
  from?: string,
  to?: string,
): Promise<SalesSummary> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;

  const { data: res } = await client.get('/api/sales/summary', { params });
  return res.data;
}

/** Comprehensive sales stats for a date range. */
export async function getSalesStats(opts?: {
  startDate?: string;
  endDate?: string;
  warehouseId?: number;
  summaryOnly?: boolean;
  topLimit?: number;
}): Promise<SalesStats> {
  const params: Record<string, string | number | boolean> = {};
  if (opts?.startDate) params.start_date = opts.startDate;
  if (opts?.endDate) params.end_date = opts.endDate;
  if (opts?.warehouseId) params.warehouse_id = opts.warehouseId;
  if (opts?.summaryOnly) params.summary_only = true;
  if (opts?.topLimit) params.top_limit = opts.topLimit;

  const { data: res } = await client.get('/api/sales/stats', { params });
  return res.stats;
}

/** Daily closure report. Defaults to today. */
export async function getDailyClosure(
  date?: string,
  userId?: number,
): Promise<DailyClosure> {
  const params: Record<string, string | number> = {};
  if (date) params.date = date;
  if (userId) params.user_id = userId;

  const { data: res } = await client.get('/api/sales/daily-closure', { params });
  return res;
}

/** Product-level sales breakdown for a date range. */
export async function getProductSales(
  startDate?: string,
  endDate?: string,
): Promise<ProductSalesItem[]> {
  const params: Record<string, string> = {};
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;

  const { data: res } = await client.get('/api/sales/product-sales', { params });
  return res.data;
}

/** Daily sales series for cross-analysis (rate vs sales, seasonality). */
export async function getDailySalesSeries(
  from: string,
  to: string,
): Promise<DailySalesPoint[]> {
  const { data: res } = await client.get('/api/sales/daily-series', {
    params: { from, to },
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Inventory alerts & valuation
// ---------------------------------------------------------------------------

/** Products below their reorder point. */
export async function getLowStockAlerts(
  warehouseId?: number,
): Promise<LowStockAlert[]> {
  const params: Record<string, number> = {};
  if (warehouseId) params.warehouse_id = warehouseId;

  const { data: res } = await client.get('/api/inventory/alerts/low-stock', { params });
  return res.data;
}

/** Inventory valuation across warehouses. */
export async function getInventoryValuation(
  warehouseId?: number,
): Promise<InventoryValuation> {
  const params: Record<string, number> = {};
  if (warehouseId) params.warehouse_id = warehouseId;

  const { data: res } = await client.get('/api/inventory/valuation', { params });
  return res.data;
}

// ---------------------------------------------------------------------------
// Exchange rate history
// ---------------------------------------------------------------------------

/** Historical exchange rates with optional filters. */
export async function getRateHistory(opts?: {
  fromCurrency?: string;
  toCurrency?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<ExchangeRateHistoryItem[]> {
  const params: Record<string, string | number> = {};
  if (opts?.fromCurrency) params.from_currency = opts.fromCurrency;
  if (opts?.toCurrency) params.to_currency = opts.toCurrency;
  if (opts?.dateFrom) params.date_from = opts.dateFrom;
  if (opts?.dateTo) params.date_to = opts.dateTo;
  if (opts?.limit) params.limit = opts.limit;

  const { data: res } = await client.get('/api/exchange-rates', { params });
  return res.data;
}

// ---------------------------------------------------------------------------
// Pre-orders
// ---------------------------------------------------------------------------

/** List pre-orders with optional filters. */
export async function getPreOrders(opts?: {
  status?: 'pending' | 'approved' | 'rejected' | 'converted' | 'expired';
  channel?: 'messenger' | 'telegram' | 'web';
  page?: number;
  limit?: number;
}): Promise<{ data: PreOrder[]; pagination: { total: number; page: number; totalPages: number } }> {
  const params: Record<string, string | number> = {};
  if (opts?.status) params.status = opts.status;
  if (opts?.channel) params.channel = opts.channel;
  if (opts?.page) params.page = opts.page;
  if (opts?.limit) params.limit = opts.limit;

  const { data: res } = await client.get('/api/pre-orders', { params });
  return { data: res.data, pagination: res.pagination };
}

/** Pre-order counts: pending, approved, created today. */
export async function getPreOrderStats(): Promise<PreOrderStats> {
  const { data: res } = await client.get('/api/pre-orders/stats');
  return res.data;
}

/** Create a pre-order from the Consultant bot. */
export async function createPreOrder(
  input: CreatePreOrderInput,
): Promise<PreOrder> {
  const { data: res } = await client.post('/api/pre-orders', input);
  return res.data;
}

// ---------------------------------------------------------------------------
// CRM / Customer activity
// ---------------------------------------------------------------------------

/** Purchase history for a specific customer. */
export async function getCustomerPurchases(
  customerId: number,
  opts?: { from?: string; to?: string },
): Promise<CustomerPurchase[]> {
  const params: Record<string, string> = {};
  if (opts?.from) params.from = opts.from;
  if (opts?.to) params.to = opts.to;

  const { data: res } = await client.get(`/api/customers/${customerId}/purchases`, { params });
  return res.data;
}

/** Aggregated customer activity — purchase frequency, recency, spend. */
export async function getCustomerActivity(opts?: {
  days?: number;
  min_purchases?: number;
}): Promise<CustomerActivity[]> {
  const params: Record<string, number> = {};
  if (opts?.days) params.days = opts.days;
  if (opts?.min_purchases) params.min_purchases = opts.min_purchases;

  const { data: res } = await client.get('/api/customers/activity', { params });
  return res.data;
}

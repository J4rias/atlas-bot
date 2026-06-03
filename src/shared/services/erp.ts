import axios, { type AxiosInstance } from 'axios';
import { config } from '../config/index.js';
import type {
  Category,
  Product,
  PriceList,
  PriceListSummary,
  ExchangeRate,
} from '../types/index.js';

// Re-export types so consumers can import from services/erp
export type { Category, Product, PriceList, PriceListSummary, ExchangeRate };
export type { Presentation, PriceListDetail } from '../types/index.js';

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
    req.headers.Authorization = `Bearer ${config.erp.token}`;
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

/** Expose the raw axios client for advanced ERP queries. */
export function getErpClient(): AxiosInstance {
  return client;
}

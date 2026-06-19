export interface Category {
  id: number;
  code: string;
  name: string;
  description: string | null;
  color: string;
  productCount: number;
}

export interface Presentation {
  id: number;
  name: string;
  units_per_package: number;
  package_price: string | null;
  base_price: string | null;
  is_default: boolean;
  packagingType?: { id: number; name: string } | null;
  presentationType?: { id: number; name: string } | null;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: Category | null;
  brand: { id: number; name: string } | null;
  presentations: Presentation[];
  inventories?: { quantity: string; warehouse: { id: number; name: string } }[];
}

export interface PriceListSummary {
  id: number;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  validFrom: string | null;
  validUntil: string | null;
}

export interface PriceListDetail {
  presentation_id: number;
  product_id: number;
  package_price: string;
  unit_price: string;
  product?: { id: number; sku: string; name: string; image_url: string | null };
  presentation?: { id: number; name: string; units_per_package: number };
}

export interface PriceList extends PriceListSummary {
  details: PriceListDetail[];
}

export interface ExchangeRate {
  currency: string;
  rate: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SalesSummary {
  period: { from: string; to: string };
  summary: {
    sale_count: number;
    total_sales: number;
    total_paid: number;
    total_credit: number;
    cash_total?: number;
    credit_total?: number;
    mixed_total?: number;
  };
  top_products: Array<{
    product_name: string;
    total_quantity: number;
    total_revenue: number;
  }>;
}

export interface SalesStats {
  totalSales: number;
  totalRevenue: number;
  totalRevenueCOP: number;
  totalCost?: number;
  grossProfit?: number;
  grossMarginPct?: number;
  salesByType?: Array<{ sale_type: string; count: number; total: number }>;
  salesByStatus?: Array<{ status: string; count: number; total: number }>;
  topProducts?: Array<{
    product_id: number;
    total_quantity: number;
    total_amount: number;
    total_cost?: number;
    gross_margin_pct?: number;
    product?: { id: number; name: string; sku: string };
  }>;
  salesByCurrency?: Record<string, { count: number; total: number }>;
}

export interface DailyClosure {
  date: string;
  totalSalesUSD: number;
  totalSalesCOP: number;
  salesCount: number;
  creditTotalUSD: number;
  paymentsBreakdown: Record<string, Record<string, number>>;
  creditCollectedByCurrency: Record<string, number>;
  cashRefunds: { refund_cop: number; refund_usd: number; refund_count: number };
}

export interface ProductSalesItem {
  product_id: number;
  total_quantity: number;
  num_sales: number;
  total_usd: number;
  total_cop: number;
  product?: { id: number; name: string; sku: string };
}

// ---------------------------------------------------------------------------
// Inventory alerts & valuation
// ---------------------------------------------------------------------------

export interface LowStockAlert {
  product_id: number;
  warehouse_id: number;
  quantity: number;
  available_quantity: number;
  product?: {
    id: number;
    name: string;
    sku: string;
    reorder_point: number;
    category?: { id: number; name: string };
  };
  warehouse?: { id: number; name: string };
}

export interface InventoryValuation {
  totalValue: number;
  totalValueCOP: number;
  productsWithStock: number;
  totalsByCurrency: Record<string, number>;
  items: Array<{
    product: { id: number; name: string; sku: string };
    quantity: number;
    cost: number;
    currency: string;
    value: number;
  }>;
}

// ---------------------------------------------------------------------------
// Exchange rate history
// ---------------------------------------------------------------------------

export interface ExchangeRateHistoryItem {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
  source: string | null;
  is_active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pre-orders
// ---------------------------------------------------------------------------

export interface PreOrderDetail {
  productId: number;
  presentationId: number;
  quantity: number;
  unitPrice: number;
  total: number;
  product?: { id: number; name: string };
  presentation?: { id: number; name: string; units_per_package: number };
}

export interface PreOrder {
  id: number;
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  channel: string;
  status: 'pending' | 'approved' | 'rejected' | 'converted' | 'expired';
  subtotal: number;
  total: number;
  currency: string;
  expiresAt: string | null;
  created_at: string;
  details: PreOrderDetail[];
}

export interface PreOrderStats {
  pending: number;
  approved: number;
  today: number;
}

// ---------------------------------------------------------------------------
// CRM / Customer activity
// ---------------------------------------------------------------------------

export interface CustomerPurchaseItem {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface CustomerPurchase {
  sale_id: number;
  date: string;
  total_usd: number;
  total_cop: number;
  payment_type: string;
  items: CustomerPurchaseItem[];
}

export interface CustomerActivity {
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  total_purchases: number;
  total_spent_usd: number;
  first_purchase: string;
  last_purchase: string;
  avg_days_between_purchases: number;
}

export interface CreatePreOrderInput {
  customer_name?: string;
  customer_phone?: string;
  channel?: 'messenger' | 'telegram' | 'web';
  notes?: string;
  currency?: string;
  items: Array<{
    presentation_id: number;
    quantity: number;
    unit_price?: number;
    is_unit?: boolean;
    notes?: string;
  }>;
}

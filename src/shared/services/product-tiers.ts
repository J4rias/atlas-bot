import { getProducts, getCategories, totalStock, type Product } from './erp.js';
import { createLogger } from '../logger.js';

const log = createLogger('consultant').child({ module: 'tiers' });

// ---------------------------------------------------------------------------
// Product tiers
// ---------------------------------------------------------------------------

export type ProductTier = 'tier1' | 'tier2' | 'unclassified';

/**
 * Tier 1 (High Margin): Products to push — higher profit per unit.
 * Tier 2 (Rotation): Hook/volume products — lower margin, frequent sales.
 *
 * Classification strategy (until ERP admin panel manages this):
 *  - Configurable via tier1CategoryIds and tier1ProductIds
 *  - Everything else defaults to tier2
 *  - Products with no category are unclassified
 */

// TODO: load from ERP GET /api/bot-config/consultant when available
// For now, these are configurable constants.
let tier1CategoryIds: Set<number> = new Set();
let tier1ProductIds: Set<number> = new Set();

/** Configure which categories/products are Tier 1. */
export function configureTiers(config: {
  tier1Categories?: number[];
  tier1Products?: number[];
}) {
  if (config.tier1Categories) {
    tier1CategoryIds = new Set(config.tier1Categories);
  }
  if (config.tier1Products) {
    tier1ProductIds = new Set(config.tier1Products);
  }
  log.info(
    { tier1Categories: tier1CategoryIds.size, tier1Products: tier1ProductIds.size },
    'Product tiers configured',
  );
}

/** Get the tier for a product. */
export function getProductTier(product: Product): ProductTier {
  if (tier1ProductIds.has(product.id)) return 'tier1';
  if (product.category && tier1CategoryIds.has(product.category.id)) return 'tier1';
  if (!product.category) return 'unclassified';
  return 'tier2';
}

/** Find Tier 1 products that could be upsell candidates for a given product. */
export async function findUpsellCandidates(
  forProduct: Product,
  limit = 3,
): Promise<Product[]> {
  const allProducts = await getProducts();

  const candidates = allProducts.filter((p) => {
    if (p.id === forProduct.id) return false;
    if (totalStock(p) <= 0) return false;
    if (getProductTier(p) !== 'tier1') return false;

    // Prefer same category for relevance
    if (forProduct.category && p.category) {
      return p.category.id === forProduct.category.id;
    }
    return true;
  });

  // If no same-category tier1, fall back to any tier1 with stock
  if (candidates.length === 0) {
    return allProducts
      .filter((p) => p.id !== forProduct.id && totalStock(p) > 0 && getProductTier(p) === 'tier1')
      .slice(0, limit);
  }

  return candidates.slice(0, limit);
}

/**
 * Enrich a product list with tier info.
 * Returns products grouped by tier.
 */
export function groupByTier(products: Product[]): {
  tier1: Product[];
  tier2: Product[];
  unclassified: Product[];
} {
  const result = { tier1: [] as Product[], tier2: [] as Product[], unclassified: [] as Product[] };
  for (const p of products) {
    result[getProductTier(p)].push(p);
  }
  return result;
}

import type Anthropic from '@anthropic-ai/sdk';
import { findUpsellCandidates, getProductTier } from '../../shared/services/product-tiers.js';
import { getProducts, totalStock, type Product } from '../../shared/services/erp.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('consultant').child({ module: 'upsell' });

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const upsellSuggestToolDef: Anthropic.Tool = {
  name: 'suggest_upsell',
  description:
    'Given a product the customer is interested in, find higher-margin (Tier 1) alternatives or complements ' +
    'from the same category. Use this when the customer asks about a Tier 2 (rotation/hook) product to ' +
    'suggest premium options that may better fit their needs. Returns up to 3 candidates with stock and tier info.',
  input_schema: {
    type: 'object' as const,
    properties: {
      product_id: {
        type: 'number',
        description: 'The ID of the product the customer is currently looking at.',
      },
      product_name: {
        type: 'string',
        description: 'Name of the product (for logging/context).',
      },
    },
    required: ['product_id'],
  },
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface UpsellInput {
  product_id: number;
  product_name?: string;
}

export async function executeUpsellSuggest(input: UpsellInput): Promise<string> {
  const { product_id, product_name } = input;

  // Find the source product
  const products = await getProducts();
  const sourceProduct = products.find((p) => p.id === product_id);

  if (!sourceProduct) {
    return JSON.stringify({ error: `Product with ID ${product_id} not found.` });
  }

  const sourceTier = getProductTier(sourceProduct);
  const sourceStock = totalStock(sourceProduct);

  log.debug(
    { productId: product_id, name: product_name ?? sourceProduct.name, tier: sourceTier },
    'Upsell lookup',
  );

  // Find upsell candidates (Tier 1 products in same category)
  const candidates = await findUpsellCandidates(sourceProduct, 3);

  if (candidates.length === 0) {
    return JSON.stringify({
      source: {
        id: sourceProduct.id,
        name: sourceProduct.name,
        tier: sourceTier,
        stock: sourceStock,
      },
      candidates: [],
      note: 'No hay alternativas de mayor margen disponibles en esta categoría.',
    });
  }

  const result = {
    source: {
      id: sourceProduct.id,
      name: sourceProduct.name,
      tier: sourceTier,
      category: sourceProduct.category?.name ?? 'Sin categoría',
      stock: sourceStock,
    },
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      tier: getProductTier(c),
      category: c.category?.name ?? 'Sin categoría',
      stock: totalStock(c),
      presentations: c.presentations?.map((pr) => ({
        id: pr.id,
        name: pr.name,
        units_per_package: pr.units_per_package,
      })) ?? [],
    })),
    note:
      sourceTier === 'tier1'
        ? 'El producto consultado ya es Tier 1 (alto margen). Estas son alternativas adicionales.'
        : 'Estos productos de mayor margen podrían ser buenas alternativas para sugerir al cliente.',
  };

  return JSON.stringify(result);
}

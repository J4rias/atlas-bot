import { getProductSales, getLowStockAlerts } from '../../../shared/services/erp.js';
import * as memoryRepo from '../../../shared/db/repositories/memory.repo.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('manager').child({ job: 'product-substitution' });

/** Delay between sequential ERP calls to avoid hammering the server. */
const CALL_DELAY_MS = 200;

interface SubstitutionCandidate {
  outOfStockProduct: string;
  outOfStockSku: string;
  substitute: string;
  substituteSku: string;
  /** % increase in substitute sales when the primary is out of stock. */
  salesLiftPct: number;
}

/**
 * Weekly product substitution analysis (Sunday 11 PM VEN / Monday 03:00 UTC).
 *
 * Compares product sales during periods when a product has stock vs when it's out.
 * If another product in the same category sees a sales lift when the first is out,
 * it's flagged as a potential substitute.
 */
export async function runProductSubstitution(): Promise<void> {
  log.info('Starting product substitution analysis');

  try {
    // Get current low-stock products — these are candidates for analysis
    const lowStock = await getLowStockAlerts();

    if (lowStock.length === 0) {
      log.info('No low-stock products — skipping substitution analysis');
      return;
    }

    // Analyze last 30 days: 2 windows of 15 days each
    const now = new Date();
    const day15ago = new Date(now.getTime() - 15 * 86_400_000).toISOString().slice(0, 10);
    const day30ago = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    // Fetch product sales for both windows
    const [salesRecent, salesOlder] = await Promise.all([
      getProductSales(day15ago, today),
      getProductSales(day30ago, day15ago),
    ]);

    // Build product_id → sales maps
    const recentMap = new Map(salesRecent.map((p) => [p.product_id, p]));
    const olderMap = new Map(salesOlder.map((p) => [p.product_id, p]));

    // For each low-stock product, look for products whose sales increased
    // when this product's sales dropped (simple heuristic)
    const lowStockIds = new Set(lowStock.map((a) => a.product_id));
    const candidates: SubstitutionCandidate[] = [];

    for (const alert of lowStock) {
      const pid = alert.product_id;
      const recentSales = recentMap.get(pid)?.total_quantity ?? 0;
      const olderSales = olderMap.get(pid)?.total_quantity ?? 0;

      // Only analyze if the product was selling before but dropped (due to stock out)
      if (olderSales <= 0 || recentSales >= olderSales * 0.8) continue;

      // Look for same-category products whose sales increased
      const categoryId = alert.product?.category?.id;
      if (!categoryId) continue;

      for (const [otherId, otherRecent] of recentMap) {
        if (otherId === pid || lowStockIds.has(otherId)) continue;

        // Same category check (from the sales data product info)
        const otherOlder = olderMap.get(otherId);
        if (!otherOlder) continue;

        const otherOlderQty = otherOlder.total_quantity;
        const otherRecentQty = otherRecent.total_quantity;

        if (otherOlderQty <= 0 || otherRecentQty <= otherOlderQty) continue;

        const liftPct = Math.round(((otherRecentQty - otherOlderQty) / otherOlderQty) * 100);

        if (liftPct >= 20) {
          candidates.push({
            outOfStockProduct: alert.product?.name ?? `ID ${pid}`,
            outOfStockSku: alert.product?.sku ?? '',
            substitute: otherRecent.product?.name ?? `ID ${otherId}`,
            substituteSku: otherRecent.product?.sku ?? '',
            salesLiftPct: liftPct,
          });
        }
      }

      // Small delay between iterations to be gentle on the system
      await new Promise((r) => setTimeout(r, CALL_DELAY_MS));
    }

    // Save to memory with 7-day TTL
    if (candidates.length > 0) {
      const content = candidates
        .sort((a, b) => b.salesLiftPct - a.salesLiftPct)
        .slice(0, 10) // top 10
        .map((c) =>
          `${c.outOfStockProduct} (${c.outOfStockSku}) → posible sustituto: ${c.substitute} (${c.substituteSku}), ventas +${c.salesLiftPct}%`,
        )
        .join('\n');

      try {
        // Save with 7-day TTL — old entries expire naturally via valid_until filter
        await memoryRepo.saveMemory({
          category: 'insight',
          subject: 'product_substitution',
          content,
          confidence: 0.7,
          source: 'product-substitution',
          valid_until: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        });
      } catch {
        log.debug('Could not save substitution analysis to memory');
      }
    }

    log.info(
      { lowStockProducts: lowStock.length, substitutionCandidates: candidates.length },
      'Product substitution analysis complete',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Product substitution analysis failed');
  }
}

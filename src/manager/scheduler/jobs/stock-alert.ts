import { getProducts, totalStock, formatStock } from '../../../shared/services/erp.js';
import * as memoryRepo from '../../../shared/db/repositories/memory.repo.js';
import { createLogger } from '../../../shared/logger.js';
import { eventBus } from '../triggers/event-bus.js';

const log = createLogger('manager').child({ job: 'stock-alert' });

/** Products with stock below this threshold trigger an alert. */
const LOW_STOCK_THRESHOLD = 10;

/** Don't re-alert for the same product within this window (ms). */
const COOLDOWN_MS = 4 * 60 * 60_000; // 4 hours

// In-memory cooldown tracker (survives across cron runs, resets on restart)
const alertedAt = new Map<number, number>();

export async function runStockAlert() {
  log.info('Running stock alert check');

  try {
    const products = await getProducts();

    const criticalProducts: { productId: number; productName: string; currentStock: number; stockDisplay: string }[] = [];

    for (const product of products) {
      const stock = totalStock(product);

      if (stock > 0 && stock <= LOW_STOCK_THRESHOLD) {
        // Check cooldown
        const lastAlert = alertedAt.get(product.id) ?? 0;
        if (Date.now() - lastAlert < COOLDOWN_MS) continue;

        criticalProducts.push({
          productId: product.id,
          productName: product.name,
          currentStock: stock,
          stockDisplay: formatStock(stock, product.presentations),
        });

        alertedAt.set(product.id, Date.now());
      }
    }

    // Emit single consolidated alert
    if (criticalProducts.length > 0) {
      log.warn({ count: criticalProducts.length }, 'Critical low stock detected');
      eventBus.emit('stock:critical-low-batch', criticalProducts);
    }

    // Save observation to memory if there are critical products
    if (criticalProducts.length > 0) {
      try {
        await memoryRepo.saveMemory({
          category: 'observation',
          subject: 'stock_alert_batch',
          content: `${criticalProducts.length} productos con stock crítico: ${criticalProducts.map((p) => `${p.productName} (${p.currentStock} uds)`).join(', ')}`,
          confidence: 1.0,
          source: 'stock-alert',
          valid_until: new Date(Date.now() + 24 * 60 * 60_000), // valid 24h
        });
      } catch {
        log.debug('Could not save stock alert to memory');
      }
    }

    log.info(
      { total: products.length, critical: criticalProducts.length },
      'Stock alert check complete',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Stock alert failed');
  }
}

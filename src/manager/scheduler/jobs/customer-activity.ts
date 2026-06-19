import { getCustomerActivity } from '../../../shared/services/erp.js';
import * as memoryRepo from '../../../shared/db/repositories/memory.repo.js';
import { createLogger } from '../../../shared/logger.js';
import { eventBus } from '../triggers/event-bus.js';

const log = createLogger('manager').child({ job: 'customer-activity' });

/** Multiplier over avg purchase cycle to flag churn risk. */
const CHURN_FACTOR = 1.5;

/** Minimum purchases to consider a customer for churn analysis. */
const MIN_PURCHASES_FOR_CHURN = 2;

/** Days within which a reorder is expected. */
const REORDER_WINDOW_DAYS = 2;

/** Max days since first purchase for a "new inactive" customer. */
const NEW_CUSTOMER_WINDOW_DAYS = 30;

/** Days without return to flag a new customer as inactive. */
const NEW_INACTIVE_THRESHOLD_DAYS = 14;

export interface ChurnRiskCustomer {
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  avg_days_between_purchases: number;
  days_since_last_purchase: number;
  total_spent_usd: number;
  total_purchases: number;
}

export interface ReorderDueCustomer {
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  avg_days_between_purchases: number;
  days_since_last_purchase: number;
}

export interface NewInactiveCustomer {
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  days_since_purchase: number;
  total_spent_usd: number;
}

export async function runCustomerActivity() {
  log.info('Running customer activity analysis');

  try {
    const customers = await getCustomerActivity({ days: 90, min_purchases: 1 });

    const today = new Date();
    const churnRisks: ChurnRiskCustomer[] = [];
    const reorderDue: ReorderDueCustomer[] = [];
    const newInactive: NewInactiveCustomer[] = [];

    for (const c of customers) {
      const lastPurchase = new Date(c.last_purchase);
      const firstPurchase = new Date(c.first_purchase);
      const daysSinceLast = Math.floor((today.getTime() - lastPurchase.getTime()) / 86_400_000);
      const daysSinceFirst = Math.floor((today.getTime() - firstPurchase.getTime()) / 86_400_000);

      // Churn detection: customer with established pattern buying late
      if (
        c.total_purchases >= MIN_PURCHASES_FOR_CHURN &&
        c.avg_days_between_purchases > 0 &&
        daysSinceLast > c.avg_days_between_purchases * CHURN_FACTOR
      ) {
        churnRisks.push({
          customer_id: c.customer_id,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          avg_days_between_purchases: c.avg_days_between_purchases,
          days_since_last_purchase: daysSinceLast,
          total_spent_usd: c.total_spent_usd,
          total_purchases: c.total_purchases,
        });
        continue; // Don't also flag as reorder-due
      }

      // Reorder prediction: customer approaching their typical purchase cycle
      if (
        c.total_purchases >= MIN_PURCHASES_FOR_CHURN &&
        c.avg_days_between_purchases > 0 &&
        daysSinceLast >= c.avg_days_between_purchases - REORDER_WINDOW_DAYS &&
        daysSinceLast <= c.avg_days_between_purchases * CHURN_FACTOR
      ) {
        reorderDue.push({
          customer_id: c.customer_id,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          avg_days_between_purchases: c.avg_days_between_purchases,
          days_since_last_purchase: daysSinceLast,
        });
        continue;
      }

      // New customer that never came back
      if (
        c.total_purchases === 1 &&
        daysSinceFirst <= NEW_CUSTOMER_WINDOW_DAYS &&
        daysSinceLast >= NEW_INACTIVE_THRESHOLD_DAYS
      ) {
        newInactive.push({
          customer_id: c.customer_id,
          customer_name: c.customer_name,
          customer_phone: c.customer_phone,
          days_since_purchase: daysSinceLast,
          total_spent_usd: c.total_spent_usd,
        });
      }
    }

    // Emit events
    if (churnRisks.length > 0) {
      log.warn({ count: churnRisks.length }, 'Churn risk customers detected');
      eventBus.emit('crm:churn-risk', churnRisks);
    }

    if (reorderDue.length > 0) {
      log.info({ count: reorderDue.length }, 'Reorder-due customers detected');
      eventBus.emit('crm:reorder-due', reorderDue);
    }

    if (newInactive.length > 0) {
      log.info({ count: newInactive.length }, 'New inactive customers detected');
      eventBus.emit('crm:new-inactive', newInactive);
    }

    // Save summary to memory
    const total = churnRisks.length + reorderDue.length + newInactive.length;
    if (total > 0) {
      try {
        await memoryRepo.saveMemory({
          category: 'observation',
          subject: 'customer_activity_daily',
          content: `Análisis CRM: ${churnRisks.length} en riesgo de churn, ${reorderDue.length} próximos a recompra, ${newInactive.length} clientes nuevos inactivos`,
          confidence: 0.85,
          source: 'customer-activity',
          valid_until: new Date(Date.now() + 24 * 60 * 60_000),
        });
      } catch {
        log.debug('Could not save customer activity to memory');
      }
    }

    log.info(
      { total: customers.length, churn: churnRisks.length, reorder: reorderDue.length, newInactive: newInactive.length },
      'Customer activity analysis complete',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Customer activity analysis failed');
  }
}

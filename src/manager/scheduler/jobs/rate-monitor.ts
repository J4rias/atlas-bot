import { getExchangeRates } from '../../../shared/services/erp.js';
import * as memoryRepo from '../../../shared/db/repositories/memory.repo.js';
import { createLogger } from '../../../shared/logger.js';
import { eventBus } from '../triggers/event-bus.js';

const log = createLogger('manager').child({ job: 'rate-monitor' });

/** Threshold: alert if rate changes more than this percentage. */
const CHANGE_THRESHOLD_PCT = 2.0;

export async function runRateMonitor() {
  log.info('Running rate monitor');

  try {
    const currentRates = await getExchangeRates();

    // Load last known rates from memory
    let lastRates: Record<string, number> = {};
    try {
      const memories = await memoryRepo.findMemories('observation', 'rate_snapshot_latest', 1);
      if (memories.length > 0) {
        lastRates = JSON.parse(memories[0].content);
      }
    } catch {
      log.debug('No previous rate snapshot in memory — first run');
    }

    const alerts: { currency: string; oldRate: number; newRate: number; deltaPct: number }[] = [];
    const snapshot: Record<string, number> = {};

    for (const rate of currentRates) {
      const key = `${rate.from_currency}_${rate.to_currency}`;
      const currentRate = Number(rate.rate);
      snapshot[key] = currentRate;

      const oldRate = Number(lastRates[key]);
      if (!oldRate) continue;

      const deltaPct = Math.abs((currentRate - oldRate) / oldRate) * 100;

      if (deltaPct >= CHANGE_THRESHOLD_PCT) {
        alerts.push({
          currency: key,
          oldRate,
          newRate: rate.rate,
          deltaPct: Math.round(deltaPct * 100) / 100,
        });
      }
    }

    // Save current snapshot to memory
    try {
      const existing = await memoryRepo.findMemories('observation', 'rate_snapshot_latest', 1);
      if (existing.length > 0) {
        await memoryRepo.supersedeMemory(existing[0].id, {
          category: 'observation',
          subject: 'rate_snapshot_latest',
          content: JSON.stringify(snapshot),
          confidence: 1.0,
          source: 'rate-monitor',
        });
      } else {
        await memoryRepo.saveMemory({
          category: 'observation',
          subject: 'rate_snapshot_latest',
          content: JSON.stringify(snapshot),
          confidence: 1.0,
          source: 'rate-monitor',
        });
      }
    } catch {
      log.debug('Could not save rate snapshot to memory (DB not available)');
    }

    // Emit alerts
    for (const alert of alerts) {
      log.warn(alert, 'Significant rate change detected');
      eventBus.emit('rate:significant-change', alert);
    }

    if (alerts.length === 0) {
      log.info({ currencies: Object.keys(snapshot).length }, 'No significant rate changes');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Rate monitor failed');
  }
}

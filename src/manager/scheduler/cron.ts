import cron from 'node-cron';
import { createLogger } from '../../shared/logger.js';
import { runHourlyDiagnostic } from '../agent/diagnostic-pipeline.js';
import { runRateMonitor } from './jobs/rate-monitor.js';
import { runStockAlert } from './jobs/stock-alert.js';
import { runBcvRateCheck } from './jobs/bcv-rate-check.js';
import { runCustomerActivity } from './jobs/customer-activity.js';
import { runDailyStrategy } from './jobs/daily-strategy.js';
import { runProductSubstitution } from './jobs/product-substitution.js';
import { runDailyClosure } from './jobs/daily-closure.js';
import { registerEventListeners } from './listeners.js';

const log = createLogger('manager').child({ module: 'scheduler' });

const tasks: cron.ScheduledTask[] = [];

/** Atlas operates Mon-Sat 7:00-18:00 Venezuela time (UTC-4). */
function isBusinessHours(): boolean {
  const now = new Date(Date.now() - 4 * 60 * 60_000);
  const day = now.getUTCDay();   // 0=Sun in VEN time
  const hour = now.getUTCHours(); // hour in VEN time
  if (day === 0) return false;    // Sunday — closed
  return hour >= 7 && hour <= 18;
}

export function startScheduler() {
  log.info('Starting scheduler');

  // Wire event bus → Telegram notifications
  registerEventListeners();

  // Diagnostic — every 2h: 10 AM, 12 PM, 2 PM, 4 PM VEN (UTC-4 → 14,16,18,20 UTC), Mon-Sat
  tasks.push(
    cron.schedule('0 14,16,18,20 * * 1-6', () => {
      log.info('Cron: diagnostic triggered');
      runHourlyDiagnostic().catch((err) => {
        log.error({ err }, 'Cron: diagnostic failed');
      });
    }),
  );

  // Rate monitor — every 15 minutes, Mon-Sat business hours only
  tasks.push(
    cron.schedule('*/15 * * * 1-6', () => {
      if (!isBusinessHours()) return;
      log.info('Cron: rate monitor triggered');
      runRateMonitor().catch((err) => {
        log.error({ err }, 'Cron: rate monitor failed');
      });
    }),
  );

  // Stock alert — every 60 minutes, Mon-Sat business hours only
  tasks.push(
    cron.schedule('0 * * * 1-6', () => {
      if (!isBusinessHours()) return;
      log.info('Cron: stock alert triggered');
      runStockAlert().catch((err) => {
        log.error({ err }, 'Cron: stock alert failed');
      });
    }),
  );

  // BCV rate check — 8 AM, 12 PM, 3 PM VEN (UTC-4 → 12, 16, 19 UTC), Mon-Sat
  tasks.push(
    cron.schedule('0 12,16,19 * * 1-6', () => {
      log.info('Cron: BCV rate check triggered');
      runBcvRateCheck().catch((err) => {
        log.error({ err }, 'Cron: BCV rate check failed');
      });
    }),
  );

  // Customer activity (CRM) — daily at 7:55 AM VEN (UTC-4 → 11:55 UTC), Mon-Sat
  tasks.push(
    cron.schedule('55 11 * * 1-6', () => {
      log.info('Cron: customer activity triggered');
      runCustomerActivity().catch((err) => {
        log.error({ err }, 'Cron: customer activity failed');
      });
    }),
  );

  // Daily sales plan — 8:00 AM VEN (UTC-4 → 12:00 UTC), Mon-Sat
  // Runs 5 min after CRM so churn data is already in memory
  tasks.push(
    cron.schedule('0 12 * * 1-6', () => {
      log.info('Cron: daily strategy triggered');
      runDailyStrategy().catch((err) => {
        log.error({ err }, 'Cron: daily strategy failed');
      });
    }),
  );

  // Daily closing report — 6:00 PM VEN (UTC-4 → 22:00 UTC), Mon-Sat
  tasks.push(
    cron.schedule('0 22 * * 1-6', () => {
      log.info('Cron: daily closure triggered');
      runDailyClosure().catch((err) => {
        log.error({ err }, 'Cron: daily closure failed');
      });
    }),
  );

  // Product substitution analysis — Monday 03:00 UTC (Sunday 11 PM VEN)
  tasks.push(
    cron.schedule('0 3 * * 1', () => {
      log.info('Cron: product substitution triggered');
      runProductSubstitution().catch((err) => {
        log.error({ err }, 'Cron: product substitution failed');
      });
    }),
  );

  log.info({ jobs: tasks.length }, 'Scheduler started');
}

export function stopScheduler() {
  for (const task of tasks) {
    task.stop();
  }
  tasks.length = 0;
  log.info('Scheduler stopped');
}

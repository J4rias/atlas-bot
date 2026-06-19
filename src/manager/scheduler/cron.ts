import cron from 'node-cron';
import { createLogger } from '../../shared/logger.js';
import { runHourlyDiagnostic } from '../agent/diagnostic-pipeline.js';
import { runRateMonitor } from './jobs/rate-monitor.js';
import { runStockAlert } from './jobs/stock-alert.js';
import { runBcvRateCheck } from './jobs/bcv-rate-check.js';
import { runCustomerActivity } from './jobs/customer-activity.js';
import { runDailyStrategy } from './jobs/daily-strategy.js';
import { runProductSubstitution } from './jobs/product-substitution.js';
import { registerEventListeners } from './listeners.js';

const log = createLogger('manager').child({ module: 'scheduler' });

const tasks: cron.ScheduledTask[] = [];

export function startScheduler() {
  log.info('Starting scheduler');

  // Wire event bus → Telegram notifications
  registerEventListeners();

  // Hourly diagnostic — every hour at minute 0
  tasks.push(
    cron.schedule('0 * * * *', () => {
      log.info('Cron: hourly diagnostic triggered');
      runHourlyDiagnostic().catch((err) => {
        log.error({ err }, 'Cron: hourly diagnostic failed');
      });
    }),
  );

  // Rate monitor — every 15 minutes
  tasks.push(
    cron.schedule('*/15 * * * *', () => {
      log.info('Cron: rate monitor triggered');
      runRateMonitor().catch((err) => {
        log.error({ err }, 'Cron: rate monitor failed');
      });
    }),
  );

  // Stock alert — every 60 minutes
  tasks.push(
    cron.schedule('0 * * * *', () => {
      log.info('Cron: stock alert triggered');
      runStockAlert().catch((err) => {
        log.error({ err }, 'Cron: stock alert failed');
      });
    }),
  );

  // BCV rate check — 8 AM, 12 PM, 3 PM Venezuela time (UTC-4 → 12, 16, 19 UTC)
  tasks.push(
    cron.schedule('0 12,16,19 * * *', () => {
      log.info('Cron: BCV rate check triggered');
      runBcvRateCheck().catch((err) => {
        log.error({ err }, 'Cron: BCV rate check failed');
      });
    }),
  );

  // Customer activity (CRM) — daily at 7 AM Venezuela (UTC-4 → 11:00 UTC)
  tasks.push(
    cron.schedule('0 11 * * *', () => {
      log.info('Cron: customer activity triggered');
      runCustomerActivity().catch((err) => {
        log.error({ err }, 'Cron: customer activity failed');
      });
    }),
  );

  // Daily strategy report — 7:05 AM Venezuela (UTC-4 → 11:05 UTC)
  // Runs 5 min after CRM so churn data is already in memory
  tasks.push(
    cron.schedule('5 11 * * *', () => {
      log.info('Cron: daily strategy triggered');
      runDailyStrategy().catch((err) => {
        log.error({ err }, 'Cron: daily strategy failed');
      });
    }),
  );

  // Product substitution analysis — Sunday 11 PM Venezuela (UTC-4 → Monday 03:00 UTC)
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

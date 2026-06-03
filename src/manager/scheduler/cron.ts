import cron from 'node-cron';
import { createLogger } from '../../shared/logger.js';
import { runHourlyDiagnostic } from '../agent/diagnostic-pipeline.js';
import { runRateMonitor } from './jobs/rate-monitor.js';
import { runStockAlert } from './jobs/stock-alert.js';
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

  // Stock alert — every 30 minutes
  tasks.push(
    cron.schedule('*/30 * * * *', () => {
      log.info('Cron: stock alert triggered');
      runStockAlert().catch((err) => {
        log.error({ err }, 'Cron: stock alert failed');
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

import cron from 'node-cron';
import { createLogger } from '../../shared/logger.js';
import { runHourlyDiagnostic } from '../agent/diagnostic-pipeline.js';

const log = createLogger('manager').child({ module: 'scheduler' });

const tasks: cron.ScheduledTask[] = [];

export function startScheduler() {
  log.info('Starting scheduler');

  // Hourly diagnostic — every hour at minute 0
  const diagnostic = cron.schedule('0 * * * *', () => {
    log.info('Cron: hourly diagnostic triggered');
    runHourlyDiagnostic().catch((err) => {
      log.error({ err }, 'Cron: hourly diagnostic failed');
    });
  });
  tasks.push(diagnostic);

  // TODO Phase 4: Rate monitor every 15 min
  // const rateMonitor = cron.schedule('*/15 * * * *', () => { ... });
  // tasks.push(rateMonitor);

  // TODO Phase 4: Stock alert every 30 min
  // const stockAlert = cron.schedule('*/30 * * * *', () => { ... });
  // tasks.push(stockAlert);

  log.info({ jobs: tasks.length }, 'Scheduler started');
}

export function stopScheduler() {
  for (const task of tasks) {
    task.stop();
  }
  tasks.length = 0;
  log.info('Scheduler stopped');
}

import { eventBus } from './triggers/event-bus.js';
import { notifyBosses } from '../telegram/notifications.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'listeners' });

/**
 * Register event bus listeners that bridge scheduler events
 * to Telegram notifications.
 */
export function registerEventListeners() {
  eventBus.on('rate:significant-change', (data: {
    currency: string;
    oldRate: number;
    newRate: number;
    deltaPct: number;
  }) => {
    const direction = data.newRate > data.oldRate ? 'subió' : 'bajó';
    const message =
      `*ALERTA DE TASA*\n\n` +
      `La tasa *${data.currency}* ${direction} un *${data.deltaPct}%*\n` +
      `Anterior: ${data.oldRate.toFixed(2)}\n` +
      `Actual: ${data.newRate.toFixed(2)}\n\n` +
      `Revise si es necesario ajustar precios o congelar cotizaciones.`;

    log.info({ currency: data.currency, deltaPct: data.deltaPct }, 'Sending rate alert');
    notifyBosses(message).catch((err) => {
      log.error({ err }, 'Failed to send rate alert');
    });
  });

  eventBus.on('stock:critical-low', (data: {
    productId: number;
    productName: string;
    currentStock: number;
    averageSales: number;
  }) => {
    const message =
      `*ALERTA DE STOCK*\n\n` +
      `*${data.productName}* tiene stock crítico: *${data.currentStock} unidades*\n\n` +
      `Considere hacer pedido de reposición.`;

    log.info({ productId: data.productId, stock: data.currentStock }, 'Sending stock alert');
    notifyBosses(message).catch((err) => {
      log.error({ err }, 'Failed to send stock alert');
    });
  });

  log.info('Event listeners registered');
}

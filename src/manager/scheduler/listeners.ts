import { eventBus } from './triggers/event-bus.js';
import { notifyBosses, toTelegramMarkdown } from '../telegram/notifications.js';
import { createLogger } from '../../shared/logger.js';
import { runManagerAgent } from '../agent/agent.js';
import { MODEL_GLM_5_2 } from '../../shared/ai/client.js';

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
    const alertMessage =
      `*ALERTA DE TASA*\n\n` +
      `La tasa *${data.currency}* ${direction} un *${data.deltaPct}%*\n` +
      `Anterior: ${data.oldRate.toFixed(2)}\n` +
      `Actual: ${data.newRate.toFixed(2)}`;

    log.info({ currency: data.currency, deltaPct: data.deltaPct }, 'Sending rate alert with impact analysis');

    // Fire reactive analysis alongside the alert
    runManagerAgent(
      `La tasa ${data.currency} acaba de ${direction === 'subió' ? 'subir' : 'bajar'} un ${data.deltaPct}% ` +
      `(de ${data.oldRate.toFixed(2)} a ${data.newRate.toFixed(2)}). ` +
      `Usa analyze_rate_sales_impact para analizar los últimos 7 días y dime: ` +
      `¿cómo impacta este cambio en las ventas basado en el patrón histórico? ` +
      `Sé breve (máximo 3-4 líneas). Incluye el coeficiente de correlación y la cuantificación.`,
      { preamble: 'Análisis reactivo por cambio significativo de tasa.', maxTokens: 1024, model: MODEL_GLM_5_2 },
    )
      .then((analysis) => {
        const fullMessage = `${alertMessage}\n\n*Análisis de impacto:*\n${toTelegramMarkdown(analysis)}`;
        return notifyBosses(fullMessage, 'Markdown');
      })
      .catch((err) => {
        // If analysis fails, still send the basic alert
        log.error({ err }, 'Rate impact analysis failed — sending basic alert');
        notifyBosses(`${alertMessage}\n\nRevise si es necesario ajustar precios o congelar cotizaciones.`, 'Markdown').catch(
          (e) => log.error({ err: e }, 'Failed to send rate alert'),
        );
      });
  });

  eventBus.on('stock:critical-low-batch', (products: {
    productId: number;
    productName: string;
    currentStock: number;
    stockDisplay: string;
  }[]) => {
    const lines = products.map((p) => `  • ${p.productName}: *${p.stockDisplay}*`);
    const message =
      `*ALERTA DE STOCK*\n\n` +
      `${products.length} producto(s) con stock crítico:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Considere hacer pedido de reposición.`;

    log.info({ count: products.length }, 'Sending consolidated stock alert');
    notifyBosses(message, 'Markdown').catch((err) => {
      log.error({ err }, 'Failed to send stock alert');
    });
  });

  eventBus.on('rate:bcv-discrepancy', (data: {
    erpRate: number;
    bcvRate: number;
    bcvEurRate: number | null;
    discrepancyPct: number;
  }) => {
    const direction = data.erpRate > data.bcvRate ? 'por encima' : 'por debajo';
    const lines = [
      `*ALERTA: Discrepancia con BCV*\n`,
      `La tasa Atlas está ${direction} de la tasa BCV por *${data.discrepancyPct}%*\n`,
      `  Tasa Atlas (ERP): *${data.erpRate.toFixed(2)} Bs/$*`,
      `  Tasa BCV oficial: *${data.bcvRate.toFixed(2)} Bs/$*`,
    ];
    if (data.bcvEurRate) {
      lines.push(`  Tasa BCV EUR: *${data.bcvEurRate.toFixed(2)} Bs/€*`);
    }
    lines.push(`\nRevise si es necesario actualizar la tasa en el ERP.`);

    const message = lines.join('\n');
    log.info({ discrepancyPct: data.discrepancyPct }, 'Sending BCV discrepancy alert');
    notifyBosses(message, 'Markdown').catch((err) => {
      log.error({ err }, 'Failed to send BCV discrepancy alert');
    });
  });

  // --- CRM events ---

  eventBus.on('crm:churn-risk', (customers: {
    customer_name: string;
    customer_phone: string | null;
    avg_days_between_purchases: number;
    days_since_last_purchase: number;
    total_spent_usd: number;
    total_purchases: number;
  }[]) => {
    const lines = customers.map((c) => {
      const phone = c.customer_phone ? ` (${c.customer_phone})` : '';
      return `  • *${c.customer_name}*${phone}\n` +
        `    Compraba cada ~${Math.round(c.avg_days_between_purchases)} días, lleva *${c.days_since_last_purchase} días* sin comprar\n` +
        `    ${c.total_purchases} compras, $${c.total_spent_usd.toFixed(0)} acumulado`;
    });
    const message =
      `*⚠️ CLIENTES EN RIESGO DE PÉRDIDA*\n\n` +
      `${customers.length} cliente(s) con patrón de compra interrumpido:\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Acción sugerida: contactar para retener.`;

    log.info({ count: customers.length }, 'Sending churn risk alert');
    notifyBosses(message, 'Markdown').catch((err) => {
      log.error({ err }, 'Failed to send churn risk alert');
    });
  });

  eventBus.on('crm:reorder-due', (customers: {
    customer_name: string;
    customer_phone: string | null;
    avg_days_between_purchases: number;
    days_since_last_purchase: number;
  }[]) => {
    const lines = customers.map((c) => {
      const phone = c.customer_phone ? ` (${c.customer_phone})` : '';
      return `  • *${c.customer_name}*${phone} — compra cada ~${Math.round(c.avg_days_between_purchases)} días (día ${c.days_since_last_purchase})`;
    });
    const message =
      `*🔄 RECOMPRAS ESPERADAS*\n\n` +
      `${customers.length} cliente(s) próximos a su ciclo de compra:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Oportunidad de contacto proactivo.`;

    log.info({ count: customers.length }, 'Sending reorder-due alert');
    notifyBosses(message, 'Markdown').catch((err) => {
      log.error({ err }, 'Failed to send reorder-due alert');
    });
  });

  eventBus.on('crm:new-inactive', (customers: {
    customer_name: string;
    customer_phone: string | null;
    days_since_purchase: number;
    total_spent_usd: number;
  }[]) => {
    const lines = customers.map((c) => {
      const phone = c.customer_phone ? ` (${c.customer_phone})` : '';
      return `  • *${c.customer_name}*${phone} — compró hace ${c.days_since_purchase} días ($${c.total_spent_usd.toFixed(0)})`;
    });
    const message =
      `*🆕 CLIENTES NUEVOS SIN RETORNO*\n\n` +
      `${customers.length} cliente(s) que compraron 1 vez y no han vuelto:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Puede ser oportunidad perdida si no se contacta.`;

    log.info({ count: customers.length }, 'Sending new-inactive alert');
    notifyBosses(message, 'Markdown').catch((err) => {
      log.error({ err }, 'Failed to send new-inactive alert');
    });
  });

  log.info('Event listeners registered');
}

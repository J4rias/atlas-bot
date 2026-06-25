import { eventBus, type ArbitrageFlashAnalysis } from './triggers/event-bus.js';
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
  // --- Arbitrage P2P opportunity (Flash triage said actionable → GLM-5.2 report) ---

  eventBus.on('arbitrage:opportunity', (data: {
    premiums: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    deltas: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    erpRates: { usd_ves: number; ves_cop: number; usd_cop: number };
    p2pMedians: { cop: { buy: number | null; sell: number | null }; ves: { buy: number | null; sell: number | null } };
    flashAnalysis: ArbitrageFlashAnalysis;
    timestamp: string;
  }) => {
    const { premiums, erpRates, p2pMedians, flashAnalysis } = data;

    log.info(
      { urgency: flashAnalysis.urgency, direction: flashAnalysis.direction },
      'Arbitrage opportunity detected — running GLM-5.2 analysis',
    );

    // Calculate concrete arbitrage numbers for the prompt
    const vesCopFrontera = erpRates.ves_cop;
    let arbitrageCalc = '';
    if (p2pMedians.cop.buy && p2pMedians.ves.buy && vesCopFrontera > 0) {
      const breakeven = p2pMedians.cop.buy / p2pMedians.ves.buy;
      for (const amount of [500, 1000, 2000]) {
        const copNeeded = amount * p2pMedians.cop.buy;
        const directUsdt = copNeeded / p2pMedians.cop.buy;
        const vesObtained = copNeeded / vesCopFrontera;
        const indirectUsdt = vesObtained / p2pMedians.ves.buy;
        const gain = indirectUsdt - directUsdt;
        arbitrageCalc += `  ${copNeeded.toLocaleString()} COP: directo=${directUsdt.toFixed(1)} USDT, via VES=${indirectUsdt.toFixed(1)} USDT, ganancia=${gain.toFixed(1)} USDT (${((gain/directUsdt)*100).toFixed(1)}%)\n`;
      }
      arbitrageCalc = `\nCALCULOS DE ARBITRAJE (ya calculados, NO llames tools):\n` +
        `  Punto de quiebre VES/COP: ${breakeven.toFixed(2)} (frontera actual: ${vesCopFrontera})\n` + arbitrageCalc;
    }

    const prompt =
      `IMPORTANTE: Todos los datos ya están abajo. NO llames ninguna herramienta. Responde DIRECTO con el análisis.\n\n` +
      `Se detectó una oportunidad de arbitraje USDT en Binance P2P.\n\n` +
      `DATOS DEL MERCADO (ya verificados, en tiempo real):\n` +
      `- Tasas ERP: USD/VES = ${erpRates.usd_ves}, VES/COP = ${erpRates.ves_cop}, USD/COP = ${erpRates.usd_cop}\n` +
      `- P2P COP: COMPRA mediana = ${p2pMedians.cop.buy ?? 'N/A'}, VENTA mediana = ${p2pMedians.cop.sell ?? 'N/A'}\n` +
      `- P2P VES: COMPRA mediana = ${p2pMedians.ves.buy ?? 'N/A'}, VENTA mediana = ${p2pMedians.ves.sell ?? 'N/A'}\n` +
      `- Premiums: COP compra ${premiums.cop.buy ?? 'N/A'}%, COP venta ${premiums.cop.sell ?? 'N/A'}%, ` +
        `VES compra ${premiums.ves.buy ?? 'N/A'}%, VES venta ${premiums.ves.sell ?? 'N/A'}%\n` +
      `${arbitrageCalc}\n` +
      `TRIAGE AUTOMATICO: ${flashAnalysis.summary}\n` +
      `Dirección sugerida: ${flashAnalysis.direction}, Urgencia: ${flashAnalysis.urgency}\n\n` +
      `Redacta un reporte BREVE para los jefes de Atlas (máximo 8 líneas). Incluye:\n` +
      `1. Qué hacer (comprar/vender USDT, en qué moneda, ruta directa vs indirecta)\n` +
      `2. Ganancia concreta en USDT para los montos calculados arriba\n` +
      `3. Hasta qué tasa VES/COP de frontera conviene la ruta indirecta (punto de quiebre)\n` +
      `4. Recomendación: EJECUTAR / MONITOREAR / IGNORAR\n\n` +
      `Responde en español. No uses herramientas. Ve al grano.`;

    runManagerAgent(prompt, {
      preamble: 'Análisis de oportunidad de arbitraje P2P detectada por el monitor automático.',
      maxTokens: 1024,
      model: MODEL_GLM_5_2,
    })
      .then((analysis) => {
        const header =
          `*OPORTUNIDAD DE ARBITRAJE P2P*\n\n` +
          `Urgencia: *${flashAnalysis.urgency.toUpperCase()}* | Dirección: *${flashAnalysis.direction}*\n\n`;
        const fullMessage = `${header}${toTelegramMarkdown(analysis)}`;
        return notifyBosses(fullMessage, 'Markdown');
      })
      .catch((err) => {
        log.error({ err }, 'GLM-5.2 arbitrage analysis failed — sending Flash summary');
        const fallback =
          `*OPORTUNIDAD DE ARBITRAJE P2P*\n\n` +
          `${flashAnalysis.summary}\n\n` +
          `Premiums: COP compra ${premiums.cop.buy ?? 'N/A'}%, VES compra ${premiums.ves.buy ?? 'N/A'}%\n` +
          `Dirección: ${flashAnalysis.direction} | Urgencia: ${flashAnalysis.urgency}`;
        notifyBosses(fallback, 'Markdown').catch(
          (e) => log.error({ err: e }, 'Failed to send arbitrage alert'),
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

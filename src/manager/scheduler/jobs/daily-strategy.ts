import { runManagerAgent } from '../../agent/agent.js';
import { notifyBosses, notifyTech, toTelegramMarkdown } from '../../telegram/notifications.js';
import { createLogger } from '../../../shared/logger.js';
import { MODEL_GLM_5_2 } from '../../../shared/ai/client.js';

const log = createLogger('manager').child({ job: 'daily-strategy' });

/**
 * Daily strategic report — runs at 8:00 AM Venezuela (12:00 UTC), Mon-Sat.
 * 5 minutes after CRM job so churn data is already in memory.
 *
 * Uses cross-analysis tools to generate a unified strategic view
 * and delivers top 3 prioritized actions to the bosses.
 */
export async function runDailyStrategy(): Promise<void> {
  log.info('Starting daily strategic report');

  try {
    const response = await runManagerAgent(DAILY_STRATEGY_PROMPT, {
      preamble: 'Este es tu plan de ventas diario. Es el reporte más importante del día — los jefes lo leen al abrir la jornada.',
      maxTokens: 3072,
      model: MODEL_GLM_5_2,
    });

    // The daily plan always sends (unlike hourly diagnostic which filters)
    log.info('Daily sales plan generated — sending to bosses');
    await notifyBosses(toTelegramMarkdown(response), 'Markdown');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Daily strategy report failed');

    await notifyTech(
      `*REPORTE TÉCNICO*\n\n` +
      `Qué intenté: Reporte estratégico diario\n` +
      `Qué falló: ${msg}\n` +
      `Prioridad: ALTA — los jefes esperan este reporte cada mañana`,
      'Markdown',
    );
  }
}

const DAILY_STRATEGY_PROMPT = `Genera el PLAN DE VENTAS del día. Este es el reporte más importante — los jefes lo leen al iniciar la jornada para decidir qué hacer.

PASO 1 — OBJETIVO $1M LIQUIDEZ NETA (obligatorio):
- Usa get_sales_stats (start_date: 2026-01-01, end_date: fecha de ayer, summary_only: true) para obtener ganancia bruta acumulada (grossProfit). NOTA: datos de costo disponibles desde 2026-06-17.
- Usa get_inventory_health para obtener la valuación del inventario (valuation.total_usd).
- Usa get_accounts_receivable (view: summary) para obtener las cuentas por cobrar reales. El total pendiente (totals.total_pending_cop) es dinero que nos DEBEN — es un activo pero NO es líquido hasta que se cobre.
- Calcula liquidez neta = inventario a costo + ganancia acumulada - cuentas por cobrar vencidas (solo buckets 0_30 + 31_60 + 61_90 + +90, NO vigente ni sin_termino). Las CxC vigentes son activo sano; las vencidas son riesgo.
- Calcula: faltante para $1,000,000, días hábiles restantes (Lun-Sáb hasta 31 dic 2026), meta diaria neta.
- Lee tu memoria (read_memory subject: daily_target) para ver la meta anterior. La meta de hoy NUNCA puede ser menor.
- Consulta ventas de la última semana (get_sales_summary, últimos 7 días) para comparar el ritmo actual vs la meta. Si el promedio real supera la meta calculada, sube la meta a promedio × 1.05.
- Detecta la fase actual según promedio de ventas netas de los últimos 7 días: Saneamiento (<$150/día), Tracción (<$600/día), Escala ($600+/día).

PASO 2 — TASAS DEL DIA (obligatorio):
- Usa get_exchange_rates para obtener las tasas ERP de HOY (USD/VES, VES/COP)
- Usa get_usdt_rate para la tasa USDT/COP actual de Binance P2P
- Consulta ventas por moneda de ayer o últimos días (get_sales_stats → salesByCurrency)
- NO alertes que la tasa cambió — eso pasa todos los días. Analiza el IMPACTO: "Si ayer recibimos $X en COP, al convertir hoy vs ayer hay $Y de diferencia."
- Si el VES se está devaluando rápido, recomienda convertir rápido y cuantifica cuánto se pierde por día de espera.
- Si hay spread entre tasa USDT de Binance y tasa USD del ERP, reporta la oportunidad de arbitraje.

PASO 3 — ESTRATEGIAS DEL DIA (máximo 3):
Cada estrategia DEBE ser:
- CONCRETA: nombres de clientes, nombres de productos, cantidades, montos en USD
- CUANTIFICADA: "esto genera ~$X,XXX que cubre N% de la meta del día"
- EJECUTABLE HOY: algo que los jefes pueden hacer esta mañana

Para generar estrategias, consulta datos reales:
- get_customer_insights → clientes con recompra esperada HOY o en riesgo de perderse. Nombres y montos.
- get_inventory_health → qué hay disponible, qué está agotado, qué tiene rotación lenta (capital trabado)
- analyze_customer_value → quiénes son los clientes más rentables
- get_sales_stats (con topProducts) → productos estrella y su rendimiento compuesto (margen × rotación)
- search_knowledge → reglas de arbitraje, patrones estacionales, reglas del negocio
- read_memory → qué sugeriste ayer y qué resultado tuvo. Si algo funcionó, repite. Si no, ajusta.

Ejemplos de estrategias BUENAS:
- "Contactar a [nombre] — compra cada ~12 días, lleva 11. Su pedido habitual: $850. Cubre el 14% de la meta."
- "Liquidar [producto] (45 días sin moverse, $2,300 en capital trabado). Ofrecerlo a los 5 clientes que lo compraron antes con -8%. Liberar ese capital para reponer [producto de alta rotación con mejor rendimiento compuesto]."
- "Ayer recibimos $4,200 en COP. La tasa COP mejoró 0.8% hoy → convertir ahora genera $33 extra vs esperar."
- "[Producto X] tiene 25% margen y rota cada 8 días (rendimiento compuesto ~1,140%/año). Está por agotarse. Priorizar reposición inmediata — cada día sin stock son ~$XXX que no se componen."

Ejemplos de estrategias MALAS (NO hagas esto):
- "Considerar hacer promociones" → ¿de qué? ¿a quién? ¿cuánto genera?
- "La tasa subió, congelar precios" → la tasa siempre se mueve, no es estrategia
- "Moneda preferida hoy: COP" → los clientes pagan con lo que tienen, no se elige

PASO 4 — ALERTAS OPERATIVAS (solo si hay):
Reporta UNICAMENTE cosas que IMPIDEN vender:
- Productos estrella agotados (que tienen demanda real, no cualquier producto)
- Pre-órdenes pendientes > 24h (dinero esperando)
- Clientes de alto valor que pasaron su ventana de recompra sin comprar
- Clientes BLOQUEADOS por CxC vencidas (usa get_accounts_receivable view: customers). Si un cliente de alto valor está bloqueado, es prioridad de cobranza.

NO alertes sobre: cambios de tasa (normal), stock bajo de productos que no se venden, cosas que no requieren acción.

PASO 5 — GUARDAR EN MEMORIA:
- write_memory (subject: daily_target, content: meta del día, acumulado del año, días restantes)
- write_memory (subject: daily_strategy, content: resumen de lo sugerido hoy para evaluar mañana si funcionó)

FORMATO DE SALIDA (Telegram Markdown — usa *asteriscos simples* para negrillas, NO uses **doble asterisco**):

PLAN DE VENTAS — [dia de la semana] [fecha]

LIQUIDEZ NETA → $1M
- Estimado actual: $XXX,XXX (XX% del objetivo)
- Inventario: $XXX,XXX | Ganancia acumulada: $XXX,XXX
- CxC total: $XXX,XXX (XX facturas) | Vencidas: $XXX,XXX
- Faltan: $XXX,XXX en N días hábiles
- Fase: [Saneamiento/Tracción/Escala]
- Meta hoy: $X,XXX netos

ESTRATEGIAS DEL DIA
1. [acción concreta con nombres, montos y % de la meta que cubre]
2. [acción concreta con nombres, montos y % de la meta que cubre]
3. [acción concreta con nombres, montos y % de la meta que cubre]

ARBITRAJE
- [oportunidad concreta con montos en USD, o "Sin oportunidad relevante hoy"]

ALERTAS OPERATIVAS
- [solo cosas que impiden vender, o "Sin alertas"]

IMPORTANTE: No decores. No repitas información. Ve al grano. Los jefes necesitan saber QUE HACER, no un análisis académico.`;

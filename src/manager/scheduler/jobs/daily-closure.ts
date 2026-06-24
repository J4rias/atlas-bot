import { runManagerAgent } from '../../agent/agent.js';
import { notifyBosses, notifyTech, toTelegramMarkdown } from '../../telegram/notifications.js';
import { createLogger } from '../../../shared/logger.js';
import { MODEL_GLM_5_2 } from '../../../shared/ai/client.js';

const log = createLogger('manager').child({ job: 'daily-closure' });

/**
 * Daily closing report — runs at 6:00 PM Venezuela (22:00 UTC), Mon-Sat.
 *
 * Generates an end-of-day summary that matches the ERP's cierre de caja,
 * with full currency breakdown (USD, COP, VES, etc.) and payment methods.
 */
export async function runDailyClosure(): Promise<void> {
  log.info('Starting daily closing report');

  try {
    const response = await runManagerAgent(DAILY_CLOSURE_PROMPT, {
      preamble: 'Este es tu reporte de cierre del día. Debe coincidir con el cierre de caja del ERP.',
      maxTokens: 3072,
      model: MODEL_GLM_5_2,
    });

    log.info('Daily closing report generated — sending to bosses');
    await notifyBosses(toTelegramMarkdown(response), 'Markdown');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Daily closing report failed');

    await notifyTech(
      `*REPORTE TÉCNICO*\n\n` +
      `Qué intenté: Reporte de cierre diario\n` +
      `Qué falló: ${msg}\n` +
      `Prioridad: ALTA — los jefes esperan el cierre al final de cada jornada`,
      'Markdown',
    );
  }
}

const DAILY_CLOSURE_PROMPT = `Genera el REPORTE DE CIERRE del día. Este reporte se envía al final de la jornada y DEBE coincidir con el cierre de caja del ERP.

PASO 1 — CIERRE DE CAJA (obligatorio):
- Usa get_daily_closure (sin parámetros, toma la fecha de hoy) para obtener el cierre de caja del ERP
- Este es el dato maestro — todo el reporte se basa en estos números

PASO 2 — DESGLOSE POR MONEDA (obligatorio):
- Del cierre de caja, extrae y reporta CADA moneda por separado:
  - Ventas totales en USD (totalSalesUSD)
  - Ventas totales en COP (totalSalesCOP)
  - Desglose de pagos por método Y por moneda (paymentsBreakdown): efectivo, transferencia, punto de venta, etc. en CADA moneda
  - Crédito otorgado en USD (creditTotalUSD)
  - Cobros de crédito por moneda (creditCollectedByCurrency): cuánto se cobró en USD, COP, VES, etc.
  - Devoluciones: monto en USD, monto en COP, cantidad de devoluciones (cashRefunds)
- NO omitas ninguna moneda. Si hay operaciones en VES, BRL, o cualquier otra moneda, repórtalas.

PASO 3 — TASAS DEL DIA (obligatorio):
- Usa get_exchange_rates para las tasas vigentes al cierre
- Reporta la tasa de cada moneda utilizada en el día
- Calcula el equivalente en USD de todas las operaciones en otras monedas usando las tasas del día

PASO 4 — COMPARACIÓN CON META (obligatorio):
- Lee tu memoria (read_memory subject: daily_target) para la meta del día que se fijó en la mañana
- Compara ventas reales vs meta: ¿se cumplió? ¿por cuánto se superó o faltó?
- Calcula el % de cumplimiento

PASO 5 — RESUMEN VS PLAN DE LA MAÑANA:
- Lee tu memoria (read_memory subject: daily_strategy) para ver qué estrategias se sugirieron en la mañana
- Evalúa brevemente: ¿las ventas del día reflejan que se ejecutaron las estrategias?
- No te extiendas — solo 1-2 líneas de evaluación

PASO 6 — GUARDAR EN MEMORIA:
- write_memory (subject: daily_closure, content: resumen del cierre con cifras clave para comparar mañana)

FORMATO DE SALIDA (Telegram Markdown — usa *asteriscos simples* para negrillas, NO uses **doble asterisco**):

CIERRE DEL DIA — [dia de la semana] [fecha]

VENTAS TOTALES
- Cantidad de ventas: N
- Total USD: $X,XXX.XX
- Total COP: $X,XXX,XXX COP
- Equivalente total en USD: $X,XXX.XX

DESGLOSE POR METODO DE PAGO
[Para cada método: efectivo, transferencia, punto, etc.]
- [Método]: $X,XXX USD / $X,XXX,XXX COP / X,XXX,XXX VES
[Listar TODAS las monedas que aparezcan]

CREDITO
- Otorgado hoy: $X,XXX USD
- Cobrado hoy: $X,XXX USD / $X,XXX,XXX COP
[Desglosar cada moneda cobrada]

DEVOLUCIONES
- Cantidad: N
- USD: $X,XXX / COP: $X,XXX,XXX

TASAS DE CIERRE
- USD/VES: X,XXX.XX
- USD/COP: X,XXX.XX
[Todas las monedas activas]

META DEL DIA
- Meta: $X,XXX
- Real: $X,XXX
- Cumplimiento: XX%

EVALUACION
[1-2 líneas sobre si se ejecutaron las estrategias de la mañana]

IMPORTANTE: Los números del cierre DEBEN coincidir exactamente con los del ERP (get_daily_closure). No redondees ni aproximes — usa las cifras exactas. Cada moneda debe aparecer explícitamente.`;

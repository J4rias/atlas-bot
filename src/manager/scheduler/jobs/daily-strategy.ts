import { runManagerAgent } from '../../agent/agent.js';
import { notifyBosses, notifyTech } from '../../telegram/notifications.js';
import { createLogger } from '../../../shared/logger.js';

const log = createLogger('manager').child({ job: 'daily-strategy' });

/**
 * Daily strategic report — runs at 7:05 AM Venezuela (11:05 UTC).
 * 5 minutes after CRM job so churn data is already in memory.
 *
 * Uses cross-analysis tools to generate a unified strategic view
 * and delivers top 3 prioritized actions to the bosses.
 */
export async function runDailyStrategy(): Promise<void> {
  log.info('Starting daily strategic report');

  try {
    const response = await runManagerAgent(DAILY_STRATEGY_PROMPT, {
      preamble: 'Este es tu reporte estratégico diario automático. Ejecuta todos los análisis cruzados.',
      maxTokens: 3072,
    });

    // The daily strategy always sends (unlike hourly diagnostic which filters)
    log.info('Daily strategy report generated — sending to bosses');
    await notifyBosses(`*📊 Reporte Estratégico Diario*\n\n${response}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Daily strategy report failed');

    await notifyTech(
      `*REPORTE TÉCNICO*\n\n` +
      `Qué intenté: Reporte estratégico diario\n` +
      `Qué falló: ${msg}\n` +
      `Prioridad: ALTA — los jefes esperan este reporte cada mañana`,
    );
  }
}

const DAILY_STRATEGY_PROMPT = `Genera tu reporte estratégico diario. Ejecuta TODOS estos análisis:

1. ANÁLISIS TASA ↔ VENTAS (analyze_rate_sales_impact, últimos 7 días):
   - ¿Cómo se correlaciona el movimiento de tasas con las ventas?
   - ¿La tasa actual favorece o perjudica las ventas?

2. PATRONES DE VENTAS (analyze_sales_patterns, últimas 4 semanas):
   - ¿Qué días venden más? ¿La tendencia es creciente o decreciente?
   - ¿Hay algún cambio respecto al patrón habitual?

3. VALOR DE CLIENTES (analyze_customer_value, últimos 30 días):
   - ¿Quiénes son los clientes más valiosos?
   - ¿Qué tan concentrado está el ingreso?

4. CRUZA CON CRM:
   - Consulta tu memoria (read_memory) para el análisis CRM del día.
   - ¿Algún cliente de alto valor está en riesgo de churn? → ALERTA MÁXIMA.

5. CONSULTA MEMORIA DE SUSTITUCIÓN:
   - Lee la memoria de sustitución de productos (read_memory subject: product_substitution).
   - ¿Hay algún producto estrella sin stock cuyo sustituto se está vendiendo?

6. RECOMENDACIÓN COMERCIAL (Go-to-Market):
   - Con base en los 5 análisis anteriores, aplica las estrategias comerciales de tu prompt.
   - Selecciona 1-2 estrategias que apliquen HOY según los datos reales (no fuerces una si no hay señal).
   - Prioridad: reactivar clientes dormidos de alto valor > mover inventario lento > oportunidad de volumen.
   - Si hay una fecha comercial importante próxima (ver calendario estacional), menciónala.

FORMATO DEL REPORTE:
- Resumen ejecutivo (2-3 líneas máximo)
- Hallazgos clave con números (lista con bullet points)
- TOP 3 ACCIONES PRIORIZADAS — ordenadas por impacto, cada una con qué hacer y por qué
- Guarda un resumen del análisis en tu memoria (write_memory subject: daily_strategy)

IMPORTANTE: No decores. Ve al grano con datos y acciones concretas.`;

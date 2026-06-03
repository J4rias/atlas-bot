import { runManagerAgent } from './agent.js';
import { notifyBosses, notifyTech } from '../telegram/notifications.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('manager').child({ module: 'diagnostic' });

/**
 * Hourly diagnostic pipeline.
 *
 * 1. Collect — Claude queries ERP via tools
 * 2. Analyze — Claude processes data with memory context
 * 3. Filter — Claude decides if there's anything worth reporting
 * 4. Send — Only sends if there are findings
 */
export async function runHourlyDiagnostic(): Promise<void> {
  log.info('Starting hourly diagnostic');

  try {
    const response = await runManagerAgent(
      DIAGNOSTIC_PROMPT,
      {
        preamble: 'Esta es tu ejecución de diagnóstico horario automático.',
        maxTokens: 2048,
      },
    );

    // Claude's response starts with RELEVANCE: YES/NO
    const isRelevant = response.toUpperCase().startsWith('RELEVANCE: YES');

    if (isRelevant) {
      // Strip the RELEVANCE line and send the actual report
      const report = response.replace(/^RELEVANCE:\s*(YES|NO)\s*\n*/i, '');
      log.info('Diagnostic found relevant findings — sending to bosses');
      await notifyBosses(`*Diagnóstico horario*\n\n${report}`);
    } else {
      log.info('Diagnostic found nothing relevant — skipping notification');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Hourly diagnostic failed');

    await notifyTech(
      `*REPORTE TÉCNICO*\n\n` +
      `Qué intenté: Diagnóstico horario automático\n` +
      `Qué falló: ${msg}\n` +
      `Prioridad: MEDIA`,
    );
  }
}

const DIAGNOSTIC_PROMPT = `Ejecuta tu diagnóstico horario. Sigue estos pasos:

1. RECOLECTA datos usando tus herramientas:
   - Consulta el catálogo de productos y precios
   - Consulta las tasas de cambio actuales
   - Consulta tu memoria para comparar con observaciones previas

2. ANALIZA:
   - ¿Hay productos con stock críticamente bajo?
   - ¿Las tasas de cambio cambiaron significativamente desde la última revisión?
   - ¿Hay algún patrón inusual?
   - ¿Alguna de tus sugerencias previas necesita seguimiento?

3. DECIDE si hay algo que valga la pena reportar.
   - Si encuentras hallazgos relevantes, empieza tu respuesta EXACTAMENTE con: RELEVANCE: YES
   - Si no hay nada destacable, empieza EXACTAMENTE con: RELEVANCE: NO

4. Si es RELEVANCE: YES, incluye:
   - Resumen ejecutivo (1-2 líneas)
   - Hallazgos clave con números
   - Recomendación accionable

5. Guarda en tu memoria cualquier observación nueva que descubras para futuras comparaciones.

Recuerda: no reportes cosas sin importancia. Los jefes no quieren spam.`;

import { getP2PRates } from '../../../shared/services/binance-p2p.js';
import { getExchangeRates } from '../../../shared/services/erp.js';
import * as memoryRepo from '../../../shared/db/repositories/memory.repo.js';
import { createLogger } from '../../../shared/logger.js';
import { eventBus, type ArbitrageFlashAnalysis } from '../triggers/event-bus.js';
import { runManagerAgent } from '../../agent/agent.js';
import { MODEL_GLM_FLASH } from '../../../shared/ai/client.js';

const log = createLogger('manager').child({ job: 'rate-monitor' });

// ---------------------------------------------------------------------------
// Thresholds — trigger Flash triage when exceeded
// ---------------------------------------------------------------------------
const COP_PREMIUM_ABS_THRESHOLD = 3.0;   // % absolute COP premium
const COP_PREMIUM_DELTA_THRESHOLD = 1.5;  // pp change since last check
const VES_PREMIUM_ABS_THRESHOLD = 35.0;   // % absolute VES premium (normally ~25-35%)
const VES_PREMIUM_DELTA_THRESHOLD = 3.0;   // pp change since last check

const MEMORY_SUBJECT = 'arbitrage_snapshot_latest';

// ---------------------------------------------------------------------------
// Snapshot shape stored in memory
// ---------------------------------------------------------------------------
interface ArbitrageSnapshot {
  premiums: {
    cop: { buy: number | null; sell: number | null };
    ves: { buy: number | null; sell: number | null };
  };
  erpRates: { usd_ves: number; ves_cop: number; usd_cop: number };
  p2pMedians: {
    cop: { buy: number | null; sell: number | null };
    ves: { buy: number | null; sell: number | null };
  };
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcPremium(p2pMedian: number | null, erpRef: number): number | null {
  if (p2pMedian == null || erpRef <= 0) return null;
  return Math.round(((p2pMedian / erpRef) - 1) * 10000) / 100; // 2 decimal %
}

function calcDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 100) / 100;
}

function shouldTrigger(
  premiums: ArbitrageSnapshot['premiums'],
  deltas: ArbitrageSnapshot['premiums'],
): string[] {
  const triggers: string[] = [];

  if (premiums.cop.buy != null) {
    if (Math.abs(premiums.cop.buy) >= COP_PREMIUM_ABS_THRESHOLD)
      triggers.push(`COP BUY premium ${premiums.cop.buy}% (umbral ${COP_PREMIUM_ABS_THRESHOLD}%)`);
    if (deltas.cop.buy != null && Math.abs(deltas.cop.buy) >= COP_PREMIUM_DELTA_THRESHOLD)
      triggers.push(`COP BUY delta ${deltas.cop.buy}pp (umbral ${COP_PREMIUM_DELTA_THRESHOLD}pp)`);
  }
  if (premiums.cop.sell != null) {
    if (Math.abs(premiums.cop.sell) >= COP_PREMIUM_ABS_THRESHOLD)
      triggers.push(`COP SELL premium ${premiums.cop.sell}% (umbral ${COP_PREMIUM_ABS_THRESHOLD}%)`);
    if (deltas.cop.sell != null && Math.abs(deltas.cop.sell) >= COP_PREMIUM_DELTA_THRESHOLD)
      triggers.push(`COP SELL delta ${deltas.cop.sell}pp (umbral ${COP_PREMIUM_DELTA_THRESHOLD}pp)`);
  }
  if (premiums.ves.buy != null) {
    if (premiums.ves.buy >= VES_PREMIUM_ABS_THRESHOLD)
      triggers.push(`VES BUY premium ${premiums.ves.buy}% (umbral ${VES_PREMIUM_ABS_THRESHOLD}%)`);
    if (deltas.ves.buy != null && Math.abs(deltas.ves.buy) >= VES_PREMIUM_DELTA_THRESHOLD)
      triggers.push(`VES BUY delta ${deltas.ves.buy}pp (umbral ${VES_PREMIUM_DELTA_THRESHOLD}pp)`);
  }
  if (premiums.ves.sell != null) {
    if (premiums.ves.sell >= VES_PREMIUM_ABS_THRESHOLD)
      triggers.push(`VES SELL premium ${premiums.ves.sell}% (umbral ${VES_PREMIUM_ABS_THRESHOLD}%)`);
    if (deltas.ves.sell != null && Math.abs(deltas.ves.sell) >= VES_PREMIUM_DELTA_THRESHOLD)
      triggers.push(`VES SELL delta ${deltas.ves.sell}pp (umbral ${VES_PREMIUM_DELTA_THRESHOLD}pp)`);
  }

  return triggers;
}

function buildFlashPrompt(
  snapshot: ArbitrageSnapshot,
  deltas: ArbitrageSnapshot['premiums'],
  triggers: string[],
): string {
  const { premiums, erpRates, p2pMedians } = snapshot;

  return `Eres un sistema de triage para oportunidades de arbitraje USDT en Binance P2P.

DATOS ACTUALES:
- Tasas ERP: USD/VES = ${erpRates.usd_ves}, VES/COP = ${erpRates.ves_cop}, USD/COP derivada = ${erpRates.usd_cop}
- Binance P2P mediana COP: COMPRA = ${p2pMedians.cop.buy ?? 'N/A'}, VENTA = ${p2pMedians.cop.sell ?? 'N/A'}
- Binance P2P mediana VES: COMPRA = ${p2pMedians.ves.buy ?? 'N/A'}, VENTA = ${p2pMedians.ves.sell ?? 'N/A'}
- Premiums actuales: COP compra ${premiums.cop.buy ?? 'N/A'}%, COP venta ${premiums.cop.sell ?? 'N/A'}%, VES compra ${premiums.ves.buy ?? 'N/A'}%, VES venta ${premiums.ves.sell ?? 'N/A'}%
- Cambio vs último check: COP compra ${deltas.cop.buy ?? 'N/A'}pp, COP venta ${deltas.cop.sell ?? 'N/A'}pp, VES compra ${deltas.ves.buy ?? 'N/A'}pp, VES venta ${deltas.ves.sell ?? 'N/A'}pp
- Triggers activados: ${triggers.join('; ')}

CONTEXTO: Atlas es un negocio de víveres en frontera Venezuela-Colombia. Recibe 99.7% de pagos en COP. Compra USDT con VES o COP para preservar valor (VES devalúa ~3%/semana). También vende USDT cuando necesita fiat para proveedores. Las conversiones se hacen DIARIAMENTE porque la alta volatilidad hace que esperar días signifique pérdidas reales. La dinámica de compra/venta depende de lo que exijan los proveedores y la operación.

Responde SOLO con JSON (sin markdown, sin backticks):
{"actionable": true/false, "reason": "explicación breve", "urgency": "high/medium/low", "direction": "buy_usdt/sell_usdt/cross_fiat/none", "summary": "resumen ejecutivo (max 3 líneas)"}

Reglas:
- actionable=true SOLO si hay una oportunidad real de ganancia o protección sobre un volumen razonable ($500+ USDT)
- Si los premiums están en rangos normales y estables, actionable=false
- direction="cross_fiat" si la oportunidad es comprar USDT en un fiat y vender en otro
- direction="buy_usdt" si es buen momento para comprar USDT (premium bajo o bajando)
- direction="sell_usdt" si es buen momento para vender USDT (premium alto o subiendo)`;
}

function parseFlashResponse(raw: string): ArbitrageFlashAnalysis {
  // Try to extract JSON from the response (may be wrapped in backticks)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn({ raw: raw.slice(0, 200) }, 'Flash response has no JSON — treating as not actionable');
    return { actionable: false, reason: 'No se pudo parsear respuesta', urgency: 'low', direction: 'none', summary: '' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      actionable: parsed.actionable === true,
      reason: String(parsed.reason ?? ''),
      urgency: ['high', 'medium', 'low'].includes(parsed.urgency) ? parsed.urgency : 'low',
      direction: ['buy_usdt', 'sell_usdt', 'cross_fiat', 'none'].includes(parsed.direction) ? parsed.direction : 'none',
      summary: String(parsed.summary ?? ''),
    };
  } catch {
    log.warn({ raw: raw.slice(0, 200) }, 'Flash response JSON parse failed — treating as not actionable');
    return { actionable: false, reason: 'JSON inválido', urgency: 'low', direction: 'none', summary: '' };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runRateMonitor() {
  log.info('Running arbitrage rate monitor');

  try {
    // 1. Fetch P2P rates and ERP reference rates in parallel
    const [p2pRates, erpRates] = await Promise.all([
      getP2PRates(),
      getExchangeRates(),
    ]);

    // 2. Extract ERP reference rates
    const usdVesRate = erpRates.find(
      (r) => r.from_currency === 'USD' && r.to_currency === 'VES',
    );
    const vesCopRate = erpRates.find(
      (r) => r.from_currency === 'VES' && r.to_currency === 'COP',
    );

    if (!usdVesRate || !vesCopRate) {
      log.warn('Missing ERP rates (USD_VES or VES_COP) — skipping arbitrage check');
      return;
    }

    const usdVes = Number(usdVesRate.rate);
    const vesCop = Number(vesCopRate.rate);
    const usdCop = Math.round(usdVes * vesCop * 100) / 100;

    // 3. Calculate premiums
    const premiums = {
      cop: {
        buy: calcPremium(p2pRates.cop.buy?.median ?? null, usdCop),
        sell: calcPremium(p2pRates.cop.sell?.median ?? null, usdCop),
      },
      ves: {
        buy: calcPremium(p2pRates.ves.buy?.median ?? null, usdVes),
        sell: calcPremium(p2pRates.ves.sell?.median ?? null, usdVes),
      },
    };

    const p2pMedians = {
      cop: {
        buy: p2pRates.cop.buy?.median ?? null,
        sell: p2pRates.cop.sell?.median ?? null,
      },
      ves: {
        buy: p2pRates.ves.buy?.median ?? null,
        sell: p2pRates.ves.sell?.median ?? null,
      },
    };

    const erpRef = { usd_ves: usdVes, ves_cop: vesCop, usd_cop: usdCop };

    // 4. Load previous snapshot
    let prevPremiums: ArbitrageSnapshot['premiums'] | null = null;
    try {
      const memories = await memoryRepo.findMemories('observation', MEMORY_SUBJECT, 1);
      if (memories.length > 0) {
        const prev: ArbitrageSnapshot = JSON.parse(memories[0].content);
        prevPremiums = prev.premiums;
      }
    } catch {
      log.debug('No previous arbitrage snapshot — first run');
    }

    // 5. Calculate deltas
    const deltas = {
      cop: {
        buy: calcDelta(premiums.cop.buy, prevPremiums?.cop.buy ?? null),
        sell: calcDelta(premiums.cop.sell, prevPremiums?.cop.sell ?? null),
      },
      ves: {
        buy: calcDelta(premiums.ves.buy, prevPremiums?.ves.buy ?? null),
        sell: calcDelta(premiums.ves.sell, prevPremiums?.ves.sell ?? null),
      },
    };

    // 6. Save current snapshot
    const currentSnapshot: ArbitrageSnapshot = {
      premiums,
      erpRates: erpRef,
      p2pMedians,
      timestamp: p2pRates.timestamp,
    };

    try {
      const existing = await memoryRepo.findMemories('observation', MEMORY_SUBJECT, 1);
      if (existing.length > 0) {
        await memoryRepo.supersedeMemory(existing[0].id, {
          category: 'observation',
          subject: MEMORY_SUBJECT,
          content: JSON.stringify(currentSnapshot),
          confidence: 1.0,
          source: 'rate-monitor',
        });
      } else {
        await memoryRepo.saveMemory({
          category: 'observation',
          subject: MEMORY_SUBJECT,
          content: JSON.stringify(currentSnapshot),
          confidence: 1.0,
          source: 'rate-monitor',
        });
      }
    } catch {
      log.debug('Could not save arbitrage snapshot to memory');
    }

    // 7. Evaluate thresholds
    const triggers = shouldTrigger(premiums, deltas);

    if (triggers.length === 0) {
      log.info(
        { premiums, p2pMedians, erpRates: erpRef },
        'No arbitrage triggers — premiums within normal range',
      );
      return;
    }

    log.info({ triggers, premiums, deltas }, 'Arbitrage thresholds breached — running Flash triage');

    // 8. Flash triage
    const flashPrompt = buildFlashPrompt(currentSnapshot, deltas, triggers);
    let flashAnalysis: ArbitrageFlashAnalysis;

    try {
      const flashRaw = await runManagerAgent(flashPrompt, {
        preamble: 'Triage automático de arbitraje P2P.',
        maxTokens: 512,
        model: MODEL_GLM_FLASH,
      });
      flashAnalysis = parseFlashResponse(flashRaw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, 'Flash triage failed');
      return;
    }

    log.info({ flashAnalysis }, 'Flash triage result');

    // 9. If not actionable, stop here
    if (!flashAnalysis.actionable) {
      log.info('Flash says not actionable — no notification');
      return;
    }

    // 10. Escalate to GLM-5.2 via event
    eventBus.emit('arbitrage:opportunity', {
      premiums,
      deltas,
      erpRates: erpRef,
      p2pMedians,
      flashAnalysis,
      timestamp: p2pRates.timestamp,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'Arbitrage rate monitor failed');
  }
}

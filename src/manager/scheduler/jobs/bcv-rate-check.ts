import https from 'node:https';
import { getExchangeRates } from '../../../shared/services/erp.js';
import { createLogger } from '../../../shared/logger.js';
import { eventBus } from '../triggers/event-bus.js';

const log = createLogger('manager').child({ job: 'bcv-rate-check' });

const BCV_URL = 'https://www.bcv.org.ve/';

interface BcvRate {
  currency: string;
  rate: number;
}

/** Threshold: alert if ERP rate differs from BCV by more than this percentage. */
const DISCREPANCY_THRESHOLD_PCT = 1.0;

/**
 * Scrape exchange rates directly from the BCV website.
 * The page has divs with ids: euro, yuan, lira, rublo, dolar
 * each containing a <span> with the currency code and a <strong> with the rate.
 */
async function fetchBcvRates(): Promise<BcvRate[]> {
  // BCV has an invalid/self-signed SSL cert — use a custom agent to skip verification
  const agent = new https.Agent({ rejectUnauthorized: false });

  const html = await new Promise<string>((resolve, reject) => {
    https.get(BCV_URL, { agent, headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`BCV responded with status ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
  const rates: BcvRate[] = [];

  // Match pattern: <span> USD</span> ... <strong class="strong-tb"> 607,39190000</strong>
  const regex = /<div\s+id="(euro|yuan|lira|rublo|dolar)"[\s\S]*?<span>\s*(\w+)\s*<\/span>[\s\S]*?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const currency = match[2].trim();
    const rateStr = match[3].replace(/\./g, '').replace(',', '.');
    const rate = parseFloat(rateStr);
    if (!isNaN(rate)) {
      rates.push({ currency, rate });
    }
  }

  return rates;
}

export async function runBcvRateCheck() {
  log.info('Running BCV rate check');

  try {
    const bcvRates = await fetchBcvRates();

    if (bcvRates.length === 0) {
      log.warn('Could not parse any rates from BCV website');
      return;
    }

    const bcvUsd = bcvRates.find((r) => r.currency === 'USD');
    if (!bcvUsd) {
      log.warn('USD rate not found in BCV data');
      return;
    }

    log.info({ bcvRates }, 'BCV rates fetched');

    // Fetch ERP rates
    const erpRates = await getExchangeRates();
    const erpUsdVes = erpRates.find((r) => r.currency === 'VES');

    if (!erpUsdVes) {
      log.warn('No USD/VES rate found in ERP');
      return;
    }

    const erpRate = typeof erpUsdVes.rate === 'string' ? parseFloat(erpUsdVes.rate) : erpUsdVes.rate;
    const bcvRate = bcvUsd.rate;
    const discrepancyPct = Math.abs((erpRate - bcvRate) / bcvRate) * 100;

    log.info(
      { erpRate, bcvRate, discrepancyPct: discrepancyPct.toFixed(2) },
      'Rate comparison',
    );

    if (discrepancyPct >= DISCREPANCY_THRESHOLD_PCT) {
      const bcvEur = bcvRates.find((r) => r.currency === 'EUR');
      eventBus.emit('rate:bcv-discrepancy', {
        erpRate,
        bcvRate,
        bcvEurRate: bcvEur?.rate ?? null,
        discrepancyPct: Math.round(discrepancyPct * 100) / 100,
      });
    } else {
      log.info('ERP rate aligned with BCV — no discrepancy');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'BCV rate check failed');
  }
}

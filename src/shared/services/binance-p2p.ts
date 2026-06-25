import axios from 'axios';
import { createLogger } from '../logger.js';

const log = createLogger('binance-p2p');

// ---------------------------------------------------------------------------
// Binance P2P API — USDT rates from P2P ads
// ---------------------------------------------------------------------------

const BINANCE_P2P_URL =
  'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

const REQUEST_TIMEOUT_MS = 10_000;

export type FiatCurrency = 'COP' | 'VES';

export interface P2PAd {
  price: number;
  available: number;
  merchant: string;
  finishRate: number;
  positiveRate: number;
  paymentMethods: string[];
}

export interface UsdtRateResult {
  median: number;
  lowest: number;
  highest: number;
  spread: number;
  adsCount: number;
  ads: P2PAd[];
  timestamp: string;
}

export interface P2PRateSet {
  cop: { buy: UsdtRateResult | null; sell: UsdtRateResult | null };
  ves: { buy: UsdtRateResult | null; sell: UsdtRateResult | null };
  timestamp: string;
}

/**
 * Fetch current USDT rate from Binance P2P for a given fiat currency.
 * Returns median, min, max from the top 15 ads.
 *
 * @param transAmount  Optional USDT amount to filter ads by availability
 * @param tradeType    BUY = people buying USDT (paying fiat), SELL = people selling USDT (receiving fiat). Default: SELL
 * @param fiat         Fiat currency to query. Default: COP
 */
export async function getUsdtRate(
  transAmount?: number,
  tradeType: 'BUY' | 'SELL' = 'SELL',
  fiat: FiatCurrency = 'COP',
): Promise<UsdtRateResult> {
  const payload = {
    fiat,
    asset: 'USDT',
    merchantCheck: false,
    page: 1,
    rows: 15,
    tradeType,
    transAmount: transAmount ?? null,
  };

  const { data } = await axios.post(BINANCE_P2P_URL, payload, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (data.code !== '000000' || !data.success) {
    throw new Error(`Binance P2P API error: ${data.message ?? 'unknown'}`);
  }

  const ads: P2PAd[] = (data.data ?? []).map(
    (item: Record<string, any>) => ({
      price: Number(item.adv.price),
      available: Number(item.adv.surplusAmount),
      merchant: item.advertiser.nickName ?? 'N/A',
      finishRate: Number(item.advertiser.monthFinishRate ?? 0),
      positiveRate: Number(item.advertiser.positiveRate ?? 0),
      paymentMethods: (item.adv.tradeMethods ?? []).map(
        (m: Record<string, any>) => m.tradeMethodName,
      ),
    }),
  );

  if (ads.length === 0) {
    throw new Error(`Binance P2P returned 0 ads for USDT/${fiat} ${tradeType}`);
  }

  const prices = ads.map((a) => a.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];

  log.info(
    { fiat, tradeType, median, lowest: prices[0], highest: prices[prices.length - 1], adsCount: ads.length },
    `USDT/${fiat} ${tradeType} rate fetched`,
  );

  return {
    median,
    lowest: prices[0],
    highest: prices[prices.length - 1],
    spread: prices[prices.length - 1] - prices[0],
    adsCount: ads.length,
    ads,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch all 4 P2P rate combinations (COP BUY/SELL, VES BUY/SELL) in parallel.
 * Uses Promise.allSettled — individual failures return null instead of crashing.
 */
export async function getP2PRates(): Promise<P2PRateSet> {
  const [copBuy, copSell, vesBuy, vesSell] = await Promise.allSettled([
    getUsdtRate(undefined, 'BUY', 'COP'),
    getUsdtRate(undefined, 'SELL', 'COP'),
    getUsdtRate(undefined, 'BUY', 'VES'),
    getUsdtRate(undefined, 'SELL', 'VES'),
  ]);

  return {
    cop: {
      buy: copBuy.status === 'fulfilled' ? copBuy.value : null,
      sell: copSell.status === 'fulfilled' ? copSell.value : null,
    },
    ves: {
      buy: vesBuy.status === 'fulfilled' ? vesBuy.value : null,
      sell: vesSell.status === 'fulfilled' ? vesSell.value : null,
    },
    timestamp: new Date().toISOString(),
  };
}

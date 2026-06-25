import type { DailySalesPoint, ExchangeRateHistoryItem, CustomerActivity } from '../../shared/types/index.js';

// ---------------------------------------------------------------------------
// Rate ↔ Sales correlation (Pearson)
// ---------------------------------------------------------------------------

export interface RateSalesCorrelation {
  /** Pearson r coefficient (-1 to 1). */
  coefficient: number;
  /** Human-readable interpretation. */
  interpretation: string;
  /** Number of data points used. */
  dataPoints: number;
  /** Quantified impact: avg sales change per 1% rate change. */
  salesChangePerRatePct: number | null;
}

/**
 * Compute Pearson correlation between daily exchange rates and daily sales.
 * Matches by date — only days present in both datasets are used.
 */
export function computeRateSalesCorrelation(
  dailySales: DailySalesPoint[],
  rateHistory: ExchangeRateHistoryItem[],
): RateSalesCorrelation {
  // Build a date→rate map (use the latest rate per date)
  const rateByDate = new Map<string, number>();
  for (const r of rateHistory) {
    const date = r.effective_date.slice(0, 10);
    rateByDate.set(date, r.rate);
  }

  // Match dates
  const pairs: { rate: number; sales: number }[] = [];
  for (const day of dailySales) {
    const rate = rateByDate.get(day.date);
    if (rate != null) {
      pairs.push({ rate, sales: day.total_usd });
    }
  }

  if (pairs.length < 3) {
    return {
      coefficient: 0,
      interpretation: 'Datos insuficientes para calcular correlación (mínimo 3 días con datos cruzados).',
      dataPoints: pairs.length,
      salesChangePerRatePct: null,
    };
  }

  // Pearson r
  const n = pairs.length;
  const sumX = pairs.reduce((s, p) => s + p.rate, 0);
  const sumY = pairs.reduce((s, p) => s + p.sales, 0);
  const sumXY = pairs.reduce((s, p) => s + p.rate * p.sales, 0);
  const sumX2 = pairs.reduce((s, p) => s + p.rate * p.rate, 0);
  const sumY2 = pairs.reduce((s, p) => s + p.sales * p.sales, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominatorSq = (n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2);

  // Guard: if denominator² is zero or negative (floating point), correlation is undefined
  if (denominatorSq <= 0) {
    return {
      coefficient: 0,
      interpretation: 'Sin variación en tasas o ventas durante el período — no se puede calcular correlación.',
      dataPoints: n,
      salesChangePerRatePct: null,
    };
  }

  const denominator = Math.sqrt(denominatorSq);
  const r = numerator / denominator;

  // Guard: NaN/Infinity from floating point edge cases
  if (!Number.isFinite(r)) {
    return {
      coefficient: 0,
      interpretation: 'Error numérico al calcular correlación — datos insuficientes o sin variación.',
      dataPoints: n,
      salesChangePerRatePct: null,
    };
  }

  // Sales change per 1% rate change (simple linear regression slope, normalized)
  const avgRate = sumX / n;
  const slopeDiv = n * sumX2 - sumX ** 2;
  const slope = slopeDiv === 0 ? 0 : numerator / slopeDiv;
  const salesChangePerRatePct = avgRate !== 0 ? slope * (avgRate * 0.01) : null;

  // Interpret
  const absR = Math.abs(r);
  let interpretation: string;

  // Warn about low sample size
  const lowSample = n < 10;
  const caveat = lowSample ? ' (pocos datos — interpretar con cautela)' : '';

  if (absR < 0.2) {
    interpretation = `No hay correlación significativa entre tasa y ventas en este período${caveat}.`;
  } else if (absR < 0.5) {
    const dir = r > 0 ? 'positiva' : 'negativa';
    interpretation = `Correlación ${dir} débil (r=${r.toFixed(2)})${caveat}. La tasa tiene influencia leve en ventas.`;
  } else if (absR < 0.7) {
    const dir = r > 0 ? 'positiva' : 'negativa';
    interpretation = `Correlación ${dir} moderada (r=${r.toFixed(2)})${caveat}. La tasa influye en el volumen de ventas.`;
  } else {
    const dir = r > 0 ? 'positiva' : 'negativa';
    interpretation = `Correlación ${dir} fuerte (r=${r.toFixed(2)})${caveat}. Los movimientos de tasa impactan directamente las ventas.`;
  }

  if (salesChangePerRatePct != null && Number.isFinite(salesChangePerRatePct) && absR >= 0.2) {
    const sign = salesChangePerRatePct >= 0 ? '+' : '';
    interpretation += ` Por cada 1% de cambio en la tasa, las ventas varían ~${sign}$${salesChangePerRatePct.toFixed(0)}/día.`;
  }

  return {
    coefficient: Math.round(r * 1000) / 1000,
    interpretation,
    dataPoints: n,
    salesChangePerRatePct: salesChangePerRatePct != null && Number.isFinite(salesChangePerRatePct)
      ? Math.round(salesChangePerRatePct * 100) / 100
      : null,
  };
}

// ---------------------------------------------------------------------------
// Weekly seasonality
// ---------------------------------------------------------------------------

export interface WeeklySeasonality {
  /** Average sales per day of week (0=Sunday, 6=Saturday). */
  byDayOfWeek: Array<{
    day: number;
    dayName: string;
    avgSalesUSD: number;
    avgSaleCount: number;
    dataPoints: number;
  }>;
  /** Best day(s) of the week. */
  peakDay: string;
  /** Worst day(s) of the week. */
  valleyDay: string;
  /** Ratio between peak and valley average sales. */
  peakToValleyRatio: number;
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Compute weekly seasonality from daily sales data.
 * Groups by day of week and calculates averages.
 */
export function computeWeeklySeasonality(
  dailySales: DailySalesPoint[],
): WeeklySeasonality {
  const buckets: Array<{ totalUSD: number; totalCount: number; n: number }> = Array.from(
    { length: 7 },
    () => ({ totalUSD: 0, totalCount: 0, n: 0 }),
  );

  for (const day of dailySales) {
    const dow = new Date(day.date + 'T12:00:00Z').getUTCDay();
    buckets[dow].totalUSD += day.total_usd;
    buckets[dow].totalCount += day.sale_count;
    buckets[dow].n++;
  }

  const byDayOfWeek = buckets.map((b, i) => ({
    day: i,
    dayName: DAY_NAMES[i],
    avgSalesUSD: b.n > 0 ? Math.round((b.totalUSD / b.n) * 100) / 100 : 0,
    avgSaleCount: b.n > 0 ? Math.round((b.totalCount / b.n) * 10) / 10 : 0,
    dataPoints: b.n,
  }));

  // Only consider days with data
  const withData = byDayOfWeek.filter((d) => d.dataPoints > 0);

  if (withData.length === 0) {
    return {
      byDayOfWeek,
      peakDay: 'N/A',
      valleyDay: 'N/A',
      peakToValleyRatio: 1,
    };
  }

  const maxAvg = Math.max(...withData.map((d) => d.avgSalesUSD));
  const minAvg = Math.min(...withData.map((d) => d.avgSalesUSD));

  const peakDay = withData.find((d) => d.avgSalesUSD === maxAvg)!.dayName;
  const valleyDay = withData.find((d) => d.avgSalesUSD === minAvg)!.dayName;

  return {
    byDayOfWeek,
    peakDay,
    valleyDay,
    peakToValleyRatio: minAvg > 0 ? Math.round((maxAvg / minAvg) * 100) / 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Customer profitability
// ---------------------------------------------------------------------------

export interface CustomerProfitability {
  customerId: number;
  customerName: string;
  totalRevenue: number;
  estimatedMargin: number;
  purchaseCount: number;
  avgOrderValue: number;
  /** "high" | "medium" | "low" based on revenue + frequency. */
  valueTier: 'high' | 'medium' | 'low';
}

export interface CustomerProfitabilityResult {
  customers: CustomerProfitability[];
  totalRevenueAllCustomers: number;
  /** Top 20% customers' share of total revenue. */
  top20PctRevenueShare: number;
}

/**
 * Compute customer profitability from activity data and margin info.
 *
 * @param customers - Customer activity records
 * @param globalMarginPct - Overall gross margin % from SalesStats (used as estimate per customer)
 */
export function computeCustomerProfitability(
  customers: CustomerActivity[],
  globalMarginPct: number,
): CustomerProfitabilityResult {
  const marginFactor = (globalMarginPct ?? 0) / 100;

  const ranked: CustomerProfitability[] = customers
    .map((c) => ({
      customerId: c.customer_id,
      customerName: c.customer_name,
      totalRevenue: c.total_spent_usd,
      estimatedMargin: Math.round(c.total_spent_usd * marginFactor * 100) / 100,
      purchaseCount: c.total_purchases,
      avgOrderValue: c.total_purchases > 0 ? Math.round((c.total_spent_usd / c.total_purchases) * 100) / 100 : 0,
      valueTier: 'medium' as const,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Assign tiers: top 20% = high, bottom 20% = low, rest = medium
  const highCut = Math.max(1, Math.ceil(ranked.length * 0.2));
  const lowCut = Math.max(1, Math.ceil(ranked.length * 0.2));

  for (let i = 0; i < ranked.length; i++) {
    if (i < highCut) ranked[i].valueTier = 'high';
    else if (i >= ranked.length - lowCut) ranked[i].valueTier = 'low';
  }

  const totalRevenue = ranked.reduce((s, c) => s + c.totalRevenue, 0);
  const top20Revenue = ranked.slice(0, highCut).reduce((s, c) => s + c.totalRevenue, 0);

  return {
    customers: ranked,
    totalRevenueAllCustomers: Math.round(totalRevenue * 100) / 100,
    top20PctRevenueShare: totalRevenue > 0 ? Math.round((top20Revenue / totalRevenue) * 1000) / 10 : 0,
  };
}

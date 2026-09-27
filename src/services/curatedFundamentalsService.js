/**
 * Scanner v9 Curated Sector Fundamentals Service
 * Provides sector-specific metric growth compared against the immediately preceding window of same length.
 * Anti-lookahead: metrics published after snapshot date cannot be used.
 */

import fundamentalsData from '../data/curatedFundamentals.json' with { type: 'json' };

const METRICS_MAP = new Map();
for (const entry of fundamentalsData.metrics || []) {
  if (entry.symbol) {
    METRICS_MAP.set(entry.symbol.toUpperCase(), entry);
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const WINDOW_MAX_STALE_MS = {
  '24h': 1 * MS_PER_DAY,
  '7d': 7 * MS_PER_DAY,
  '30d': 30 * MS_PER_DAY,
};

/**
 * Get curated fundamentals for an asset as of a specific date and window.
 * @param {string} symbol
 * @param {string|Date} asOf
 * @param {string} windowKey ('24h' | '7d' | '30d')
 * @returns {object|null}
 */
export function getCuratedFundamentalsForDate(symbol, asOf = new Date(), windowKey = '7d') {
  if (!symbol) return null;
  const entry = METRICS_MAP.get(symbol.toUpperCase());
  if (!entry) return null;

  const asOfTime = new Date(asOf).getTime();

  // Validate anti-lookahead on publishedAt
  const m1Pub = entry.metric1?.publishedAt ? new Date(entry.metric1.publishedAt).getTime() : 0;
  const m2Pub = entry.metric2?.publishedAt ? new Date(entry.metric2.publishedAt).getTime() : 0;

  if (Number.isFinite(asOfTime)) {
    if (m1Pub > asOfTime || m2Pub > asOfTime) {
      return {
        symbol: entry.symbol,
        sector: entry.sector,
        isLookaheadViolation: true,
        reason: 'published_after_snapshot_date',
        metric1: null,
        metric2: null,
      };
    }
    
    // Measurement window matching: static curated data published on date X only covers measurement period ending on date X
    // If the snapshot date differs from publishedAt by more than 1 day, the measurement period does not match
    if (Math.abs(asOfTime - m1Pub) > MS_PER_DAY || Math.abs(asOfTime - m2Pub) > MS_PER_DAY) {
      return {
        symbol: entry.symbol,
        sector: entry.sector,
        isLookaheadViolation: false,
        reason: `unmatched_measurement_period_for_${windowKey}`,
        metric1: null,
        metric2: null,
      };
    }
  }

  return {
    symbol: entry.symbol,
    sector: entry.sector,
    isLookaheadViolation: false,
    metric1: entry.metric1,
    metric2: entry.metric2,
  };
}

/**
 * Compute growth rate between current window value and prior window value.
 * growth = (current - prior) / prior
 */
export function computeMetricGrowth(current, prior) {
  if (current == null || prior == null) return null;
  const cur = Number(current);
  const prev = Number(prior);
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return (cur - prev) / prev;
}

/**
 * Extract growth for metric 1 and metric 2 for a specific window ('24h', '7d', '30d').
 */
export function getSectorMetricsGrowthForWindow(symbol, windowKey = '7d', asOf = new Date(), liveAdapterOverrides = null) {
  const asOfTime = new Date(asOf).getTime();
  const days = windowKey === '24h' ? 1 : windowKey === '30d' ? 30 : 7;
  const measurementStart = new Date(asOfTime - (days * MS_PER_DAY)).toISOString();
  const measurementEnd = new Date(asOfTime).toISOString();

  // 1. Fetch static curated data for this date
  const curatedData = getCuratedFundamentalsForDate(symbol, asOf, windowKey);
  const live = liveAdapterOverrides?.[symbol]?.[windowKey] || null;

  // If lookahead violation on curated data and no live override
  if (curatedData?.isLookaheadViolation && !live) {
    return {
      metric1Growth: null,
      metric2Growth: null,
      metric1Name: null,
      metric2Name: null,
      metric1Unit: null,
      metric2Unit: null,
      measurementPeriod: {
        window: windowKey,
        measurementStart,
        measurementEnd,
        publishedAt: curatedData?.metric1?.publishedAt || null,
        status: 'published_after_snapshot_date',
      },
      reason: 'published_after_snapshot_date',
    };
  }

  // Extract metric1 and metric2 from curated data if available
  let cur1 = null, prev1 = null, cur2 = null, prev2 = null;
  let g1 = null, g2 = null;
  let name1 = null, name2 = null;
  let unit1 = null, unit2 = null;
  let sourceUrl1 = null, sourceUrl2 = null;
  let pub1 = null, pub2 = null;

  if (curatedData && !curatedData.isLookaheadViolation) {
    if (curatedData.metric1) {
      name1 = curatedData.metric1.name;
      unit1 = curatedData.metric1.unit;
      sourceUrl1 = curatedData.metric1.sourceUrl;
      pub1 = curatedData.metric1.publishedAt;
      if (windowKey === '24h') {
        cur1 = curatedData.metric1.current24h;
        prev1 = curatedData.metric1.prior24h;
      } else if (windowKey === '30d') {
        cur1 = curatedData.metric1.current30d;
        prev1 = curatedData.metric1.prior30d;
      } else {
        cur1 = curatedData.metric1.current7d;
        prev1 = curatedData.metric1.prior7d;
      }
      g1 = computeMetricGrowth(cur1, prev1);
    }

    if (curatedData.metric2) {
      name2 = curatedData.metric2.name;
      unit2 = curatedData.metric2.unit;
      sourceUrl2 = curatedData.metric2.sourceUrl;
      pub2 = curatedData.metric2.publishedAt;
      if (windowKey === '24h') {
        cur2 = curatedData.metric2.current24h;
        prev2 = curatedData.metric2.prior24h;
      } else if (windowKey === '30d') {
        cur2 = curatedData.metric2.current30d;
        prev2 = curatedData.metric2.prior30d;
      } else {
        cur2 = curatedData.metric2.current7d;
        prev2 = curatedData.metric2.prior7d;
      }
      g2 = computeMetricGrowth(cur2, prev2);
    }
  }

  // 2. Merge / override with live adapter data per-metric
  if (live) {
    // Check metric1 from live
    const hasLiveM1 = live.metric1Growth !== undefined && live.metric1Growth !== null;
    const hasLiveM1Values = live.metric1Value !== undefined && live.metric1Prior !== undefined;
    if (hasLiveM1 || hasLiveM1Values) {
      const liveM1Pub = live.publishedAt ? new Date(live.publishedAt).getTime() : 0;
      // Anti-lookahead check on live data
      if (!Number.isFinite(asOfTime) || liveM1Pub <= asOfTime + MS_PER_DAY) {
        cur1 = live.metric1Value ?? cur1;
        prev1 = live.metric1Prior ?? prev1;
        g1 = hasLiveM1 ? Number(live.metric1Growth) : computeMetricGrowth(cur1, prev1);
        name1 = live.metric1Name ?? name1 ?? 'metric_1';
        unit1 = live.metric1Unit ?? unit1 ?? 'unit';
        sourceUrl1 = live.sourceUrl1 ?? sourceUrl1;
        pub1 = live.publishedAt ?? pub1;
      }
    }

    // Check metric2 from live
    const hasLiveM2 = live.metric2Growth !== undefined && live.metric2Growth !== null;
    const hasLiveM2Values = live.metric2Value !== undefined && live.metric2Prior !== undefined;
    if (hasLiveM2 || hasLiveM2Values) {
      const liveM2Pub = live.publishedAt ? new Date(live.publishedAt).getTime() : 0;
      // Anti-lookahead check on live data
      if (!Number.isFinite(asOfTime) || liveM2Pub <= asOfTime + MS_PER_DAY) {
        cur2 = live.metric2Value ?? cur2;
        prev2 = live.metric2Prior ?? prev2;
        g2 = hasLiveM2 ? Number(live.metric2Growth) : computeMetricGrowth(cur2, prev2);
        name2 = live.metric2Name ?? name2 ?? 'network_fees';
        unit2 = live.metric2Unit ?? unit2 ?? 'USD';
        sourceUrl2 = live.sourceUrl2 ?? sourceUrl2;
        pub2 = live.publishedAt ?? pub2;
      }
    }
  }

  const isValidBoth = Number.isFinite(g1) && Number.isFinite(g2);
  let status = 'valid';
  let reason = 'valid';

  if (!isValidBoth) {
    if (g1 === null && g2 === null) {
      status = curatedData?.reason || 'no_fundamentals_data';
      reason = curatedData?.reason || 'no_fundamentals_data';
    } else if (g1 === null) {
      status = 'missing_metric_1';
      reason = 'missing_metric_1';
    } else {
      status = 'missing_metric_2';
      reason = 'missing_metric_2';
    }
  }

  const publishedAt = pub2 || pub1 || curatedData?.metric1?.publishedAt || null;

  return {
    metric1Growth: g1,
    metric2Growth: g2,
    metric1Name: name1,
    metric2Name: name2,
    metric1Unit: unit1,
    metric2Unit: unit2,
    metric1Value: cur1,
    metric2Value: cur2,
    metric1Prior: prev1,
    metric2Prior: prev2,
    measurementPeriod: {
      window: windowKey,
      measurementStart,
      measurementEnd,
      publishedAt,
      status,
    },
    sourceUrl1,
    sourceUrl2,
    reason,
  };
}

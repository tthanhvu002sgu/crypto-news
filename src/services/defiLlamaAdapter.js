/**
 * DefiLlama Live Source Adapter
 * Fetches protocol TVL, fees, and revenue data directly from DefiLlama public APIs.
 * Supports memory caching, graceful timeout, and windowed metric extraction.
 */

import axios from 'axios';

const DEFILLAMA_API_BASE = 'https://api.llama.fi';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const LLAMA_CACHE = new Map();

/**
 * Fetch protocol overview from DefiLlama with timeout and caching.
 */
export async function fetchDefiLlamaProtocol(slug, timeoutMs = 8000) {
  if (!slug) return null;
  const normalizedSlug = slug.toLowerCase().trim();

  // Check cache
  if (LLAMA_CACHE.has(normalizedSlug)) {
    const cached = LLAMA_CACHE.get(normalizedSlug);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  try {
    const resp = await axios.get(`${DEFILLAMA_API_BASE}/protocol/${normalizedSlug}`, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'CryptoNewsScanner/9.0' },
    });

    if (resp.data && (resp.data.tvl !== undefined || resp.data.currentChainTvls)) {
      const entry = { data: resp.data, timestamp: Date.now() };
      LLAMA_CACHE.set(normalizedSlug, entry);
      return resp.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch protocol fees and revenue from DefiLlama overview.
 */
export async function fetchDefiLlamaFees(slug, timeoutMs = 8000) {
  if (!slug) return null;
  const cacheKey = `fees:${slug.toLowerCase().trim()}`;

  if (LLAMA_CACHE.has(cacheKey)) {
    const cached = LLAMA_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  try {
    const resp = await axios.get(`${DEFILLAMA_API_BASE}/summary/fees/${slug}`, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'CryptoNewsScanner/9.0' },
    });

    if (resp.data && (resp.data.total24h !== undefined || resp.data.total7d !== undefined)) {
      const entry = { data: resp.data, timestamp: Date.now() };
      LLAMA_CACHE.set(cacheKey, entry);
      return resp.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Probe DefiLlama API health.
 */
export async function probeDefiLlamaStatus() {
  try {
    const resp = await axios.get(`${DEFILLAMA_API_BASE}/protocols`, {
      timeout: 5000,
      headers: { 'User-Agent': 'CryptoNewsScanner/9.0' },
    });
    return Array.isArray(resp.data) && resp.data.length > 0 ? 'OK' : 'DEGRADED';
  } catch {
    return 'OFFLINE';
  }
}

/**
 * Extract historical fees metric from DefiLlama chart data for a specified window and asOf.
 */
export function extractHistoricalFeesWindow(feesData, windowKey = '7d', asOfTime = Date.now()) {
  if (!feesData) return null;

  const days = windowKey === '24h' ? 1 : windowKey === '30d' ? 30 : 7;
  const asOfSec = Math.floor(asOfTime / 1000);
  const daySec = 86400;

  let chart = feesData.totalDataChart || feesData.chart || feesData.dailyFees;
  if (Array.isArray(chart) && chart.length > 0) {
    const points = [];
    for (const item of chart) {
      let t = null;
      let v = null;
      if (Array.isArray(item)) {
        t = Number(item[0]);
        v = Number(item[1]);
      } else if (item && typeof item === 'object') {
        t = Number(item.date || item.timestamp || item.time);
        v = Number(item.dailyFees || item.dailyFee || item.fees || item.value || item.totalLiquidityUSD);
      }
      if (t > 1e11) t = Math.floor(t / 1000);

      if (Number.isFinite(t) && Number.isFinite(v) && v >= 0) {
        points.push({ timestamp: t, value: v });
      }
    }

    if (points.length > 0) {
      points.sort((a, b) => a.timestamp - b.timestamp);

      const currentEndSec = asOfSec;
      const currentStartSec = asOfSec - (days * daySec);
      const priorStartSec = asOfSec - (2 * days * daySec);

      // Current window: (currentStartSec, currentEndSec]
      // Prior window: (priorStartSec, currentStartSec]
      const currentPoints = points.filter(p => p.timestamp > currentStartSec && p.timestamp <= currentEndSec);
      const priorPoints = points.filter(p => p.timestamp > priorStartSec && p.timestamp <= currentStartSec);

      const minRequiredPoints = days === 1 ? 1 : Math.max(1, Math.floor(days * 0.7));
      if (currentPoints.length >= minRequiredPoints && priorPoints.length >= minRequiredPoints) {
        const curVal = currentPoints.reduce((sum, p) => sum + p.value, 0);
        const priorVal = priorPoints.reduce((sum, p) => sum + p.value, 0);

        if (priorVal > 0 && curVal >= 0) {
          const growthRate = (curVal - priorVal) / priorVal;
          const maxPointTime = Math.max(...currentPoints.map(p => p.timestamp));
          return {
            currentValue: curVal,
            priorValue: priorVal,
            growthRate,
            publishedAt: new Date(maxPointTime * 1000).toISOString(),
          };
        }
      }
    }
  }

  return null;
}

/**
 * Fetch and calculate sector growth metrics from DefiLlama for an asset.
 * Extracts window values (24h / 7d / 30d) and computes exact growth vs immediately preceding period.
 * For past dates, extracts strictly from historical chart; returns null if no historical data.
 * Preserves true source publication timestamp without substituting past asOf dates.
 */
export async function fetchLiveDefiLlamaMetrics(slug, windowKey = '7d', asOfMidnight = new Date()) {
  if (!slug) return null;
  const feesData = await fetchDefiLlamaFees(slug);
  if (!feesData) return null;

  const asOfTime = new Date(asOfMidnight).getTime();
  if (!Number.isFinite(asOfTime)) return null;

  // 1. Try extracting historical window from chart data
  const historical = extractHistoricalFeesWindow(feesData, windowKey, asOfTime);
  if (historical) {
    return {
      metricName: 'network_fees',
      metricUnit: 'USD',
      currentValue: historical.currentValue,
      priorValue: historical.priorValue,
      growthRate: historical.growthRate,
      sourceUrl: `https://defillama.com/fees/${slug}`,
      publishedAt: historical.publishedAt,
      isValid: true,
    };
  }

  // 2. If no historical chart coverage, only use live summary if asOf is current (within 1 day of now)
  const isCurrentDate = Math.abs(Date.now() - asOfTime) <= 24 * 60 * 60 * 1000;
  if (isCurrentDate) {
    let curVal = null;
    let changePct = null;
    if (windowKey === '24h') {
      curVal = Number(feesData.total24h);
      changePct = Number(feesData.change_1d);
    } else if (windowKey === '7d') {
      curVal = Number(feesData.total7d);
      changePct = Number(feesData.change_7d);
    } else if (windowKey === '30d') {
      curVal = Number(feesData.total30d);
      changePct = Number(feesData.change_30d);
    }

    if (Number.isFinite(curVal) && curVal > 0 && Number.isFinite(changePct)) {
      const growth = changePct / 100;
      const priorVal = curVal / (1 + growth);
      const sourceTime = feesData.latestTimestamp
        ? new Date(feesData.latestTimestamp * 1000).toISOString()
        : (feesData.timestamp ? new Date(feesData.timestamp * 1000).toISOString() : new Date().toISOString());

      return {
        metricName: 'network_fees',
        metricUnit: 'USD',
        currentValue: curVal,
        priorValue: priorVal,
        growthRate: growth,
        sourceUrl: `https://defillama.com/fees/${slug}`,
        publishedAt: sourceTime,
        isValid: true,
      };
    }
  }

  // Past date without historical chart data: return null
  return null;
}

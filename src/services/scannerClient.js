/**
 * Scanner v9 Frontend Client Service
 * Manages manifest loading, snapshot fetching, client caching, delta calculation, and CSV/JSON export.
 */

import axios from 'axios';
import {
  SCANNER_SCHEMA_VERSION,
  SCANNER_MODEL_VERSION,
  MANIFEST_STORAGE_KEY,
  SNAPSHOT_CACHE_KEY_PREFIX,
  SNAPSHOT_CACHE_TTL,
  STALE_SNAPSHOT_THRESHOLD_HOURS,
  DATA_BRANCH,
  GITHUB_RAW_BASE,
  DEFAULT_WINDOW,
} from './scannerConfig.js';
import {
  calculateTrackingDeltas,
} from './scannerCalculations.js';

const IN_MEMORY_SNAPSHOT_CACHE = new Map();

/**
 * Check if a snapshot is older than 36 hours.
 */
export function isSnapshotStale(asOfIso, now = new Date()) {
  if (!asOfIso) return true;
  const asOfTime = new Date(asOfIso).getTime();
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(asOfTime)) return true;
  const ageHours = (nowTime - asOfTime) / (1000 * 60 * 60);
  return ageHours > STALE_SNAPSHOT_THRESHOLD_HOURS;
}

/**
 * Load scanner manifest from server/cache.
 */
/**
 * Load scanner manifest from server/cache.
 */
export async function loadScannerManifest(forceRefresh = false) {
  const cacheBuster = forceRefresh ? `?t=${Date.now()}` : '';
  const sourceCandidates = [
    { base: `${GITHUB_RAW_BASE}/${DATA_BRANCH}`, url: `${GITHUB_RAW_BASE}/${DATA_BRANCH}/data/manifest.json${cacheBuster}` },
    { base: '.', url: `./data/manifest.json${cacheBuster}` },
    { base: '', url: `/data/manifest.json${cacheBuster}` },
  ];

  for (const cand of sourceCandidates) {
    try {
      const resp = await axios.get(cand.url, { timeout: 6000 });
      if (resp.data && Array.isArray(resp.data.snapshots)) {
        const manifestObj = { ...resp.data, _sourceBase: cand.base };
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(manifestObj));
          } catch {}
        }
        return manifestObj;
      }
    } catch {}
  }

  // Fallback to localStorage only if not force refreshing
  if (!forceRefresh && typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(MANIFEST_STORAGE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}
  }

  // Fallback default manifest
  const today = new Date().toISOString().slice(0, 10);
  return {
    schemaVersion: SCANNER_SCHEMA_VERSION,
    modelVersion: SCANNER_MODEL_VERSION,
    latestDate: today,
    updatedAt: new Date().toISOString(),
    _sourceBase: '.',
    snapshots: [
      {
        date: today,
        file: `${today}.json`,
        revision: 1,
        asOf: new Date(today).toISOString(),
        generatedAt: new Date().toISOString(),
        assetCount: 50,
        completeCount: 38,
        schemaVersion: SCANNER_SCHEMA_VERSION,
        modelVersion: SCANNER_MODEL_VERSION,
      },
    ],
  };
}

/**
 * Load daily snapshot by date string (YYYY-MM-DD), with cache locked by specific file/revision.
 */
export async function loadDailySnapshot(dateStr, manifest = null, forceRefresh = false) {
  if (!dateStr) return null;
  
  let fileName = `${dateStr}.json`;
  if (manifest?.snapshots) {
    const entry = manifest.snapshots.find(s => s.date === dateStr);
    if (entry?.file) {
      fileName = entry.file;
    }
  }

  const cacheKey = `${dateStr}:${fileName}`;
  const storageKey = `${SNAPSHOT_CACHE_KEY_PREFIX}${cacheKey}`;

  // Check in-memory cache if not force refreshing
  if (!forceRefresh && IN_MEMORY_SNAPSHOT_CACHE.has(cacheKey)) {
    const cached = IN_MEMORY_SNAPSHOT_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < SNAPSHOT_CACHE_TTL) {
      return cached.data;
    }
  }

  // Check localStorage cache if not force refreshing
  if (!forceRefresh && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.timestamp && (Date.now() - parsed.timestamp < SNAPSHOT_CACHE_TTL) && parsed?.data) {
          IN_MEMORY_SNAPSHOT_CACHE.set(cacheKey, parsed);
          return parsed.data;
        }
      }
    } catch {}
  }

  const cacheBuster = forceRefresh ? `?t=${Date.now()}` : '';
  const prioritizedBases = [];
  if (manifest?._sourceBase) {
    prioritizedBases.push(manifest._sourceBase);
  }
  prioritizedBases.push(`${GITHUB_RAW_BASE}/${DATA_BRANCH}`);
  prioritizedBases.push('.');
  prioritizedBases.push('');

  const urls = [];
  const seenUrls = new Set();
  for (const base of prioritizedBases) {
    const full = base ? `${base}/data/snapshots/${fileName}${cacheBuster}` : `./data/snapshots/${fileName}${cacheBuster}`;
    if (!seenUrls.has(full)) {
      seenUrls.add(full);
      urls.push(full);
    }
  }

  for (const url of urls) {
    try {
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.data && Array.isArray(resp.data.assets)) {
        const cacheEntry = { data: resp.data, timestamp: Date.now() };
        IN_MEMORY_SNAPSHOT_CACHE.set(cacheKey, cacheEntry);

        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(storageKey, JSON.stringify(cacheEntry));
          } catch {}
        }

        return resp.data;
      }
    } catch {}
  }

  return null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Find exact prior snapshot dates for 1d, 7d, and 30d from manifest.
 */
export function findPriorSnapshotDates(manifest, currentDateStr) {
  if (!manifest?.snapshots || !currentDateStr) {
    return { date1d: null, date7d: null, date30d: null };
  }

  const curTime = new Date(`${currentDateStr.slice(0, 10)}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(curTime)) {
    return { date1d: null, date7d: null, date30d: null };
  }

  const snapDateSet = new Set(manifest.snapshots.map(s => s.date));

  const getTargetDate = (days) => {
    const targetIso = new Date(curTime - (days * MS_PER_DAY)).toISOString().slice(0, 10);
    return snapDateSet.has(targetIso) ? targetIso : null;
  };

  return {
    date1d: getTargetDate(1),
    date7d: getTargetDate(7),
    date30d: getTargetDate(30),
  };
}

/**
 * Hydrate snapshot assets with tracking deltas vs previous snapshots.
 */
export function hydrateAssetsWithTracking(currentSnapshot, priorSnapshot1d, priorSnapshot7d, priorSnapshot30d, windowKey = DEFAULT_WINDOW) {
  if (!currentSnapshot?.assets) return [];

  const modelVersion = currentSnapshot.modelVersion || SCANNER_MODEL_VERSION;

  return currentSnapshot.assets.map((asset) => {
    const tracking = calculateTrackingDeltas(asset, priorSnapshot1d, priorSnapshot7d, priorSnapshot30d, windowKey, modelVersion);
    return {
      ...asset,
      tracking,
    };
  });
}

/**
 * Export snapshot data to CSV format.
 */
export function exportScannerCsv(snapshot, windowKey = DEFAULT_WINDOW) {
  if (!snapshot || !Array.isArray(snapshot.assets)) return '';

  const headers = [
    'Date',
    'Window',
    'Rank',
    'Symbol',
    'BaseAsset',
    'Name',
    'Sector',
    'Narratives',
    'TotalScore',
    `DeltaScore_${windowKey}`,
    `DeltaRank_${windowKey}`,
    'RS_BTC_Pct',
    'RS_ETH_Pct',
    'SpotCVD_USD',
    'SpotFlowPressure_Pct',
    'FuturesCVD_USD',
    'DeltaOI_Base',
    'DeltaOI_USD',
    'FundingDailyAvg_Pct',
    'FlowLabel',
    'FlowLabelText',
    'QuantSectorScore',
    'RubricScore',
    'WindowVolume_USD',
    'VolStability_30D',
    'IsComplete',
    'MissingPillars',
    'ModelVersion',
    'SchemaVersion',
  ];

  const rows = snapshot.assets.map((asset) => {
    const win = asset.windows?.[windowKey] || {};
    const metrics = win.metrics || {};
    const scores = win.scores || {};
    const comp = win.completeness || {};
    const tracking = asset.tracking || {};
    const diffKey = windowKey === '24h' ? 'diff1d' : `diff${windowKey}`;

    return [
      snapshot.asOf ? snapshot.asOf.slice(0, 10) : '',
      windowKey,
      win.rank ?? '',
      asset.symbol,
      asset.baseAsset,
      `"${(asset.name || '').replace(/"/g, '""')}"`,
      asset.sector || 'Other',
      `"${(asset.narratives || []).join(', ')}"`,
      scores.totalScore != null ? scores.totalScore.toFixed(2) : '',
      tracking[diffKey]?.deltaScore != null ? tracking[diffKey].deltaScore.toFixed(2) : '',
      tracking[diffKey]?.deltaRank != null ? tracking[diffKey].deltaRank : '',
      metrics.rsBtc != null ? metrics.rsBtc.toFixed(2) : '',
      metrics.rsEth != null ? metrics.rsEth.toFixed(2) : '',
      metrics.spotCvd != null ? Math.round(metrics.spotCvd) : '',
      metrics.spotFlowPressure != null ? (metrics.spotFlowPressure * 100).toFixed(2) : '',
      metrics.futuresCvd != null ? Math.round(metrics.futuresCvd) : '',
      metrics.deltaOiBase != null ? Math.round(metrics.deltaOiBase) : '',
      metrics.deltaOiUsd != null ? Math.round(metrics.deltaOiUsd) : '',
      metrics.fundingAvgDaily != null ? (metrics.fundingAvgDaily * 100).toFixed(4) : '',
      metrics.flowLabel || '',
      `"${metrics.flowLabelText || ''}"`,
      scores.quantSectorScore != null ? scores.quantSectorScore.toFixed(2) : '',
      scores.rubricScore != null ? scores.rubricScore.toFixed(2) : '',
      metrics.quoteVolume != null ? Math.round(metrics.quoteVolume) : '',
      asset.liquidity30d?.stability != null ? asset.liquidity30d.stability.toFixed(2) : '',
      comp.isComplete ? 'TRUE' : 'FALSE',
      `"${(comp.missingPillars || []).join(', ')}"`,
      snapshot.modelVersion || SCANNER_MODEL_VERSION,
      snapshot.schemaVersion || SCANNER_SCHEMA_VERSION,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Export snapshot data to JSON format.
 */
export function exportScannerJson(snapshot, windowKey = DEFAULT_WINDOW) {
  if (!snapshot) return '{}';
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    selectedWindow: windowKey,
    schemaVersion: snapshot.schemaVersion,
    modelVersion: snapshot.modelVersion,
    asOf: snapshot.asOf,
    generatedAt: snapshot.generatedAt,
    benchmarks: snapshot.benchmarks,
    summary: snapshot.summary?.[windowKey] || null,
    assets: snapshot.assets,
  }, null, 2);
}

/**
 * Trigger file download in browser.
 */
export function triggerFileDownload(content, filename, contentType = 'text/plain') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

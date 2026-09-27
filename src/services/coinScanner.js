/**
 * Scanner v9 Central Service Facade
 * Provides asset ranking, snapshot loading, tracking, and export capabilities.
 */

export {
  SCANNER_SCHEMA_VERSION,
  SCANNER_MODEL_VERSION,
  SCANNER_VERSION,
  CONFIG_VERSION,
  WINDOWS,
  DEFAULT_WINDOW,
  WINDOW_LABELS,
  WINDOW_TITLES,
  PILLAR_WEIGHTS,
  PILLAR_LABELS,
  FLOW_LABELS,
  FLOW_LABEL_TEXTS,
  FLOW_LABEL_DESCRIPTIONS,
  SECTOR_OPTIONS,
  STATUS_OPTIONS,
  SORT_FIELDS,
  METHODOLOGY_DISCLAIMERS,
} from './scannerConfig.js';

export {
  calculateRelativeStrength,
  calculateCvdAndFlowPressure,
  calculateOiMetrics,
  calculateFundingMetrics,
  classifyFlowInterpretation,
  calculateVolumeStability,
  calculatePercentilesMidrank,
  calculateDerivativesConfirmationScore,
  calculateQuantitativeSectorScores,
  scoreUniverseForWindow,
  calculateSummaryStatistics,
  calculateTrackingDeltas,
} from './scannerCalculations.js';

export {
  isExcludedSymbol,
  getAssetMetadata,
  getAllRegisteredAssets,
} from './assetRegistry.js';

export {
  evaluateRubricForDate,
  getAllRubricEntries,
} from './rubricRegistry.js';

export {
  getCuratedFundamentalsForDate,
  getSectorMetricsGrowthForWindow,
  computeMetricGrowth,
} from './curatedFundamentalsService.js';

export {
  fetchDefiLlamaProtocol,
  fetchDefiLlamaFees,
  probeDefiLlamaStatus,
  extractHistoricalFeesWindow,
  fetchLiveDefiLlamaMetrics,
} from './defiLlamaAdapter.js';

export {
  generateDailySnapshot,
  buildTop50Universe,
  fetchSpotActiveUsdtPairs,
  fetchSpotDailyKlines,
  getUtcMidnightDate,
} from './scannerDataEngine.js';

export {
  loadScannerManifest,
  loadDailySnapshot,
  findPriorSnapshotDates,
  hydrateAssetsWithTracking,
  exportScannerCsv,
  exportScannerJson,
  triggerFileDownload,
  isSnapshotStale,
} from './scannerClient.js';

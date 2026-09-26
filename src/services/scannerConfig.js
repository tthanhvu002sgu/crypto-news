/**
 * Scanner v8: Configuration and Experimental Thresholds
 * Architecture: Strength filter first, Setup confirmation second.
 * All thresholds are versioned experimental parameters.
 */

export const SCANNER_VERSION = 'v8';
export const CONFIG_VERSION = 'v8.0.0';

export const RESULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const UNIVERSE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
export const RESULT_CACHE_KEY = `crypto_scanner_${SCANNER_VERSION}_results`;
export const UNIVERSE_CACHE_KEY = `crypto_scanner_${SCANNER_VERSION}_universe`;

export const EXCLUDED_SYMBOLS = new Set([
  'USDTUSDC', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDCUSDT', 'DAIUSDT',
  'WBTCUSDT', 'WETHUSDT', 'WEETHUSDT', 'WBETHUSDT', 'BTCUSDT', 'ETHUSDT',
]);

export const QUALITY_GATE_THRESHOLDS = {
  minMarketCap: 1_000_000_000, // $1B USD
  maxSpreadPct: 0.15, // 0.15%
  maxVolCV: 1.3,
  minVol30d: 100_000_000, // $100M USD
  minDataCoverage: 0.65,
};

export const STRENGTH_THRESHOLDS = {
  longPercentileMin: 70, // Top 30% strongest in universe
  shortPercentileMax: 30, // Bottom 30% weakest in universe
  rsDurabilityMinBars: 3, // At least 3 of last 4 1H candles must align
  rsDurabilityLookbackBars: 4,
  min4hEmaSlopePct: 0.0, // Long requires positive slope, Short negative
};

export const SETUP_CONFIG = {
  swingPivotLeftBars: 3,
  swingPivotRightBars: 2,
  breakoutLookbackBars: 20, // 20 1H candles
  zoneToleranceAtr: 0.35, // ATR distance allowance for retest / pullback zone
  stopBufferAtr: 0.5, // ATR distance buffer beyond structural swing for invalidation
  maxExtensionAtr: 1.5, // > 1.5 ATR from trigger zone considered EXTENDED
  maxFormingBars: 12, // Maximum 1H bars allowed in forming state before expiring
  minTargetRewardRisk: 2.0, // Minimum R:R ratio for favorable reward
  estimatedFeePct: 0.08, // 0.08% roundtrip fee / slippage allowance
};

export const SETUP_STATES = {
  READY: 'READY',
  FORMING: 'FORMING',
  WATCH: 'WATCH',
  EXTENDED: 'EXTENDED',
  INVALIDATED: 'INVALIDATED',
  EXPIRED: 'EXPIRED',
  DATA_INCOMPLETE: 'DATA_INCOMPLETE',
};

export const SETUP_TYPES = {
  PULLBACK: 'PULLBACK',
  BREAKOUT_RETEST: 'BREAKOUT_RETEST',
  NONE: 'NONE',
};

export const DIRECTIONS = {
  LONG: 'LONG',
  SHORT: 'SHORT',
};

export const HYSTERESIS_CONFIG = {
  entryMinRewardRisk: 2.0,
  entryMaxExtensionAtr: 1.5,
  entryMinStrengthPercentile: 70,
  entryMaxStrengthPercentileShort: 30,

  maintenanceMinRewardRisk: 1.6,
  maintenanceMaxExtensionAtr: 1.8,
  maintenanceMinStrengthPercentile: 63,
  maintenanceMaxStrengthPercentileShort: 37,

  gracePeriodMs: 2 * 60 * 60 * 1000, // 2 hours
};


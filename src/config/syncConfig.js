/**
 * Sync tiers & cache TTLs.
 *
 * HOT  — market microstructure, needs frequent refresh (Binance REST)
 * WARM — semi-live market context (global mcap, news, equities)
 * COLD — slow-moving macro / on-chain / ETF / COT (hours–days)
 *
 * Auto-refresh only *attempts* a tier on its interval; fetchCached still
 * respects per-key TTL so cold data is not re-downloaded every tick.
 */

export const MS = {
  MIN: 60 * 1000,
  HOUR: 60 * 60 * 1000,
};

/** Per-key cache TTL (used by fetchCached). */
export const CACHE_TTL = {
  // HOT — Binance derivatives / spot REST (WS already covers live price)
  binanceTicker: 2 * MS.MIN,
  binanceKlines: 5 * MS.MIN,
  binanceLs: 5 * MS.MIN,
  binanceFunding: 5 * MS.MIN,
  binanceOi: 5 * MS.MIN,
  binanceOiHist: 5 * MS.MIN,

  // WARM
  globalCrypto: 15 * MS.MIN,
  stablecoin: 15 * MS.MIN,
  news: 15 * MS.MIN,
  yield10y: 30 * MS.MIN,
  dxy: 30 * MS.MIN,
  sp500: 30 * MS.MIN,
  vix: 30 * MS.MIN,
  qqq: 30 * MS.MIN,
  cvd24h: 10 * MS.MIN,
  cvd7d: 30 * MS.MIN,

  // COLD
  macroFred: 12 * MS.HOUR,
  onChain: 6 * MS.HOUR,
  etf: 4 * MS.HOUR,
  cot: 12 * MS.HOUR,
  fng: 4 * MS.HOUR,
  cvd30d: 2 * MS.HOUR,
  dailyKlines: 2 * MS.HOUR,
};

/** How often each tier is *scheduled* (not how often network runs). */
export const SYNC_INTERVAL = {
  hot: 5 * MS.MIN,
  warm: 15 * MS.MIN,
  cold: 60 * MS.MIN,
  dailyCheck: 60 * 1000, // poll clock for 08:00 force sync
};

export const SYNC_LABELS = {
  hot: 'HOT (Binance REST)',
  warm: 'WARM (market context)',
  cold: 'COLD (macro / on-chain / ETF)',
};

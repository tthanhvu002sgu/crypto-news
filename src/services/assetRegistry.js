/**
 * Scanner v9 Asset Registry Service
 * Maps Binance Spot pairs to identifiers across CoinGecko, DefiLlama, sectors, and narratives.
 * Never joins data sources solely by ticker!
 */

import registryData from '../data/registry.json' with { type: 'json' };

export const EXCLUDED_SYMBOLS = new Set(registryData.excludedSymbols || []);

export const SECTORS = {
  L1: 'L1',
  L2: 'L2',
  DeFi: 'DeFi',
  DePIN: 'DePIN',
  AI: 'AI',
  RWA: 'RWA',
  Meme: 'Meme',
  Infra: 'Infra',
  Payments: 'Payments',
  Other: 'Other',
};

const ASSETS_MAP = new Map();
const BASE_ASSET_MAP = new Map();

for (const asset of registryData.assets) {
  if (asset.symbol) {
    ASSETS_MAP.set(asset.symbol.toUpperCase(), asset);
  }
  if (asset.baseAsset) {
    BASE_ASSET_MAP.set(asset.baseAsset.toUpperCase(), asset);
  }
}

/**
 * Checks if a Binance symbol is an excluded asset (BTC, ETH, Stablecoin, Leveraged token, Wrapped duplicate).
 */
export function isExcludedSymbol(symbol) {
  if (!symbol) return true;
  const sym = symbol.toUpperCase();
  if (EXCLUDED_SYMBOLS.has(sym)) return true;

  // Leveraged tokens (UP, DOWN, BULL, BEAR, 3L, 3S)
  if (/(UP|DOWN|BULL|BEAR|[2-5][LS])USDT$/.test(sym)) {
    return true;
  }

  // Stablecoins patterns
  if (/^(USDT|USDC|BUSD|TUSD|FDUSD|DAI|USDE|USDS|EUR|PAX|GUSD|UST|USD1|RLUSD)/.test(sym) && sym.endsWith('USDT')) {
    if (sym !== 'USDTUSDT') return true;
  }

  // Wrapped tokens
  if (/^(WBTC|WETH|WEETH|WBETH|WSOL|WAVAX|WBNB)/.test(sym)) {
    return true;
  }

  return false;
}

/**
 * Get registered asset metadata by Binance symbol.
 */
export function getAssetMetadata(symbol) {
  if (!symbol) return null;
  const sym = symbol.toUpperCase();
  if (ASSETS_MAP.has(sym)) {
    return ASSETS_MAP.get(sym);
  }

  // Infer base asset if symbol ends with USDT
  if (sym.endsWith('USDT')) {
    const base = sym.replace(/USDT$/, '');
    if (BASE_ASSET_MAP.has(base)) {
      return BASE_ASSET_MAP.get(base);
    }
    return {
      symbol: sym,
      baseAsset: base,
      name: base,
      sector: SECTORS.Other,
      narratives: [],
      coingeckoId: null,
      defillamaSlug: null,
    };
  }

  return null;
}

/**
 * Returns all registered assets.
 */
export function getAllRegisteredAssets() {
  return registryData.assets;
}

/**
 * Pure calculation & normalization engine for Spot Buying Pressure:
 * - Coinbase Premium Index (Coinbase Spot USD vs Binance Spot USDT)
 * - Spot / Futures Volume Ratio
 * - Multi-Exchange Spot vs Futures Taker Flow & Session CVD
 * - Spot vs Futures Order Book Imbalance comparison
 *
 * Zero React/DOM dependencies; safe for Node tests and browser bundles.
 */

const finite = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Calculates Coinbase Premium Index between Coinbase Spot and Binance Spot/Futures.
 */
export function calculateCoinbasePremium({
  coinbasePrice,
  binanceSpotPrice,
  binanceFuturesPrice = null,
  usdtUsdRate = 1,
} = {}) {
  const cb = finite(coinbasePrice);
  const bnSpot = finite(binanceSpotPrice);
  const bnFut = finite(binanceFuturesPrice);
  const fx = finite(usdtUsdRate);
  const effectiveFx = fx != null && fx > 0.9 && fx < 1.1 ? fx : 1;

  if (cb == null || cb <= 0 || bnSpot == null || bnSpot <= 0) {
    return {
      coinbasePrice: cb,
      binanceSpotPrice: bnSpot,
      binanceFuturesPrice: bnFut,
      premiumUsd: null,
      premiumPct: null,
      cbVsFuturesUsd: null,
      cbVsFuturesPct: null,
      regime: 'UNAVAILABLE',
      label: 'Chưa có dữ liệu Coinbase',
      tone: 'neutral',
    };
  }

  const normalizedBinanceSpot = bnSpot * effectiveFx;
  const premiumUsd = cb - normalizedBinanceSpot;
  const premiumPct = (premiumUsd / normalizedBinanceSpot) * 100;

  const cbVsFuturesUsd = bnFut != null && bnFut > 0 ? cb - bnFut * effectiveFx : null;
  const cbVsFuturesPct = bnFut != null && bnFut > 0 ? (cbVsFuturesUsd / (bnFut * effectiveFx)) * 100 : null;

  let regime = 'NEUTRAL';
  let label = 'Cân bằng USD / USDT';
  let tone = 'neutral';

  if (premiumPct >= 0.05) {
    regime = 'STRONG_PREMIUM';
    label = 'Lực mua Spot Mỹ mạnh';
    tone = 'bullish';
  } else if (premiumPct >= 0.015) {
    regime = 'MILD_PREMIUM';
    label = 'Coinbase dương nhẹ';
    tone = 'constructive';
  } else if (premiumPct <= -0.05) {
    regime = 'STRONG_DISCOUNT';
    label = 'Áp lực bán Spot Mỹ';
    tone = 'bearish';
  } else if (premiumPct <= -0.015) {
    regime = 'MILD_DISCOUNT';
    label = 'Coinbase chiết khấu nhẹ';
    tone = 'warning';
  }

  return {
    coinbasePrice: cb,
    binanceSpotPrice: bnSpot,
    binanceFuturesPrice: bnFut,
    premiumUsd,
    premiumPct,
    cbVsFuturesUsd,
    cbVsFuturesPct,
    regime,
    label,
    tone,
  };
}

/**
 * Computes Spot vs Futures Volume Ratio & Market Share (%).
 */
export function calculateSpotFuturesVolumeRatio({
  spotQuoteVol,
  futuresQuoteVol,
} = {}) {
  const spotVol = finite(spotQuoteVol);
  const futuresVol = finite(futuresQuoteVol);

  if (spotVol == null || futuresVol == null || spotVol < 0 || futuresVol < 0 || (spotVol + futuresVol) <= 0) {
    return {
      spotQuoteVol: spotVol,
      futuresQuoteVol: futuresVol,
      totalQuoteVol: null,
      spotToFuturesRatio: null,
      spotSharePct: null,
      futuresSharePct: null,
      regime: 'UNAVAILABLE',
      label: 'Chưa đủ dữ liệu volume',
      tone: 'neutral',
    };
  }

  const totalQuoteVol = spotVol + futuresVol;
  const spotSharePct = (spotVol / totalQuoteVol) * 100;
  const futuresSharePct = 100 - spotSharePct;
  const spotToFuturesRatio = futuresVol > 0 ? spotVol / futuresVol : null;

  let regime = 'BALANCED';
  let label = 'Spot / Perp cân bằng';
  let tone = 'constructive';

  if (spotSharePct >= 32) {
    regime = 'SPOT_HEAVY';
    label = 'Tỷ trọng Spot cao';
    tone = 'bullish';
  } else if (spotSharePct < 18) {
    regime = 'FUTURES_DOMINANT';
    label = 'Phái sinh chiếm tỷ trọng lớn';
    tone = 'warning';
  }

  return {
    spotQuoteVol: spotVol,
    futuresQuoteVol: futuresVol,
    totalQuoteVol,
    spotToFuturesRatio,
    spotSharePct,
    futuresSharePct,
    regime,
    label,
    tone,
  };
}

/**
 * Selects Spot & Futures quote volumes only when both sides share the same time horizon
 * (either both 24H history klines, or both live session streams).
 */
export function selectAlignedSpotFuturesVolumes({
  hasFuturesHistory,
  futuresHistoryVol,
  futuresSessionVol,
  hasSpotHistory,
  spotHistoryVol,
  spotSessionVol,
} = {}) {
  if (hasFuturesHistory && hasSpotHistory) {
    return {
      aligned: true,
      horizon: '24H',
      spotQuoteVol: spotHistoryVol,
      futuresQuoteVol: futuresHistoryVol,
    };
  }
  if (!hasFuturesHistory && !hasSpotHistory) {
    return {
      aligned: true,
      horizon: 'SESSION',
      spotQuoteVol: spotSessionVol,
      futuresQuoteVol: futuresSessionVol,
    };
  }
  return {
    aligned: false,
    horizon: 'MISMATCH',
    spotQuoteVol: null,
    futuresQuoteVol: null,
  };
}

/**
 * Normalizes Binance Spot/Futures aggTrades response.
 * Raw fields: { a: aggId, p: price, q: qty, T: timestamp, m: isBuyerMaker }
 * When m === false -> Buyer is taker (aggressive buy).
 */
export function parseBinanceAggTrades(rawTrades, market = 'spot', venue = 'BINANCE') {
  if (!Array.isArray(rawTrades)) return [];
  const normalized = [];
  for (const t of rawTrades) {
    const price = finite(t?.p);
    const qty = finite(t?.q);
    const time = finite(t?.T);
    if (price == null || qty == null || price <= 0 || qty <= 0) continue;
    normalized.push({
      id: `${venue}:${market}:${t.a ?? `${time}:${price}:${qty}`}`,
      venue,
      market,
      price,
      qty,
      usdVol: price * qty,
      side: t.m === false ? 'buy' : 'sell',
      time: time ?? Date.now(),
    });
  }
  return normalized;
}

/**
 * Normalizes Bybit V5 recent-trade response.
 * Raw response: { result: { list: [{ execId, price, size, side: 'Buy'|'Sell', time }] } }
 * Bybit `side` is the taker side.
 */
export function parseBybitRecentTrades(rawData, market = 'spot', venue = 'BYBIT') {
  const list = rawData?.result?.list ?? rawData?.list ?? (Array.isArray(rawData) ? rawData : []);
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const t of list) {
    const price = finite(t?.price);
    const qty = finite(t?.size);
    const time = finite(t?.time);
    const sideRaw = String(t?.side || '').toLowerCase();
    if (price == null || qty == null || price <= 0 || qty <= 0 || (sideRaw !== 'buy' && sideRaw !== 'sell')) {
      continue;
    }
    normalized.push({
      id: `${venue}:${market}:${t.execId ?? `${time}:${price}:${qty}`}`,
      venue,
      market,
      price,
      qty,
      usdVol: price * qty,
      side: sideRaw,
      time: time ?? Date.now(),
    });
  }
  return normalized;
}

/**
 * Normalizes OKX V5 market/trades response.
 * Raw response: { data: [{ tradeId, px, sz, side: 'buy'|'sell', ts }] }
 * OKX `side` is the taker side; SWAP contracts require contractScale (e.g. 0.01 BTC/contract).
 */
export function parseOkxTrades(rawData, market = 'spot', contractScale = 1, venue = 'OKX') {
  const list = rawData?.data ?? (Array.isArray(rawData) ? rawData : []);
  if (!Array.isArray(list)) return [];
  const scale = finite(contractScale) && contractScale > 0 ? contractScale : 1;
  const normalized = [];
  for (const t of list) {
    const price = finite(t?.px);
    const rawQty = finite(t?.sz);
    const time = finite(t?.ts);
    const sideRaw = String(t?.side || '').toLowerCase();
    if (price == null || rawQty == null || price <= 0 || rawQty <= 0 || (sideRaw !== 'buy' && sideRaw !== 'sell')) {
      continue;
    }
    const qty = rawQty * scale;
    normalized.push({
      id: `${venue}:${market}:${t.tradeId ?? `${time}:${price}:${rawQty}`}`,
      venue,
      market,
      price,
      qty,
      usdVol: price * qty,
      side: sideRaw,
      time: time ?? Date.now(),
    });
  }
  return normalized;
}

/**
 * Normalizes Coinbase Exchange /products/{id}/trades response.
 * CRITICAL: In Coinbase Exchange public trades, `side` indicates the MAKER order side:
 * - side === 'sell' -> resting ask was hit -> Taker BUY
 * - side === 'buy'  -> resting bid was hit -> Taker SELL
 */
export function parseCoinbaseTrades(rawData, venue = 'COINBASE') {
  const list = Array.isArray(rawData) ? rawData : [];
  const normalized = [];
  for (const t of list) {
    const price = finite(t?.price);
    const qty = finite(t?.size);
    const makerSide = String(t?.side || '').toLowerCase();
    const parsedTime = typeof t?.time === 'number' ? t.time : Date.parse(t?.time);
    if (price == null || qty == null || price <= 0 || qty <= 0 || (makerSide !== 'buy' && makerSide !== 'sell')) {
      continue;
    }
    normalized.push({
      id: `${venue}:spot:${t.trade_id ?? `${parsedTime}:${price}:${qty}`}`,
      venue,
      market: 'spot',
      price,
      qty,
      usdVol: price * qty,
      side: makerSide === 'sell' ? 'buy' : 'sell',
      time: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
    });
  }
  return normalized;
}

/**
 * Summarizes an array of normalized trades into taker buy/sell/delta metrics.
 */
export function summarizeTradeBatch(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      buyVolUsd: 0,
      sellVolUsd: 0,
      netDeltaUsd: 0,
      totalVolUsd: 0,
      deltaRatioPct: null,
      tradeCount: 0,
      startTime: null,
      endTime: null,
      spanSec: 0,
      status: 'ERROR',
    };
  }

  let buyVolUsd = 0;
  let sellVolUsd = 0;
  let startTime = Infinity;
  let endTime = -Infinity;

  for (const t of trades) {
    const usd = finite(t?.usdVol) ?? 0;
    if (usd <= 0) continue;
    if (t.side === 'buy') buyVolUsd += usd;
    else if (t.side === 'sell') sellVolUsd += usd;

    const ts = finite(t?.time);
    if (ts != null) {
      if (ts < startTime) startTime = ts;
      if (ts > endTime) endTime = ts;
    }
  }

  const totalVolUsd = buyVolUsd + sellVolUsd;
  const netDeltaUsd = buyVolUsd - sellVolUsd;
  const deltaRatioPct = totalVolUsd > 0 ? (netDeltaUsd / totalVolUsd) * 100 : null;
  const hasTimes = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime;

  return {
    buyVolUsd,
    sellVolUsd,
    netDeltaUsd,
    totalVolUsd,
    deltaRatioPct,
    tradeCount: trades.length,
    startTime: hasTimes ? startTime : null,
    endTime: hasTimes ? endTime : null,
    spanSec: hasTimes ? Math.round((endTime - startTime) / 1000) : 0,
    status: totalVolUsd > 0 ? 'OK' : 'ERROR',
  };
}

const MAX_SEEN_IDS_PER_VENUE = 4000;

/**
 * Creates a fresh session accumulator store for Multi-Exchange CVD tracking.
 */
export function createMultiExchangeSessionStore() {
  return {
    startedAt: Date.now(),
    venues: {},
  };
}

function formatVenueBucketSummary(bucket) {
  const spanSec = bucket.startTime != null && bucket.endTime != null
    ? Math.max(0, Math.round((bucket.endTime - bucket.startTime) / 1000))
    : 0;
  const deltaRatioPct = bucket.totalVolUsd > 0 ? (bucket.netDeltaUsd / bucket.totalVolUsd) * 100 : null;

  return {
    buyVolUsd: bucket.buyVolUsd,
    sellVolUsd: bucket.sellVolUsd,
    netDeltaUsd: bucket.netDeltaUsd,
    totalVolUsd: bucket.totalVolUsd,
    deltaRatioPct,
    tradeCount: bucket.tradeCount,
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    spanSec,
    status: bucket.status,
  };
}

/**
 * Merges newly fetched trades into a venue/market bucket without double-counting.
 */
export function mergeTradesIntoSessionStore(store, venueKey, trades = []) {
  if (!store || !venueKey) return null;
  if (!store.venues[venueKey]) {
    store.venues[venueKey] = {
      buyVolUsd: 0,
      sellVolUsd: 0,
      netDeltaUsd: 0,
      totalVolUsd: 0,
      tradeCount: 0,
      startTime: null,
      endTime: null,
      seenSet: new Set(),
      status: 'ERROR',
    };
  }

  const bucket = store.venues[venueKey];
  if (!Array.isArray(trades) || trades.length === 0) {
    return formatVenueBucketSummary(bucket);
  }

  // Sort oldest-first so bounded eviction preserves newest trade IDs cleanly
  const sorted = [...trades].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  for (const t of sorted) {
    if (!t?.id || bucket.seenSet.has(t.id)) continue;
    const usd = finite(t.usdVol) ?? 0;
    if (usd <= 0) continue;

    bucket.seenSet.add(t.id);
    if (bucket.seenSet.size > MAX_SEEN_IDS_PER_VENUE) {
      // JS Set preserves insertion order, making oldest-key eviction strictly O(1).
      const oldestId = bucket.seenSet.values().next().value;
      bucket.seenSet.delete(oldestId);
    }

    if (t.side === 'buy') bucket.buyVolUsd += usd;
    else if (t.side === 'sell') bucket.sellVolUsd += usd;
    bucket.totalVolUsd = bucket.buyVolUsd + bucket.sellVolUsd;
    bucket.netDeltaUsd = bucket.buyVolUsd - bucket.sellVolUsd;
    bucket.tradeCount += 1;

    const ts = finite(t.time);
    if (ts != null) {
      bucket.startTime = bucket.startTime == null ? ts : Math.min(bucket.startTime, ts);
      bucket.endTime = bucket.endTime == null ? ts : Math.max(bucket.endTime, ts);
    }
    bucket.status = 'OK';
  }

  return formatVenueBucketSummary(bucket);
}

function aggregateMarketSummaries(summaries = {}) {
  const entries = Object.entries(summaries);
  let buyVolUsd = 0;
  let sellVolUsd = 0;
  let totalVolUsd = 0;
  let tradeCount = 0;
  let activeVenues = 0;

  for (const [, summary] of entries) {
    if (!summary || summary.status !== 'OK') continue;
    buyVolUsd += finite(summary.buyVolUsd) ?? 0;
    sellVolUsd += finite(summary.sellVolUsd) ?? 0;
    totalVolUsd += finite(summary.totalVolUsd) ?? 0;
    tradeCount += finite(summary.tradeCount) ?? 0;
    activeVenues += 1;
  }

  const netDeltaUsd = buyVolUsd - sellVolUsd;
  const deltaRatioPct = totalVolUsd > 0 ? (netDeltaUsd / totalVolUsd) * 100 : null;

  return {
    buyVolUsd,
    sellVolUsd,
    netDeltaUsd,
    totalVolUsd,
    deltaRatioPct,
    tradeCount,
    activeVenues,
    status: activeVenues > 0 ? 'OK' : 'ERROR',
  };
}

/**
 * Builds an aligned multi-exchange Spot vs Futures CVD comparison object.
 */
export function buildMultiExchangeCvdComparison({
  spotVenues = {},
  futuresVenues = {},
} = {}) {
  const venueOrder = ['BINANCE', 'BYBIT', 'OKX', 'COINBASE'];
  const rows = venueOrder.map((code) => {
    const spot = spotVenues[code] || null;
    const futures = futuresVenues[code] || null;
    return {
      code,
      spot,
      futures,
    };
  });

  const spotTotal = aggregateMarketSummaries(spotVenues);
  const futuresTotal = aggregateMarketSummaries(futuresVenues);

  let alignment = {
    state: 'INSUFFICIENT',
    label: 'Chưa đủ dữ liệu đa sàn',
    detail: 'Cần dữ liệu trade từ ít nhất 1 sàn Spot và 1 sàn Futures.',
    tone: 'neutral',
  };

  if (spotTotal.status === 'OK' && futuresTotal.status === 'OK') {
    const sRatio = spotTotal.deltaRatioPct ?? 0;
    const fRatio = futuresTotal.deltaRatioPct ?? 0;
    const deadband = 2.0; // 2% taker imbalance threshold on live trade flow

    const spotBuy = sRatio > deadband;
    const spotSell = sRatio < -deadband;
    const futBuy = fRatio > deadband;
    const futSell = fRatio < -deadband;

    if (spotBuy && futBuy) {
      alignment = {
        state: 'CONFLUENCE_BUY',
        label: 'Spot + Futures cùng mua',
        detail: 'Áp lực mua chủ động đồng thuận trên cả Spot đa sàn lẫn Futures.',
        tone: 'bullish',
      };
    } else if (spotSell && futSell) {
      alignment = {
        state: 'CONFLUENCE_SELL',
        label: 'Spot + Futures cùng bán',
        detail: 'Áp lực bán chủ động lan rộng trên cả Spot lẫn Futures.',
        tone: 'bearish',
      };
    } else if (spotBuy && futSell) {
      alignment = {
        state: 'SPOT_ABSORPTION',
        label: 'Spot mua hấp thụ Futures',
        detail: 'Dòng tiền Spot đa sàn mua lên trong khi Futures đang bán/short.',
        tone: 'constructive',
      };
    } else if (spotSell && futBuy) {
      alignment = {
        state: 'LEVERAGED_PUMP',
        label: 'Futures kéo / Spot bán',
        detail: 'Lực mua chủ yếu đến từ Futures đòn bẩy, Spot đang xả ròng.',
        tone: 'warning',
      };
    } else if (spotBuy) {
      alignment = {
        state: 'SPOT_LED_BUY',
        label: 'Spot đa sàn dẫn dắt mua',
        detail: 'Spot nghiêng mua chủ động rõ rệt trong khi Futures cân bằng.',
        tone: 'constructive',
      };
    } else if (spotSell) {
      alignment = {
        state: 'SPOT_LED_SELL',
        label: 'Spot đa sàn nghiêng bán',
        detail: 'Spot bán ròng trong khi Futures chưa rõ hướng.',
        tone: 'warning',
      };
    } else {
      alignment = {
        state: 'BALANCED',
        label: 'Dòng lệnh đa sàn cân bằng',
        detail: 'Chưa xuất hiện lệch pha mạnh giữa Spot và Futures đa sàn.',
        tone: 'neutral',
      };
    }
  }

  return {
    rows,
    spotTotal,
    futuresTotal,
    alignment,
    timestamp: Date.now(),
  };
}

/**
 * Compares Futures OBI vs Spot OBI for combined Order Book diagnostics.
 */
export function classifyOrderBookComparison(futuresOb, spotOb) {
  const fObi = finite(futuresOb?.obiPercent);
  const sObi = finite(spotOb?.obiPercent);

  if (fObi == null || sObi == null) {
    return {
      state: 'PENDING',
      label: 'Đang đồng bộ Spot vs Futures OBI',
      tone: 'neutral',
    };
  }

  const threshold = 10;
  const fBull = fObi >= threshold;
  const fBear = fObi <= -threshold;
  const sBull = sObi >= threshold;
  const sBear = sObi <= -threshold;

  if (sBull && fBull) {
    return { state: 'CONFLUENCE_BID', label: 'Spot + Futures Bid áp đảo', tone: 'bullish' };
  }
  if (sBear && fBear) {
    return { state: 'CONFLUENCE_ASK', label: 'Spot + Futures Ask đè giá', tone: 'bearish' };
  }
  if (sBull && fBear) {
    return { state: 'SPOT_BID_SUPPORT', label: 'Spot kê đỡ giá · Futures Ask dày', tone: 'constructive' };
  }
  if (sBear && fBull) {
    return { state: 'FUTURES_BID_SPOOF_RISK', label: 'Futures Bid dày · Spot bán chờ', tone: 'warning' };
  }
  if (sBull) {
    return { state: 'SPOT_BID_LEAD', label: 'Spot Bid nhỉnh hơn', tone: 'constructive' };
  }
  if (sBear) {
    return { state: 'SPOT_ASK_HEAVY', label: 'Spot Ask dày hơn', tone: 'warning' };
  }
  return { state: 'BALANCED', label: 'Sổ lệnh Spot / Futures cân bằng', tone: 'neutral' };
}

/**
 * Aggregates raw multi-exchange order book responses into normalized OBI + depth metrics.
 * Slices each venue book to at most `limit` levels and falls back to the first valid venue
 * when the primary source fails instead of substituting a hardcoded price constant.
 */
export function aggregateOrderBookSnapshots({
  results = [],
  sources = [],
  market = 'futures',
  limit = 100,
} = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;

  let totalBidVol = 0;
  let totalAskVol = 0;
  let refBestBid = 0;
  let refBestAsk = 0;
  let refMinBid = 0;
  let refMaxAsk = 0;
  let refIsPrimary = false;

  const exchanges = results.map((r, idx) => {
    const src = sources[idx] || {};
    const rawBids = Array.isArray(r?.bids) ? r.bids : [];
    const rawAsks = Array.isArray(r?.asks) ? r.asks : [];
    const bids = cap ? rawBids.slice(0, cap) : rawBids;
    const asks = cap ? rawAsks.slice(0, cap) : rawAsks;

    const scale = finite(src.scale) && src.scale > 0 ? src.scale : 1;
    const bidVol = bids.reduce((sum, entry) => sum + (parseFloat(entry?.[1]) || 0) * scale, 0);
    const askVol = asks.reduce((sum, entry) => sum + (parseFloat(entry?.[1]) || 0) * scale, 0);

    totalBidVol += bidVol;
    totalAskVol += askVol;

    const bestBid = bids.length > 0 ? (parseFloat(bids[0]?.[0]) || 0) : 0;
    const bestAsk = asks.length > 0 ? (parseFloat(asks[0]?.[0]) || 0) : 0;
    const minBid = bids.length > 0 ? (parseFloat(bids[bids.length - 1]?.[0]) || 0) : 0;
    const maxAsk = asks.length > 0 ? (parseFloat(asks[asks.length - 1]?.[0]) || 0) : 0;

    if (bestBid > 0 && bestAsk > 0 && (src.isPrimary || (!refIsPrimary && refBestBid <= 0))) {
      refBestBid = bestBid;
      refBestAsk = bestAsk;
      refMinBid = minBid;
      refMaxAsk = maxAsk;
      if (src.isPrimary) refIsPrimary = true;
    }

    const tot = bidVol + askVol;
    const exObi = tot > 0 ? ((bidVol - askVol) / tot) * 100 : 0;
    return {
      name: src.tag || src.name || `EX${idx + 1}`,
      obi: parseFloat(exObi.toFixed(1)),
      hasData: tot > 0,
    };
  });

  const total = totalBidVol + totalAskVol;
  if (total <= 0 || refBestBid <= 0 || refBestAsk <= 0) {
    return null;
  }

  const obi = (totalBidVol - totalAskVol) / total;
  const spread = ((refBestAsk - refBestBid) / refBestBid) * 100;
  const midPrice = (refBestBid + refBestAsk) / 2;
  const bidVolUsd = totalBidVol * midPrice;
  const askVolUsd = totalAskVol * midPrice;

  return {
    market,
    obi: parseFloat(obi.toFixed(4)),
    obiPercent: parseFloat((obi * 100).toFixed(1)),
    spread: parseFloat(spread.toFixed(4)),
    bestBid: refBestBid,
    bestAsk: refBestAsk,
    minBid: refMinBid,
    maxAsk: refMaxAsk,
    bidVolBtc: parseFloat(totalBidVol.toFixed(2)),
    askVolBtc: parseFloat(totalAskVol.toFixed(2)),
    bidVolUsd: Math.round(bidVolUsd),
    askVolUsd: Math.round(askVolUsd),
    signal: obi > 0.15 ? 'BUY PRESSURE' : obi < -0.15 ? 'SELL PRESSURE' : 'BALANCED',
    signalCls: obi > 0.15 ? 'text-emerald' : obi < -0.15 ? 'text-rose' : 'text-slate-400',
    exchanges,
  };
}

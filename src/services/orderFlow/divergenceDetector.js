const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function confirmedPivots(series, field, left = 2, right = 2) {
  const pivots = [];
  for (let index = left; index < series.length - right; index += 1) {
    const value = finite(series[index]?.[field]);
    if (value == null) continue;
    const before = series.slice(index - left, index).map((row) => finite(row?.[field]));
    const after = series.slice(index + 1, index + right + 1).map((row) => finite(row?.[field]));
    if ([...before, ...after].some((item) => item == null)) continue;
    const high = before.every((item) => value > item) && after.every((item) => value >= item);
    const low = before.every((item) => value < item) && after.every((item) => value <= item);
    if (high || low) pivots.push({ index, type: high ? 'high' : 'low', value, confirmedIndex: index + right });
  }
  return pivots;
}

export function detectPriceCvdDivergences(series = [], { market = 'spot', timeframe = '5m', minPricePct = 0.08, minCvdPct = 0.5 } = {}) {
  if (series.length < 10) return [];
  const pricePivots = confirmedPivots(series, 'price');
  const events = [];
  for (const type of ['high', 'low']) {
    const matching = pricePivots.filter((pivot) => pivot.type === type);
    for (let i = 1; i < matching.length; i += 1) {
      const previous = matching[i - 1];
      const current = matching[i];
      const previousRow = series[previous.index];
      const currentRow = series[current.index];
      const previousPrice = finite(previousRow.price);
      const currentPrice = finite(currentRow.price);
      const previousCvd = finite(previousRow.cvd);
      const currentCvd = finite(currentRow.cvd);
      if ([previousPrice, currentPrice, previousCvd, currentCvd].some((value) => value == null)) continue;
      const priceChangePct = ((currentPrice - previousPrice) / previousPrice) * 100;
      const cvdScale = Math.max(Math.abs(previousCvd), Math.abs(currentCvd), 1);
      const cvdChangePct = ((currentCvd - previousCvd) / cvdScale) * 100;
      const bearish = type === 'high' && priceChangePct >= minPricePct && cvdChangePct <= -minCvdPct;
      const bullish = type === 'low' && priceChangePct <= -minPricePct && cvdChangePct >= minCvdPct;
      if (!bearish && !bullish) continue;
      const confirmed = series[current.confirmedIndex];
      events.push({
        id: `${market}:${timeframe}:${bullish ? 'bullish' : 'bearish'}:${currentRow.time}`,
        market, timeframe, type: bullish ? 'bullish_divergence' : 'bearish_divergence',
        pivotTime: currentRow.time, confirmedAt: confirmed?.time,
        priceChangePct, cvdChangePct,
        confidence: Math.min(95, Math.round(50 + Math.abs(priceChangePct) * 30 + Math.min(25, Math.abs(cvdChangePct)))),
        evidence: bullish
          ? 'Giá tạo đáy thấp hơn trong khi CVD tạo đáy cao hơn.'
          : 'Giá tạo đỉnh cao hơn trong khi CVD tạo đỉnh thấp hơn.',
      });
    }
  }
  return events;
}

export function detectSpotFuturesDivergence(spotSeries, futuresSeries, { timeframe = '5m', thresholdPct = 0.35 } = {}) {
  const spot = spotSeries?.at(-1);
  const futures = futuresSeries?.at(-1);
  if (!spot || !futures || spot.time !== futures.time) return null;
  const spotTotal = (spot.buyVol || 0) + (spot.sellVol || 0);
  const futuresTotal = (futures.buyVol || 0) + (futures.sellVol || 0);
  if (spotTotal <= 0 || futuresTotal <= 0) return null;
  const spotRatio = (spot.delta / spotTotal) * 100;
  const futuresRatio = (futures.delta / futuresTotal) * 100;
  if (Math.abs(spotRatio) < thresholdPct || Math.abs(futuresRatio) < thresholdPct || Math.sign(spotRatio) === Math.sign(futuresRatio)) return null;
  return {
    id: `cross:${timeframe}:${spot.time}`,
    market: 'cross', timeframe, type: spotRatio > 0 ? 'spot_buy_futures_sell' : 'spot_sell_futures_buy',
    pivotTime: spot.time, confirmedAt: spot.time,
    confidence: Math.min(92, Math.round(55 + Math.abs(spotRatio - futuresRatio) * 4)),
    evidence: spotRatio > 0
      ? 'Spot mua chủ động trong khi Futures bán chủ động.'
      : 'Futures mua chủ động trong khi Spot bán chủ động.',
    spotRatio, futuresRatio,
  };
}

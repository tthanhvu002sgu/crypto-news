const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function aggregateRatio(points = []) {
  let buy = 0;
  let sell = 0;
  for (const point of points) {
    buy += finite(point?.buyVol) ?? 0;
    sell += finite(point?.sellVol) ?? 0;
  }
  const total = buy + sell;
  return total > 0 ? ((buy - sell) / total) * 100 : null;
}

export function computeFlowMetrics({ points = [], buyVolume = 0, sellVolume = 0, netDelta = null } = {}) {
  const buy = finite(buyVolume) ?? 0;
  const sell = finite(sellVolume) ?? 0;
  const totalVolume = buy + sell;
  const resolvedDelta = finite(netDelta) ?? (buy - sell);
  const deltaRatioPct = totalVolume > 0 ? (resolvedDelta / totalVolume) * 100 : null;

  const bucketRatios = points
    .map((point) => {
      const pointBuy = finite(point?.buyVol) ?? 0;
      const pointSell = finite(point?.sellVol) ?? 0;
      const pointTotal = pointBuy + pointSell;
      return pointTotal > 0 ? (((finite(point?.delta) ?? (pointBuy - pointSell)) / pointTotal) * 100) : null;
    })
    .filter((value) => value != null);

  let zScore = null;
  if (bucketRatios.length >= 6) {
    const latest = bucketRatios.at(-1);
    const baseline = bucketRatios.slice(0, -1);
    const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    const variance = baseline.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / baseline.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 1e-9) zScore = (latest - mean) / stdDev;
  }

  const groupSize = Math.min(3, Math.floor(points.length / 2));
  let velocityPct = null;
  if (groupSize > 0) {
    const recent = aggregateRatio(points.slice(-groupSize));
    const previous = aggregateRatio(points.slice(-(groupSize * 2), -groupSize));
    if (recent != null && previous != null) velocityPct = recent - previous;
  }

  const normalizedImpulse = deltaRatioPct == null ? 0 : deltaRatioPct;
  const zImpulse = zScore == null ? 0 : zScore;
  const strengthScore = totalVolume > 0
    ? Math.round(clamp(50 + (normalizedImpulse * 7) + (zImpulse * 6), 0, 100))
    : null;

  const directionalValue = zScore != null && Math.abs(zScore) >= 0.75 ? zScore : normalizedImpulse / 0.35;
  const direction = totalVolume <= 0 || Math.abs(directionalValue) < 1
    ? 'neutral'
    : directionalValue > 0 ? 'buy' : 'sell';

  const momentum = velocityPct == null || Math.abs(velocityPct) < 0.15
    ? 'stable'
    : velocityPct > 0 ? 'accelerating' : 'decelerating';

  return {
    buyVolume: buy,
    sellVolume: sell,
    totalVolume,
    netDelta: resolvedDelta,
    deltaRatioPct,
    zScore,
    velocityPct,
    strengthScore,
    direction,
    momentum,
  };
}

export function classifySpotFutures(spot, futures) {
  const spotDirection = spot?.direction ?? 'neutral';
  const futuresDirection = futures?.direction ?? 'neutral';
  const key = `${spotDirection}:${futuresDirection}`;
  const verdicts = {
    'buy:buy': ['Mua đồng thuận', 'Spot và Futures cùng xác nhận lực mua chủ động.', 'bullish'],
    'sell:sell': ['Bán đồng thuận', 'Spot và Futures cùng xác nhận lực bán chủ động.', 'bearish'],
    'buy:sell': ['Spot hấp thụ Futures', 'Cầu cơ sở đối đầu áp lực bán phái sinh.', 'constructive'],
    'sell:buy': ['Nhịp tăng dùng đòn bẩy', 'Futures mua nhưng Spot chưa xác nhận dòng tiền.', 'warning'],
    'buy:neutral': ['Spot dẫn dắt', 'Dòng tiền cơ sở mua trong khi Futures còn cân bằng.', 'constructive'],
    'sell:neutral': ['Spot phân phối', 'Spot bán chủ động trong khi Futures còn cân bằng.', 'bearish'],
    'neutral:buy': ['Futures dẫn dắt', 'Lực mua hiện chủ yếu đến từ thị trường đòn bẩy.', 'warning'],
    'neutral:sell': ['Futures nghiêng Short', 'Áp lực bán hiện chủ yếu đến từ phái sinh.', 'warning'],
    'neutral:neutral': ['Dòng lệnh cân bằng', 'Chưa có bên nào kiểm soát rõ ràng.', 'neutral'],
  };
  const [title, detail, tone] = verdicts[key] ?? verdicts['neutral:neutral'];
  const spotSignal = Math.abs((spot?.strengthScore ?? 50) - 50);
  const futuresSignal = Math.abs((futures?.strengthScore ?? 50) - 50);
  const confidence = Math.round(clamp(45 + spotSignal + futuresSignal, 45, 92));
  return { title, detail, tone, confidence };
}

export function classifyFuturesPositioning({ priceChangePct, oiChangePct, flowDirection, fundingRate } = {}) {
  const price = finite(priceChangePct);
  const oi = finite(oiChangePct);
  const funding = finite(fundingRate);
  if (price == null || oi == null || flowDirection === 'neutral') {
    return { label: 'Chưa đủ dữ liệu định vị', detail: 'Cần Price, CVD và lịch sử OI đồng thời.', tone: 'neutral' };
  }

  const priceUp = price > 0.15;
  const priceDown = price < -0.15;
  const oiUp = oi > 0.15;
  const oiDown = oi < -0.15;
  let label = 'Dòng vị thế hỗn hợp';
  let detail = 'Price, CVD và OI chưa tạo cấu hình rõ ràng.';
  let tone = 'neutral';

  if (priceUp && flowDirection === 'buy' && oiUp) {
    label = 'Long mới tham gia'; detail = 'Giá, aggressive buy và OI cùng tăng.'; tone = 'bullish';
  } else if (priceUp && flowDirection === 'buy' && oiDown) {
    label = 'Short covering'; detail = 'Giá và CVD tăng nhưng OI co lại.'; tone = 'constructive';
  } else if (priceDown && flowDirection === 'sell' && oiUp) {
    label = 'Short mới tham gia'; detail = 'Giá giảm, aggressive sell và OI tăng.'; tone = 'bearish';
  } else if (priceDown && flowDirection === 'sell' && oiDown) {
    label = 'Long liquidation'; detail = 'Giá, CVD và OI cùng giảm.'; tone = 'bearish';
  } else if (priceUp && flowDirection === 'sell') {
    label = 'Sell absorption'; detail = 'Giá tăng dù aggressive flow nghiêng bán.'; tone = 'constructive';
  } else if (priceDown && flowDirection === 'buy') {
    label = 'Buy absorption / trapped longs'; detail = 'CVD mua nhưng giá vẫn giảm; cần chờ xác nhận.'; tone = 'warning';
  }

  if (funding != null && Math.abs(funding) >= 0.0005) {
    detail += funding > 0 ? ' Funding dương cao làm tăng rủi ro crowded longs.' : ' Funding âm sâu làm tăng rủi ro crowded shorts.';
  }
  return { label, detail, tone };
}

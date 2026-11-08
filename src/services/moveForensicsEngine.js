/**
 * Move Forensics Engine
 *
 * Mổ xẻ và giải phẫu chuyên sâu các đợt giật giá mạnh (sharp impulse moves)
 * trong 24h (từ nến 15m) và 7d (từ nến 1h). Tái dựng vi cấu trúc tại thời điểm:
 * Taker CVD Delta, Δ Open Interest, Long/Short Ratio, Sự kiện kinh tế vĩ mô,
 * và phản ứng sau cú giật (Forward Retracement / Continuation).
 */

const toFiniteNumber = (val) => {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,%]/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimeMs = (val) => {
  if (val == null) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    return (val > 0 && val < 1e11) ? val * 1000 : val;
  }
  const parsed = new Date(val).getTime();
  if (!Number.isFinite(parsed)) return null;
  return (parsed > 0 && parsed < 1e11) ? parsed * 1000 : parsed;
};

const formatIsoVn = (ms) => {
  const t = toTimeMs(ms);
  if (t == null) return 'N/A';
  const vnDate = new Date(t + 7 * 3600 * 1000);
  return vnDate.toISOString().replace('T', ' ').substring(0, 16) + ' (GMT+7)';
};

export const formatDisplayDateVn = (ms) => {
  const t = toTimeMs(ms);
  if (t == null) return 'N/A';
  const vnDate = new Date(t + 7 * 3600 * 1000);
  const iso = vnDate.toISOString();
  const day = iso.substring(8, 10);
  const month = iso.substring(5, 7);
  const time = iso.substring(11, 16);
  return `${day}/${month} ${time}`;
};

export const formatFullDateVn = (ms) => {
  const t = toTimeMs(ms);
  if (t == null) return 'N/A';
  const vnDate = new Date(t + 7 * 3600 * 1000);
  const iso = vnDate.toISOString();
  const year = iso.substring(0, 4);
  const month = iso.substring(5, 7);
  const day = iso.substring(8, 10);
  const time = iso.substring(11, 16);
  return `Ngày ${day}/${month}/${year} lúc ${time} (GMT+7)`;
};

export const formatUsd = (num, decimals = 1) => {
  const n = toFiniteNumber(num);
  if (n == null) return 'N/A';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

export const formatCompactUsd = (num) => {
  const n = toFiniteNumber(num);
  if (n == null) return 'N/A';
  const sign = n < 0 ? '-' : (n > 0 ? '+' : '');
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

/**
 * Phát hiện Top N đợt di chuyển giá mạnh nhất (sharp impulse moves & liquidity sweeps)
 * Hỗ trợ nhận diện cả thân nến lớn lẫn râu quét cực mạnh (Stop Hunts / Bart Patterns),
 * gom các cụm nến có xu hướng kèm dung sai nến nghỉ, và sắp xếp theo độ lớn hiệu dụng.
 *
 * @param {Array<Object>} klines Mảng nến OHLCV
 * @param {number} count Số đợt muốn trích xuất (mặc định 3 cho 24h, 5 cho 7d)
 * @param {Object} options Tùy chọn cấu hình
 * @returns {Array<Object>} Danh sách các cú giật giá mạnh nhất
 */
export function detectTopImpulseMoves(klines = [], count = 3, options = {}) {
  if (!Array.isArray(klines) || klines.length === 0) {
    return [];
  }

  // Tăng độ dài cụm tối đa (mặc định 6, có thể mở rộng tới 8 cho nến 15m)
  const maxClusterLength = options.maxClusterLength || 6;
  const candidates = [];

  // Chuẩn hóa và làm sạch nến
  const validBars = klines.map((k, index) => {
    const open = toFiniteNumber(k.open);
    const close = toFiniteNumber(k.close);
    const high = toFiniteNumber(k.high) ?? Math.max(open ?? 0, close ?? 0);
    const low = toFiniteNumber(k.low) ?? Math.min(open ?? 0, close ?? 0);
    const volume = toFiniteNumber(k.volume) ?? 0;
    const quoteVolume = toFiniteNumber(k.quoteVolume) ?? 0;
    const takerBuyQuoteVolume = toFiniteNumber(k.takerBuyQuoteVolume);
    
    // CVD delta: Taker Mua - Taker Bán (Quote Volume)
    let takerCvdDelta = 0;
    if (takerBuyQuoteVolume != null && quoteVolume > 0) {
      takerCvdDelta = (2 * takerBuyQuoteVolume) - quoteVolume;
    }

    const timeMs = toTimeMs(k.time);
    const change = (open != null && close != null && open > 0) ? (close - open) : 0;
    const changePercent = (open != null && close != null && open > 0) ? ((close - open) / open) * 100 : 0;
    const range = (high != null && low != null && low > 0) ? (high - low) : 0;
    const rangePercent = (low != null && low > 0) ? (range / low) * 100 : 0;
    const direction = changePercent > 0.02 ? 'PUMP' : (changePercent < -0.02 ? 'DUMP' : 'FLAT');

    return {
      index,
      timeMs,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume,
      takerCvdDelta,
      change,
      changePercent,
      range,
      rangePercent,
      direction,
      raw: k
    };
  }).filter(b => b.open != null && b.close != null && b.timeMs != null);

  if (validBars.length === 0) return [];

  // Tính khoảng cách thời gian giữa các nến để xác định thời điểm kết thúc chính xác
  let defaultDuration = 900000; // 15 phút mặc định
  if (validBars.length >= 2) {
    const diff = validBars[1].timeMs - validBars[0].timeMs;
    if (diff > 0 && diff <= 86400000) {
      defaultDuration = diff;
    }
  }
  const candleDuration = options.candleDurationMs || defaultDuration;

  // Helper hàm khởi tạo và chấm điểm một ứng viên (single bar hoặc cluster)
  const buildCandidate = (startIndex, endIndex, bars) => {
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const startPrice = firstBar.open;
    const endPrice = lastBar.close;
    const highPrice = Math.max(...bars.map(b => b.high));
    const lowPrice = Math.min(...bars.map(b => b.low));
    const priceChange = endPrice - startPrice;
    const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;
    const totalRange = highPrice - lowPrice;
    const rangePercent = lowPrice > 0 ? (totalRange / lowPrice) * 100 : 0;

    // Phân tích cấu trúc râu nến (wicks) và thân nến (body)
    const upperWick = highPrice - Math.max(startPrice, endPrice);
    const lowerWick = Math.min(startPrice, endPrice) - lowPrice;
    const upperWickRatio = totalRange > 0 ? upperWick / totalRange : 0;
    const lowerWickRatio = totalRange > 0 ? lowerWick / totalRange : 0;
    const bodyRatio = totalRange > 0 ? Math.abs(priceChange) / totalRange : 0;

    // Tỷ lệ thoái lui trong nội bộ nến/cụm nến (Intracandle Retracement)
    let intracandleRetracePercent = 0;
    if (priceChange >= 0 && highPrice > startPrice) {
      intracandleRetracePercent = ((highPrice - endPrice) / (highPrice - startPrice)) * 100;
    } else if (priceChange < 0 && startPrice > lowPrice) {
      intracandleRetracePercent = ((endPrice - lowPrice) / (startPrice - lowPrice)) * 100;
    }

    // Phân loại kiểu biến động (Move Type)
    let moveType = 'DIRECTIONAL_IMPULSE';
    const direction = priceChangePercent >= 0 ? 'PUMP' : 'DUMP';

    if (upperWickRatio >= 0.50 && rangePercent >= 0.5) {
      moveType = 'LIQUIDITY_SWEEP_HIGH'; // Quét thanh lý đỉnh / Râu trên dài
    } else if (lowerWickRatio >= 0.50 && rangePercent >= 0.5) {
      moveType = 'LIQUIDITY_SWEEP_LOW'; // Quét thanh lý đáy / Rút chân mạnh
    } else if (upperWickRatio >= 0.35 && lowerWickRatio >= 0.35 && rangePercent >= 0.8) {
      moveType = 'TWO_WAY_VOLATILITY'; // Biến động giật 2 đầu
    } else {
      moveType = priceChangePercent >= 0 ? 'DIRECTIONAL_PUMP' : 'DIRECTIONAL_DUMP';
    }

    // Độ lớn biến động hiệu dụng (Effective Magnitude):
    // Cân đối giữa biên độ thân (close-open) và biên độ râu quét (high-low).
    // Giúp các cú Stop Hunt quét râu lớn nhưng đóng nến doji không bị lọt khỏi radar.
    const effectiveMagnitude = Math.max(Math.abs(priceChangePercent), rangePercent * 0.75);

    const totalVolume = bars.reduce((acc, b) => acc + b.volume, 0);
    const totalQuoteVolume = bars.reduce((acc, b) => acc + b.quoteVolume, 0);
    const totalTakerCvdDelta = bars.reduce((acc, b) => acc + b.takerCvdDelta, 0);

    return {
      startIndex,
      endIndex,
      candleCount: bars.length,
      startTime: firstBar.timeMs,
      endTime: lastBar.timeMs + candleDuration,
      startPrice,
      endPrice,
      highPrice,
      lowPrice,
      priceChange,
      priceChangePercent,
      rangePercent,
      effectiveMagnitude,
      moveType,
      upperWickRatio,
      lowerWickRatio,
      bodyRatio,
      intracandleRetracePercent,
      direction,
      volume: totalVolume,
      quoteVolume: totalQuoteVolume,
      takerCvdDelta: totalTakerCvdDelta
    };
  };

  // 1. Tạo candidate từ từng nến đơn lẻ
  for (let i = 0; i < validBars.length; i++) {
    candidates.push(buildCandidate(i, i, [validBars[i]]));
  }

  // 2. Tạo candidate từ các cụm nến (Smart Clustering)
  // Gom cả cụm thuần (pure impulse) VÀ cụm có tối đa 1 nến nghỉ / pullback nhỏ
  for (let len = 2; len <= maxClusterLength; len++) {
    for (let i = 0; i <= validBars.length - len; i++) {
      const windowBars = validBars.slice(i, i + len);
      const firstBar = windowBars[0];
      const lastBar = windowBars[windowBars.length - 1];

      // A. Cụm đồng nhất 100% cùng chiều
      const isConsistentPump = windowBars.every(b => b.close >= b.open);
      const isConsistentDump = windowBars.every(b => b.close <= b.open);

      if (isConsistentPump || isConsistentDump) {
        candidates.push(buildCandidate(i, i + len - 1, windowBars));
        continue;
      }

      // B. Cụm xu hướng có 1 nến nghỉ / pullback nhỏ (<= 25% biên độ tích lũy)
      const redBars = windowBars.filter(b => b.close < b.open);
      const greenBars = windowBars.filter(b => b.close > b.open);

      if (redBars.length === 1 && firstBar.close >= firstBar.open && lastBar.close > firstBar.open) {
        const netPump = lastBar.close - firstBar.open;
        const redPullback = redBars[0].open - redBars[0].close;
        if (netPump > 0 && (redPullback / netPump) <= 0.25) {
          candidates.push(buildCandidate(i, i + len - 1, windowBars));
        }
      } else if (greenBars.length === 1 && firstBar.close <= firstBar.open && lastBar.close < firstBar.open) {
        const netDump = firstBar.open - lastBar.close;
        const greenPullback = greenBars[0].close - greenBars[0].open;
        if (netDump > 0 && (greenPullback / netDump) <= 0.25) {
          candidates.push(buildCandidate(i, i + len - 1, windowBars));
        }
      }
    }
  }

  // Sắp xếp các ứng viên theo độ lớn biến động hiệu dụng (effectiveMagnitude) giảm dần
  candidates.sort((a, b) => b.effectiveMagnitude - a.effectiveMagnitude);

  // Lọc non-overlapping intervals tham lam (greedy)
  const selected = [];
  const coveredIndices = new Set();

  for (const cand of candidates) {
    if (selected.length >= count) break;

    // Kiểm tra xem khoảng index [cand.startIndex, cand.endIndex] có bị chồng lấn không
    let overlaps = false;
    for (let idx = cand.startIndex; idx <= cand.endIndex; idx++) {
      if (coveredIndices.has(idx)) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      selected.push(cand);
      for (let idx = cand.startIndex; idx <= cand.endIndex; idx++) {
        coveredIndices.add(idx);
      }
    }
  }

  // Sắp xếp lại theo trình tự thời gian tăng dần để phân tích diễn biến logic
  return selected.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Tái dựng dữ liệu vi cấu trúc và đối chiếu sự kiện tại thời điểm giật giá
 *
 * @param {Array<Object>} moves Danh sách các cú giật giá từ detectTopImpulseMoves
 * @param {Object} context Bối cảnh gồm oiHistory, lsHistory, calendarEvents, localMoveStore, klines
 * @returns {Array<Object>} Danh sách các cú giật đã được làm giàu dữ liệu
 */
export function enrichMoveWithMicrostructure(moves = [], context = {}) {
  if (!Array.isArray(moves) || moves.length === 0) return [];

  const {
    oiHistory = [],
    lsHistory = [],
    fundingHistory = [],
    calendarEvents = [],
    localMoveStore = [],
    klines = []
  } = context;

  // Sắp xếp klines để tiện tra cứu forward reactions
  const sortedKlines = (Array.isArray(klines) ? [...klines] : [])
    .map(k => ({
      timeMs: toTimeMs(k.time),
      open: toFiniteNumber(k.open),
      high: toFiniteNumber(k.high),
      low: toFiniteNumber(k.low),
      close: toFiniteNumber(k.close)
    }))
    .filter(k => k.timeMs != null && k.close != null)
    .sort((a, b) => a.timeMs - b.timeMs);

  return moves.map((move, rankIndex) => {
    const { startTime, endTime, startPrice, endPrice, direction, priceChangePercent, moveType, intracandleRetracePercent } = move;

    // 1. Tìm Δ OI tại thời điểm cú giật
    let oiBefore = null;
    let oiAfter = null;
    let oiDelta = null;
    let oiDeltaPercent = null;

    if (Array.isArray(oiHistory) && oiHistory.length > 0) {
      const sortedOi = oiHistory
        .map(r => ({
          timeMs: toTimeMs(r.timestamp || r.time),
          oi: toFiniteNumber(r.sumOpenInterest ?? r.openInterest)
        }))
        .filter(r => r.timeMs != null && r.oi != null)
        .sort((a, b) => a.timeMs - b.timeMs);

      if (sortedOi.length > 0) {
        const oiStartLimit = sortedOi[0].timeMs;
        const oiEndLimit = sortedOi[sortedOi.length - 1].timeMs;
        const candleDuration = move.candleCount > 0 ? (endTime - startTime) / move.candleCount : 3600 * 1000;
        const oiToleranceMs = Math.max(3 * 3600 * 1000, Math.round(candleDuration * 1.5));

        // Chỉ xử lý OI khi khoảng thời gian cú giật nằm trong phạm vi dữ liệu OI có thật (± tolerance)
        if (startTime >= oiStartLimit - oiToleranceMs && endTime <= oiEndLimit + oiToleranceMs) {
          // Tìm điểm OI gần nhất tại hoặc trước startTime
          let beforeIdx = -1;
          let minBeforeDiff = Infinity;
          for (let i = 0; i < sortedOi.length; i++) {
            const diff = Math.abs(sortedOi[i].timeMs - startTime);
            if (sortedOi[i].timeMs <= startTime && diff < minBeforeDiff) {
              minBeforeDiff = diff;
              beforeIdx = i;
            }
          }
          if (beforeIdx === -1) {
            for (let i = 0; i < sortedOi.length; i++) {
              const diff = Math.abs(sortedOi[i].timeMs - startTime);
              if (diff < minBeforeDiff && diff <= oiToleranceMs) {
                minBeforeDiff = diff;
                beforeIdx = i;
              }
            }
          }

          // Tìm điểm OI gần nhất tại hoặc sau endTime
          let afterIdx = -1;
          let minAfterDiff = Infinity;
          for (let i = sortedOi.length - 1; i >= 0; i--) {
            const diff = Math.abs(sortedOi[i].timeMs - endTime);
            if (sortedOi[i].timeMs >= endTime && diff < minAfterDiff) {
              minAfterDiff = diff;
              afterIdx = i;
            }
          }
          if (afterIdx === -1) {
            for (let i = sortedOi.length - 1; i >= 0; i--) {
              const diff = Math.abs(sortedOi[i].timeMs - endTime);
              if (diff < minAfterDiff && diff <= oiToleranceMs) {
                minAfterDiff = diff;
                afterIdx = i;
              }
            }
          }

          if (beforeIdx !== -1 && afterIdx !== -1) {
            if (beforeIdx === afterIdx) {
              if (afterIdx < sortedOi.length - 1 && Math.abs(sortedOi[afterIdx + 1].timeMs - endTime) <= oiToleranceMs) {
                afterIdx = beforeIdx + 1;
              } else if (beforeIdx > 0 && Math.abs(sortedOi[beforeIdx - 1].timeMs - startTime) <= oiToleranceMs) {
                beforeIdx = afterIdx - 1;
              }
            }

            if (beforeIdx !== -1 && afterIdx !== -1) {
              oiBefore = sortedOi[beforeIdx].oi;
              oiAfter = sortedOi[afterIdx].oi;
              oiDelta = oiAfter - oiBefore;
              oiDeltaPercent = oiBefore > 0 ? (oiDelta / oiBefore) * 100 : 0;
            }
          }
        }
      }
    }

    // 2. Tìm Long/Short Ratio tại thời điểm
    let matchingLsRatio = null;
    if (Array.isArray(lsHistory) && lsHistory.length > 0) {
      const candleDuration = move.candleCount > 0 ? (endTime - startTime) / move.candleCount : 3600 * 1000;
      const lsToleranceMs = Math.max(3 * 3600 * 1000, Math.round(candleDuration * 1.5));
      let bestLsDiff = Infinity;
      for (const row of lsHistory) {
        const t = toTimeMs(row.timestamp || row.time);
        const ratio = toFiniteNumber(row.longShortRatio);
        if (t == null || ratio == null) continue;
        const diff = Math.abs(t - endTime);
        if (diff < bestLsDiff && diff <= lsToleranceMs) {
          bestLsDiff = diff;
          matchingLsRatio = ratio;
        }
      }
    }

    // 3. Khớp các sự kiện kinh tế vĩ mô trong phạm vi ±2 giờ
    const TWO_HOURS_MS = 2 * 3600 * 1000;
    const matchingCalendarEvents = [];
    if (Array.isArray(calendarEvents)) {
      for (const ev of calendarEvents) {
        const evTime = toTimeMs(ev.date || ev.time || ev.timestamp);
        if (evTime != null) {
          if (evTime >= startTime - TWO_HOURS_MS && evTime <= endTime + TWO_HOURS_MS) {
            matchingCalendarEvents.push({
              title: ev.title || 'Sự kiện kinh tế',
              country: ev.country || 'USD',
              impact: (ev.impact || 'MEDIUM').toUpperCase(),
              timeMs: evTime,
              timeStr: ev.timeStr || formatIsoVn(evTime),
              forecast: ev.forecast || 'N/A',
              actual: ev.actual || 'N/A'
            });
          }
        }
      }
    }

    // 4. Khớp dữ liệu thực tế từ MoveTrackerResearch (IndexedDB / LocalStorage) nếu có lưu
    let localTrackerMatch = null;
    if (Array.isArray(localMoveStore) && localMoveStore.length > 0) {
      const candleDuration = move.candleCount > 0 ? (endTime - startTime) / move.candleCount : 3600 * 1000;
      const localToleranceMs = Math.max(30 * 60 * 1000, Math.round(candleDuration * 0.5));
      const moveMidTime = (startTime + endTime) / 2;
      let bestLocalDiff = Infinity;

      for (const ev of localMoveStore) {
        const t = ev.triggerTime ?? ev.startTime;
        if (t == null) continue;
        // Kiểm tra xem sự kiện có diễn ra trong khoảng thời gian diễn ra đợt sóng hay không
        if (t >= startTime - localToleranceMs && t <= endTime + localToleranceMs) {
          const diff = Math.abs(t - moveMidTime);
          if (diff < bestLocalDiff) {
            bestLocalDiff = diff;
            localTrackerMatch = {
              id: ev.id,
              qualityTier: ev.qualityTier,
              flowLabel: ev.flowLabel,
              outcomeLabel: ev.outcomeLabel,
              liqLongUsd: toFiniteNumber(ev.liqLongUsd ?? ev.triggerSnapshot?.liqLongUsd),
              liqShortUsd: toFiniteNumber(ev.liqShortUsd ?? ev.triggerSnapshot?.liqShortUsd)
            };
          }
        }
      }
    }

    // 5. Phản ứng giá sau cú giật (Forward Reaction 1h, 4h, 12h, 24h)
    const forwardReactions = {
      price1h: null,
      price4h: null,
      price12h: null,
      price24h: null,
      retracementPercent: null,
      trendContinuation: null
    };

    if (sortedKlines.length > 0) {
      const ONE_HOUR = 3600 * 1000;
      const FOUR_HOURS = 4 * 3600 * 1000;
      const TWELVE_HOURS = 12 * 3600 * 1000;
      const TWENTY_FOUR_HOURS = 24 * 3600 * 1000;

      // Tìm nến diễn ra sau khi cú giật kết thúc
      const candidatesAfter = sortedKlines.filter(k => k.timeMs >= endTime);

      const findPriceAtTime = (targetTime, maxToleranceMs) => {
        if (candidatesAfter.length === 0) return null;

        let best = null;
        let minDiff = Infinity;

        for (const k of candidatesAfter) {
          const diff = Math.abs(k.timeMs - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            best = k;
          }
        }

        if (best != null && minDiff <= maxToleranceMs) {
          return best.close;
        }
        return null;
      };

      forwardReactions.price1h = findPriceAtTime(endTime + ONE_HOUR, 45 * 60 * 1000);
      forwardReactions.price4h = findPriceAtTime(endTime + FOUR_HOURS, 90 * 60 * 1000);
      forwardReactions.price12h = findPriceAtTime(endTime + TWELVE_HOURS, 3 * 3600 * 1000);
      forwardReactions.price24h = findPriceAtTime(endTime + TWENTY_FOUR_HOURS, 6 * 3600 * 1000);

      // Tính tỷ lệ thoái lui (Retracement %) dựa trên giá nến sau cú giật (ưu tiên price4h -> price1h -> price12h -> price24h)
      const postPrice = forwardReactions.price4h ?? forwardReactions.price1h ?? forwardReactions.price12h ?? forwardReactions.price24h;
      if (postPrice != null && startPrice !== endPrice) {
        const totalImpulse = endPrice - startPrice;
        if (direction === 'PUMP') {
          forwardReactions.retracementPercent = ((endPrice - postPrice) / totalImpulse) * 100;
        } else {
          forwardReactions.retracementPercent = ((postPrice - endPrice) / Math.abs(totalImpulse)) * 100;
        }

        // Đánh giá xu hướng tiếp diễn: thoái lui <= 35% -> Tiếp diễn (Continuation); >= 70% -> Đảo chiều/Hấp thụ (Reversal/Trap)
        if (forwardReactions.retracementPercent <= 35) {
          forwardReactions.trendContinuation = 'CONTINUATION_CONFIRMED';
        } else if (forwardReactions.retracementPercent >= 70) {
          forwardReactions.trendContinuation = 'MEAN_REVERSION_OR_TRAP';
        } else {
          forwardReactions.trendContinuation = 'CONSOLIDATION';
        }
      } else {
        forwardReactions.trendContinuation = 'DEVELOPING_IN_PROGRESS';
      }
    }

    // 6. Xây dựng Giả Thuyết Cơ Chế (Forensic Hypothesis)
    let mechanismHypothesis = 'UNCLASSIFIED';
    let mechanismExplanation = 'Biến động theo quán tính cung cầu tự nhiên.';
    let confidence = 'MEDIUM';

    const hasMacro = matchingCalendarEvents.some(e => e.impact === 'HIGH');
    const isOiDecreasing = oiDeltaPercent != null && oiDeltaPercent < -0.8;
    const isOiIncreasing = oiDeltaPercent != null && oiDeltaPercent > 0.8;
    const isHeavyPostRetracement = forwardReactions.retracementPercent != null && forwardReactions.retracementPercent > 70;
    const isIntracandleSweepTrap = (intracandleRetracePercent != null && intracandleRetracePercent >= 65) || moveType === 'LIQUIDITY_SWEEP_HIGH' || moveType === 'LIQUIDITY_SWEEP_LOW';
    const hasMajorShortLiq = localTrackerMatch?.liqShortUsd != null && localTrackerMatch.liqShortUsd > 1000000;
    const hasMajorLongLiq = localTrackerMatch?.liqLongUsd != null && localTrackerMatch.liqLongUsd > 1000000;

    if (hasMacro) {
      mechanismHypothesis = 'MACRO_NEWS_REACTION';
      const ev = matchingCalendarEvents.find(e => e.impact === 'HIGH') || matchingCalendarEvents[0];
      mechanismExplanation = `Phản ứng dữ dội trước tin tức/sự kiện vĩ mô: "${ev.title}".`;
      confidence = 'HIGH';
    } else if (moveType === 'LIQUIDITY_SWEEP_HIGH' || (direction === 'DUMP' && isIntracandleSweepTrap)) {
      mechanismHypothesis = 'SWEEP_AND_REJECT_HIGH';
      mechanismExplanation = 'Quét thanh lý đỉnh (Buy-side Liquidity Grab) với râu trên dài rồi bị xả ngược trở lại.';
      confidence = 'HIGH';
    } else if (moveType === 'LIQUIDITY_SWEEP_LOW' || (direction === 'PUMP' && isIntracandleSweepTrap)) {
      mechanismHypothesis = 'SWEEP_AND_RECLAIM_LOW';
      mechanismExplanation = 'Quét thanh lý đáy (Sell-side Liquidity Grab) với râu dưới dài rồi được hấp thụ rút chân gom hàng.';
      confidence = 'HIGH';
    } else if (isHeavyPostRetracement) {
      mechanismHypothesis = 'ABSORPTION_TRAP';
      mechanismExplanation = direction === 'PUMP'
        ? 'Bẫy tăng giá (Bull Trap) - Lực mua bị chặn bởi tường xả Limit Sell, giá bị kéo ngược > 70%.'
        : 'Bẫy giảm giá (Bear Trap) - Quét thanh lý đáy rồi được hấp thụ gom hàng ngược lại.';
      confidence = 'HIGH';
    } else if ((direction === 'PUMP' && isOiDecreasing) || hasMajorShortLiq) {
      mechanismHypothesis = 'SHORT_SQUEEZE';
      mechanismExplanation = hasMajorShortLiq
        ? `Phe Short bị thanh lý cưỡng bức lớn (${formatCompactUsd(localTrackerMatch.liqShortUsd)}) đẩy giá bật tăng mạnh.`
        : 'Phe Short bị ép thanh lý hoặc cắt lỗ hàng loạt khiến OI sụt giảm mạnh trong khi giá giật tăng dựng đứng.';
      confidence = 'HIGH';
    } else if ((direction === 'DUMP' && isOiDecreasing) || hasMajorLongLiq) {
      mechanismHypothesis = 'LONG_LIQUIDATION_CASCADE';
      mechanismExplanation = hasMajorLongLiq
        ? `Thanh lý dây chuyền các vị thế Long lớn (${formatCompactUsd(localTrackerMatch.liqLongUsd)}) kích hoạt đà rơi giá.`
        : 'Thanh lý dây chuyền các vị thế Long đòn bẩy cao, khiến OI bốc hơi nhanh chóng cùng nhịp rơi giá.';
      confidence = 'HIGH';
    } else if (direction === 'PUMP' && isOiIncreasing && (move.takerCvdDelta > 0 || move.takerCvdDelta == null)) {
      mechanismHypothesis = 'AGGRESSIVE_TAKER_BUYING';
      mechanismExplanation = 'Dòng tiền mua chủ động lớn (Aggressive Taker Flow) kèm vị thế hợp đồng mới (OI tăng) đẩy bung kháng cự.';
      confidence = 'HIGH';
    } else if (direction === 'DUMP' && isOiIncreasing && (move.takerCvdDelta < 0 || move.takerCvdDelta == null)) {
      mechanismHypothesis = 'AGGRESSIVE_SHORT_BUILDING';
      mechanismExplanation = 'Phe Short chủ động bán tháo ép giá kèm vị thế mới mở thêm (OI tăng) tạo đà bán tháo tiếp diễn.';
      confidence = 'HIGH';
    }

    const startTimeVn = formatIsoVn(startTime);
    const endTimeVn = formatIsoVn(endTime);
    const displayTimeVn = formatDisplayDateVn(startTime);
    const fullTimeVn = formatFullDateVn(startTime);

    return {
      ...move,
      rank: rankIndex + 1,
      startTimeVn,
      endTimeVn,
      displayTimeVn,
      fullTimeVn,
      oiBefore,
      oiAfter,
      oiDelta,
      oiDeltaPercent,
      lsRatio: matchingLsRatio,
      matchingCalendarEvents,
      localTrackerMatch,
      forwardReactions,
      mechanismHypothesis,
      mechanismExplanation,
      confidence
    };
  });
}

/**
 * Định dạng danh sách cú giật thành văn bản Markdown chuẩn để đưa vào prompt cho AI
 *
 * @param {Array<Object>} moves24h Top 3 đợt giật giá trong 24h
 * @param {Array<Object>} moves7d Top 5 đợt giật giá trong 7d
 * @param {Array<Object>|Object} movesH4OrContext Top 5 đợt biến động cấu trúc khung H4 hoặc bối cảnh bổ sung
 * @param {Object} maybeContext Bối cảnh bổ sung khi movesH4 được truyền
 * @returns {string} Chuỗi Markdown chi tiết cho AI
 */
export function formatForensicsPayloadForAi(moves24h = [], moves7d = [], movesH4OrContext = null, maybeContext = {}) {
  let movesH4 = [];
  let context = {};
  const hasExplicitH4Param = Array.isArray(movesH4OrContext);

  if (hasExplicitH4Param) {
    movesH4 = movesH4OrContext;
    context = maybeContext && typeof maybeContext === 'object' ? maybeContext : {};
  } else if (movesH4OrContext && typeof movesH4OrContext === 'object') {
    context = movesH4OrContext;
    movesH4 = [];
  }

  const parts = [];

  parts.push(`## DỮ LIỆU GIẢI PHẪU BIẾN ĐỘNG GIÁ (MOVE FORENSICS & MICROSTRUCTURE DATA)`);
  parts.push(`*Dữ liệu ghi nhận từ Binance Klines (15m cho 24h, 1h cho 7d, 4h cho cấu trúc vĩ mô), kết hợp Taker CVD, Open Interest, L/S Ratio, thanh lý HFT và sự kiện vĩ mô.*`);
  parts.push('');

  // 1. TOP 3 TRONG 24H
  parts.push(`### 1. TOP 3 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 24H QUA (NẾN 15M)`);
  parts.push(`*QUY TẮC PHÂN TÍCH: BẮT BUỘC sắp xếp và phân tích theo đúng trình tự thời gian (Chronological order) từ cũ đến mới. Khi đề cập từng đợt, BẮT BUỘC ghi rõ CẢ NGÀY VÀ GIỜ (ví dụ: "Ngày 04/11 lúc 09:15 GMT+7"), TUYỆT ĐỐI KHÔNG chỉ ghi mỗi giờ ("lúc 09:15") để người đọc nắm bắt được diễn biến theo từng ngày.*`);
  if (!moves24h || moves24h.length === 0) {
    parts.push(`- *Không ghi nhận biến động đột biến nào vượt ngưỡng trong 24h qua.*`);
  } else {
    parts.push(`| # | Ngày & Giờ (GMT+7) | Loại Biến Động | Hướng | Bắt Đầu -> Đích (Biên Độ) | Quét Đỉnh-Đáy (Range) | Taker CVD Delta | Δ OI | L/S | Phản Ứng Sau Đợt | Cơ Chế Giả Thuyết |`);
    parts.push(`|---|---|---|---|---|---|---|---|---|---|---|`);

    moves24h.forEach((m, idx) => {
      const dirIcon = m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP';
      const rangeStr = `${formatUsd(m.startPrice, 0)} -> ${formatUsd(m.endPrice, 0)}`;
      const pctStr = `${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%`;
      const sweepRangeStr = m.rangePercent != null ? `${m.rangePercent.toFixed(2)}% (${formatUsd(m.lowPrice, 0)} - ${formatUsd(m.highPrice, 0)})` : 'N/A';
      const cvdStr = formatCompactUsd(m.takerCvdDelta);
      const oiStr = m.oiDeltaPercent != null ? `${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%` : 'N/A';
      const lsStr = m.lsRatio != null ? m.lsRatio.toFixed(2) : 'N/A';
      const reactStr = m.forwardReactions?.trendContinuation || 'N/A';
      const typeDisplay = m.moveType || 'DIRECTIONAL';
      const timeDisplay = m.fullTimeVn || m.startTimeVn;
      parts.push(`| ${idx + 1} | ${timeDisplay} | \`${typeDisplay}\` | ${dirIcon} | ${rangeStr} (**${pctStr}**) | ${sweepRangeStr} | ${cvdStr} | ${oiStr} | ${lsStr} | ${reactStr} | **${m.mechanismHypothesis}** |`);
    });

    parts.push('');
    parts.push(`**Chi tiết vi cấu trúc từng cú giật 24h (theo trình tự thời gian):**`);
    moves24h.forEach((m, idx) => {
      parts.push(`- **Cú giật #${idx + 1} [${m.fullTimeVn || m.startTimeVn}] (${m.direction} ${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}% | Quét râu: ${m.rangePercent != null ? m.rangePercent.toFixed(2) : 'N/A'}%):**`);
      parts.push(`  - *Thời điểm diễn ra:* Từ ${m.startTimeVn} đến ${m.endTimeVn} (${m.candleCount} nến 15m). Kiểu: \`${m.moveType || 'DIRECTIONAL'}\`.`);
      parts.push(`  - *Biên độ giá:* Bắt đầu tại ${formatUsd(m.startPrice)}, chạm cực đại ${formatUsd(m.direction === 'PUMP' ? m.highPrice : m.lowPrice)}, kết thúc tại ${formatUsd(m.endPrice)}.`);
      parts.push(`  - *Khối lượng & Dòng lệnh:* Quote Vol: ${formatCompactUsd(m.quoteVolume)} | Taker CVD Delta: **${formatCompactUsd(m.takerCvdDelta)}**.`);
      parts.push(`  - *Biến động Open Interest:* ${m.oiBefore != null ? `${m.oiBefore.toLocaleString()} -> ${m.oiAfter.toLocaleString()} BTC (${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%)` : 'Chưa có chuỗi lịch sử OI'}.`);
      parts.push(`  - *Phản ứng sau cú giật:* Sau 1h: ${formatUsd(m.forwardReactions?.price1h)} | Sau 4h: ${formatUsd(m.forwardReactions?.price4h)} | Tỷ lệ thoái lui (Retracement): **${m.forwardReactions?.retracementPercent != null ? `${m.forwardReactions.retracementPercent.toFixed(1)}%` : 'N/A'}** (${m.forwardReactions?.trendContinuation || 'N/A'}).`);
      if (m.localTrackerMatch) {
        const liqL = m.localTrackerMatch.liqLongUsd ? `Long liq: ${formatCompactUsd(m.localTrackerMatch.liqLongUsd)}` : null;
        const liqS = m.localTrackerMatch.liqShortUsd ? `Short liq: ${formatCompactUsd(m.localTrackerMatch.liqShortUsd)}` : null;
        const liqInfo = [liqL, liqS].filter(Boolean).join(' | ');
        if (liqInfo) {
          parts.push(`  - *Thanh lý HFT khớp thời điểm:* ${liqInfo} (Flow: ${m.localTrackerMatch.flowLabel || 'N/A'}).`);
        }
      }
      if (m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0) {
        parts.push(`  - *Sự kiện vĩ mô trùng khớp:* ${m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title} (${e.country})`).join('; ')}.`);
      }
      parts.push(`  - *Nhận định cơ chế:* **${m.mechanismHypothesis}** — ${m.mechanismExplanation}`);
    });
  }

  parts.push('');

  // 2. TOP 5 TRONG 7D
  parts.push(`### 2. TOP 5 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 7 NGÀY QUA (NẾN 1H)`);
  parts.push(`*QUY TẮC PHÂN TÍCH: BẮT BUỘC sắp xếp và phân tích theo đúng trình tự thời gian (Chronological order) từ đầu tuần đến nay. Khi đề cập từng đợt, BẮT BUỘC ghi rõ CẢ NGÀY VÀ GIỜ (ví dụ: "Ngày 02/11 lúc 08:00 GMT+7"), TUYỆT ĐỐI KHÔNG chỉ ghi mỗi giờ ("lúc 08:00") để người đọc nắm bắt được diễn biến theo từng ngày.*`);
  if (!moves7d || moves7d.length === 0) {
    parts.push(`- *Không ghi nhận biến động đột biến nào trong 7 ngày qua.*`);
  } else {
    parts.push(`| # | Ngày & Giờ (GMT+7) | Loại Biến Động | Hướng | Bắt Đầu -> Đích (Biên Độ) | Quét Đỉnh-Đáy (Range) | Taker CVD Delta | Δ OI | L/S | Phản Ứng Sau Đợt | Cơ Chế Giả Thuyết |`);
    parts.push(`|---|---|---|---|---|---|---|---|---|---|---|`);

    moves7d.forEach((m, idx) => {
      const dirIcon = m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP';
      const rangeStr = `${formatUsd(m.startPrice, 0)} -> ${formatUsd(m.endPrice, 0)}`;
      const pctStr = `${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%`;
      const sweepRangeStr = m.rangePercent != null ? `${m.rangePercent.toFixed(2)}% (${formatUsd(m.lowPrice, 0)} - ${formatUsd(m.highPrice, 0)})` : 'N/A';
      const cvdStr = formatCompactUsd(m.takerCvdDelta);
      const oiStr = m.oiDeltaPercent != null ? `${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%` : 'N/A';
      const lsStr = m.lsRatio != null ? m.lsRatio.toFixed(2) : 'N/A';
      const reactStr = m.forwardReactions?.trendContinuation || 'N/A';
      const typeDisplay = m.moveType || 'DIRECTIONAL';
      const timeDisplay = m.fullTimeVn || m.startTimeVn;
      parts.push(`| ${idx + 1} | ${timeDisplay} | \`${typeDisplay}\` | ${dirIcon} | ${rangeStr} (**${pctStr}**) | ${sweepRangeStr} | ${cvdStr} | ${oiStr} | ${lsStr} | ${reactStr} | **${m.mechanismHypothesis}** |`);
    });

    parts.push('');
    parts.push(`**Chi tiết vi cấu trúc từng cú giật 7d (theo trình tự thời gian):**`);
    moves7d.forEach((m, idx) => {
      parts.push(`- **Đợt biến động #${idx + 1} [${m.fullTimeVn || m.startTimeVn}] (${m.direction} ${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}% | Quét râu: ${m.rangePercent != null ? m.rangePercent.toFixed(2) : 'N/A'}%):**`);
      parts.push(`  - *Thời điểm:* Từ ${m.startTimeVn} đến ${m.endTimeVn} (${m.candleCount} nến 1h). Kiểu: \`${m.moveType || 'DIRECTIONAL'}\`.`);
      parts.push(`  - *Biên độ giá:* ${formatUsd(m.startPrice)} -> ${formatUsd(m.endPrice)} (Cao nhất: ${formatUsd(m.highPrice)} | Thấp nhất: ${formatUsd(m.lowPrice)}).`);
      parts.push(`  - *Taker CVD:* ${formatCompactUsd(m.takerCvdDelta)} | *Quote Vol:* ${formatCompactUsd(m.quoteVolume)}.`);
      if (m.oiDeltaPercent != null) {
        parts.push(`  - *Biến động Open Interest:* ${m.oiBefore != null ? `${m.oiBefore.toLocaleString()} -> ${m.oiAfter.toLocaleString()} BTC (${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%)` : 'N/A'}.`);
      }
      if (m.lsRatio != null) {
        parts.push(`  - *Long/Short Ratio:* ${m.lsRatio.toFixed(2)}.`);
      }
      parts.push(`  - *Phản ứng sau cú giật (Retracement):* ${m.forwardReactions?.retracementPercent != null ? `${m.forwardReactions.retracementPercent.toFixed(1)}%` : 'N/A'} -> ${m.forwardReactions?.trendContinuation || 'N/A'}.`);
      if (m.localTrackerMatch) {
        const liqL = m.localTrackerMatch.liqLongUsd ? `Long liq: ${formatCompactUsd(m.localTrackerMatch.liqLongUsd)}` : null;
        const liqS = m.localTrackerMatch.liqShortUsd ? `Short liq: ${formatCompactUsd(m.localTrackerMatch.liqShortUsd)}` : null;
        const liqInfo = [liqL, liqS].filter(Boolean).join(' | ');
        if (liqInfo) {
          parts.push(`  - *Thanh lý HFT khớp thời điểm:* ${liqInfo} (Flow: ${m.localTrackerMatch.flowLabel || 'N/A'}).`);
        }
      }
      if (m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0) {
        parts.push(`  - *Sự kiện vĩ mô trùng khớp:* ${m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title} (${e.country})`).join('; ')}.`);
      }
      parts.push(`  - *Cơ chế chủ đạo:* **${m.mechanismHypothesis}** — ${m.mechanismExplanation}`);
    });
  }

  // 3. TOP 5 TRONG H4 (H4 STRUCTURAL WAVES)
  // Chỉ xuất hiện khi người gọi truyền mảng H4 (kể cả mảng rỗng để ghi nhận không có biến động)
  if (hasExplicitH4Param) {
    parts.push('');
    parts.push(`### 3. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H (H4 STRUCTURAL WAVES)`);
    parts.push(`*QUY TẮC PHÂN TÍCH: BẮT BUỘC sắp xếp và phân tích theo đúng trình tự thời gian (Chronological order) trong ~20 ngày qua. Khung 4H phản ánh các bước dịch chuyển cấu trúc vĩ mô (Market Structure Shifts / BOS / CHoCH) mà trên khung 1H chỉ là các chuỗi nến nhỏ nối tiếp nhau.*`);
    if (movesH4.length === 0) {
      parts.push(`- *Không ghi nhận biến động đột biến nào trên khung 4h.*`);
    } else {
      parts.push(`| # | Ngày & Giờ (GMT+7) | Loại Biến Động | Hướng | Bắt Đầu -> Đích (Biên Độ) | Quét Đỉnh-Đáy (Range) | Taker CVD Delta | Δ OI | L/S | Phản Ứng Sau Đợt | Cơ Chế Giả Thuyết |`);
      parts.push(`|---|---|---|---|---|---|---|---|---|---|---|`);

      movesH4.forEach((m, idx) => {
        const dirIcon = m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP';
        const rangeStr = `${formatUsd(m.startPrice, 0)} -> ${formatUsd(m.endPrice, 0)}`;
        const pctStr = `${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%`;
        const sweepRangeStr = m.rangePercent != null ? `${m.rangePercent.toFixed(2)}% (${formatUsd(m.lowPrice, 0)} - ${formatUsd(m.highPrice, 0)})` : 'N/A';
        const cvdStr = formatCompactUsd(m.takerCvdDelta);
        const oiStr = m.oiDeltaPercent != null ? `${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%` : 'N/A';
        const lsStr = m.lsRatio != null ? m.lsRatio.toFixed(2) : 'N/A';
        const reactStr = m.forwardReactions?.trendContinuation || 'N/A';
        const typeDisplay = m.moveType || 'DIRECTIONAL';
        const timeDisplay = m.fullTimeVn || m.startTimeVn;
        parts.push(`| ${idx + 1} | ${timeDisplay} | \`${typeDisplay}\` | ${dirIcon} | ${rangeStr} (**${pctStr}**) | ${sweepRangeStr} | ${cvdStr} | ${oiStr} | ${lsStr} | ${reactStr} | **${m.mechanismHypothesis}** |`);
      });

      parts.push('');
      parts.push(`**Chi tiết vi cấu trúc từng đợt sóng cấu trúc 4h (theo trình tự thời gian):**`);
      movesH4.forEach((m, idx) => {
        parts.push(`- **Đợt cấu trúc #${idx + 1} [${m.fullTimeVn || m.startTimeVn}] (${m.direction} ${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}% | Quét râu: ${m.rangePercent != null ? m.rangePercent.toFixed(2) : 'N/A'}%):**`);
        parts.push(`  - *Thời điểm:* Từ ${m.startTimeVn} đến ${m.endTimeVn} (${m.candleCount} nến 4h). Kiểu: \`${m.moveType || 'DIRECTIONAL'}\`.`);
        parts.push(`  - *Biên độ giá:* ${formatUsd(m.startPrice)} -> ${formatUsd(m.endPrice)} (Cao nhất: ${formatUsd(m.highPrice)} | Thấp nhất: ${formatUsd(m.lowPrice)}).`);
        parts.push(`  - *Taker CVD:* ${formatCompactUsd(m.takerCvdDelta)} | *Quote Vol:* ${formatCompactUsd(m.quoteVolume)}.`);
        if (m.oiDeltaPercent != null) {
          parts.push(`  - *Biến động Open Interest:* ${m.oiBefore != null ? `${m.oiBefore.toLocaleString()} -> ${m.oiAfter.toLocaleString()} BTC (${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%)` : 'N/A'}.`);
        }
        if (m.lsRatio != null) {
          parts.push(`  - *Long/Short Ratio:* ${m.lsRatio.toFixed(2)}.`);
        }
        parts.push(`  - *Phản ứng sau cú giật (Retracement):* ${m.forwardReactions?.retracementPercent != null ? `${m.forwardReactions.retracementPercent.toFixed(1)}%` : 'N/A'} -> ${m.forwardReactions?.trendContinuation || 'N/A'}.`);
        if (m.localTrackerMatch) {
          const liqL = m.localTrackerMatch.liqLongUsd ? `Long liq: ${formatCompactUsd(m.localTrackerMatch.liqLongUsd)}` : null;
          const liqS = m.localTrackerMatch.liqShortUsd ? `Short liq: ${formatCompactUsd(m.localTrackerMatch.liqShortUsd)}` : null;
          const liqInfo = [liqL, liqS].filter(Boolean).join(' | ');
          if (liqInfo) {
            parts.push(`  - *Thanh lý HFT khớp thời điểm:* ${liqInfo} (Flow: ${m.localTrackerMatch.flowLabel || 'N/A'}).`);
          }
        }
        if (m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0) {
          parts.push(`  - *Sự kiện vĩ mô trùng khớp:* ${m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title} (${e.country})`).join('; ')}.`);
        }
        parts.push(`  - *Cơ chế chủ đạo:* **${m.mechanismHypothesis}** — ${m.mechanismExplanation}`);
      });
    }
  }

  parts.push('');
  parts.push(`---`);
  return parts.join('\n');
}

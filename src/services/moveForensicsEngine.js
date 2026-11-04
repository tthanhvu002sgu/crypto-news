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
 * Phát hiện Top N đợt di chuyển giá mạnh nhất (sharp impulse moves)
 * Gom các cụm nến cùng hướng biến động liên tiếp (consecutive impulse clustering)
 * và sắp xếp theo biên độ tuyệt đối giảm dần.
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

  const maxClusterLength = options.maxClusterLength || 4;
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
    // Taker Sell Quote Vol = quoteVolume - takerBuyQuoteVolume
    // CVD Delta = takerBuyQuoteVolume - takerSellQuoteVolume = 2 * takerBuyQuoteVolume - quoteVolume
    let takerCvdDelta = 0;
    if (takerBuyQuoteVolume != null && quoteVolume > 0) {
      takerCvdDelta = (2 * takerBuyQuoteVolume) - quoteVolume;
    }

    const timeMs = toTimeMs(k.time);
    const change = (open != null && close != null && open > 0) ? (close - open) : 0;
    const changePercent = (open != null && close != null && open > 0) ? ((close - open) / open) * 100 : 0;
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

  // Tạo candidate từ từng nến đơn lẻ
  for (let i = 0; i < validBars.length; i++) {
    const bar = validBars[i];
    const priceChange = bar.close - bar.open;
    const priceChangePercent = bar.open > 0 ? (priceChange / bar.open) * 100 : 0;
    candidates.push({
      startIndex: i,
      endIndex: i,
      candleCount: 1,
      startTime: bar.timeMs,
      endTime: bar.timeMs + candleDuration,
      startPrice: bar.open,
      endPrice: bar.close,
      highPrice: bar.high,
      lowPrice: bar.low,
      priceChange,
      priceChangePercent,
      direction: bar.close >= bar.open ? 'PUMP' : 'DUMP',
      volume: bar.volume,
      quoteVolume: bar.quoteVolume,
      takerCvdDelta: bar.takerCvdDelta
    });
  }

  // Tạo candidate từ các cụm nến liên tiếp cùng hướng (2 đến maxClusterLength nến)
  for (let len = 2; len <= maxClusterLength; len++) {
    for (let i = 0; i <= validBars.length - len; i++) {
      const windowBars = validBars.slice(i, i + len);
      const firstBar = windowBars[0];
      const lastBar = windowBars[windowBars.length - 1];

      // Kiểm tra tính đồng nhất của xu hướng trong cụm
      const isConsistentPump = windowBars.every(b => b.close >= b.open);
      const isConsistentDump = windowBars.every(b => b.close <= b.open);

      if (isConsistentPump || isConsistentDump) {
        const startPrice = firstBar.open;
        const endPrice = lastBar.close;
        const highPrice = Math.max(...windowBars.map(b => b.high));
        const lowPrice = Math.min(...windowBars.map(b => b.low));
        const priceChange = endPrice - startPrice;
        const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;
        const direction = priceChangePercent >= 0 ? 'PUMP' : 'DUMP';
        const totalVolume = windowBars.reduce((acc, b) => acc + b.volume, 0);
        const totalQuoteVolume = windowBars.reduce((acc, b) => acc + b.quoteVolume, 0);
        const totalTakerCvdDelta = windowBars.reduce((acc, b) => acc + b.takerCvdDelta, 0);

        candidates.push({
          startIndex: i,
          endIndex: i + len - 1,
          candleCount: len,
          startTime: firstBar.timeMs,
          endTime: lastBar.timeMs + candleDuration,
          startPrice,
          endPrice,
          highPrice,
          lowPrice,
          priceChange,
          priceChangePercent,
          direction,
          volume: totalVolume,
          quoteVolume: totalQuoteVolume,
          takerCvdDelta: totalTakerCvdDelta
        });
      }
    }
  }

  // Sắp xếp các ứng viên theo độ dịch chuyển giá tuyệt đối giảm dần
  candidates.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));

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
    const { startTime, endTime, startPrice, endPrice, direction, priceChangePercent } = move;

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
        const THREE_HOURS_MS = 3 * 3600 * 1000;

        // Chỉ xử lý OI khi khoảng thời gian cú giật nằm trong phạm vi dữ liệu OI có thật (±3h)
        if (startTime >= oiStartLimit - THREE_HOURS_MS && endTime <= oiEndLimit + THREE_HOURS_MS) {
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
              if (diff < minBeforeDiff && diff <= THREE_HOURS_MS) {
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
              if (diff < minAfterDiff && diff <= THREE_HOURS_MS) {
                minAfterDiff = diff;
                afterIdx = i;
              }
            }
          }

          if (beforeIdx !== -1 && afterIdx !== -1) {
            if (beforeIdx === afterIdx) {
              if (afterIdx < sortedOi.length - 1 && Math.abs(sortedOi[afterIdx + 1].timeMs - endTime) <= THREE_HOURS_MS) {
                afterIdx = beforeIdx + 1;
              } else if (beforeIdx > 0 && Math.abs(sortedOi[beforeIdx - 1].timeMs - startTime) <= THREE_HOURS_MS) {
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
      let bestLsDiff = Infinity;
      for (const row of lsHistory) {
        const t = toTimeMs(row.timestamp || row.time);
        const ratio = toFiniteNumber(row.longShortRatio);
        if (t == null || ratio == null) continue;
        const diff = Math.abs(t - endTime);
        if (diff < bestLsDiff && diff <= 3 * 3600 * 1000) { // Trong vòng 3h
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

    // 4. Khớp dữ liệu thực tế từ MoveTrackerResearch (IndexedDB) nếu có lưu
    let localTrackerMatch = null;
    if (Array.isArray(localMoveStore) && localMoveStore.length > 0) {
      let bestLocalDiff = Infinity;
      for (const ev of localMoveStore) {
        const t = ev.triggerTime ?? ev.startTime;
        if (t == null) continue;
        const diff = Math.abs(t - startTime);
        if (diff < bestLocalDiff && diff <= 45 * 60 * 1000) { // Trong vòng 45 phút
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

    // 5. Phản ứng giá sau cú giật (Forward Reaction 1h, 4h, 12h)
    const forwardReactions = {
      price1h: null,
      price4h: null,
      price12h: null,
      retracementPercent: null,
      trendContinuation: null
    };

    if (sortedKlines.length > 0) {
      const ONE_HOUR = 3600 * 1000;
      const FOUR_HOURS = 4 * 3600 * 1000;
      const TWELVE_HOURS = 12 * 3600 * 1000;

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

        // Bắt buộc nến phải nằm trong phạm vi dung sai thời gian hợp lý
        // Nếu dataset chưa chạm tới thời điểm này, trả về null
        if (best != null && minDiff <= maxToleranceMs) {
          return best.close;
        }
        return null;
      };

      forwardReactions.price1h = findPriceAtTime(endTime + ONE_HOUR, 45 * 60 * 1000);
      forwardReactions.price4h = findPriceAtTime(endTime + FOUR_HOURS, 90 * 60 * 1000);
      forwardReactions.price12h = findPriceAtTime(endTime + TWELVE_HOURS, 3 * 3600 * 1000);

      // Tính tỷ lệ thoái lui (Retracement %) dựa trên giá nến mới nhất có được sau cú giật
      const latestPostPrice = forwardReactions.price4h ?? forwardReactions.price1h;
      if (latestPostPrice != null && startPrice !== endPrice) {
        const totalImpulse = endPrice - startPrice;
        if (direction === 'PUMP') {
          // Thoái lui của PUMP = (endPrice - latestPostPrice) / (endPrice - startPrice) * 100
          forwardReactions.retracementPercent = ((endPrice - latestPostPrice) / totalImpulse) * 100;
        } else {
          // Thoái lui của DUMP = (latestPostPrice - endPrice) / (startPrice - endPrice) * 100
          forwardReactions.retracementPercent = ((latestPostPrice - endPrice) / Math.abs(totalImpulse)) * 100;
        }

        // Đánh giá xu hướng tiếp diễn: thoái lui < 35% -> Tiếp diễn (Continuation); > 65% -> Đảo chiều/Hấp thụ (Reversal/Trap)
        if (forwardReactions.retracementPercent <= 35) {
          forwardReactions.trendContinuation = 'CONTINUATION_CONFIRMED';
        } else if (forwardReactions.retracementPercent >= 70) {
          forwardReactions.trendContinuation = 'MEAN_REVERSION_OR_TRAP';
        } else {
          forwardReactions.trendContinuation = 'CONSOLIDATION';
        }
      } else if (candidatesAfter.length > 0) {
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
    const isHeavyRetracement = forwardReactions.retracementPercent != null && forwardReactions.retracementPercent > 70;

    if (hasMacro) {
      mechanismHypothesis = 'MACRO_NEWS_REACTION';
      const ev = matchingCalendarEvents.find(e => e.impact === 'HIGH') || matchingCalendarEvents[0];
      mechanismExplanation = `Phản ứng dữ dội trước tin tức/sự kiện vĩ mô: "${ev.title}".`;
      confidence = 'HIGH';
    } else if (isHeavyRetracement) {
      mechanismHypothesis = 'ABSORPTION_TRAP';
      mechanismExplanation = direction === 'PUMP'
        ? 'Bẫy tăng giá (Bull Trap) - Lực mua bị chặn bởi tường xả Limit Sell, giá bị kéo ngược > 70%.'
        : 'Bẫy giảm giá (Bear Trap) - Quét thanh lý đáy rồi được hấp thụ gom hàng ngược lại.';
      confidence = 'HIGH';
    } else if (direction === 'PUMP' && isOiDecreasing) {
      mechanismHypothesis = 'SHORT_SQUEEZE';
      mechanismExplanation = 'Phe Short bị ép thanh lý hoặc cắt lỗ hàng loạt khiến OI sụt giảm mạnh trong khi giá giật tăng dựng đứng.';
      confidence = 'HIGH';
    } else if (direction === 'DUMP' && isOiDecreasing) {
      mechanismHypothesis = 'LONG_LIQUIDATION_CASCADE';
      mechanismExplanation = 'Thanh lý dây chuyền các vị thế Long đòn bẩy cao, khiến OI bốc hơi nhanh chóng cùng nhịp rơi giá.';
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

    return {
      ...move,
      rank: rankIndex + 1,
      startTimeVn: formatIsoVn(startTime),
      endTimeVn: formatIsoVn(endTime),
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
 * @param {Object} context Bối cảnh bổ sung
 * @returns {string} Chuỗi Markdown chi tiết cho AI
 */
export function formatForensicsPayloadForAi(moves24h = [], moves7d = [], context = {}) {
  const parts = [];

  parts.push(`## DỮ LIỆU GIẢI PHẪU BIẾN ĐỘNG GIÁ (MOVE FORENSICS & MICROSTRUCTURE DATA)`);
  parts.push(`*Dữ liệu ghi nhận từ Binance Klines (15m cho 24h, 1h cho 7d), kết hợp Taker CVD, Open Interest, L/S Ratio và sự kiện vĩ mô.*`);
  parts.push('');

  // 1. TOP 3 TRONG 24H
  parts.push(`### 1. TOP 3 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 24H QUA (NẾN 15M)`);
  if (!moves24h || moves24h.length === 0) {
    parts.push(`- *Không ghi nhận biến động đột biến nào vượt ngưỡng trong 24h qua.*`);
  } else {
    parts.push(`| # | Thời gian (GMT+7) | Hướng | Giá Bắt Đầu -> Đích | Biên Độ | Taker CVD Delta | Δ OI | L/S | Cơ Chế Giả Thuyết |`);
    parts.push(`|---|---|---|---|---|---|---|---|---|`);

    moves24h.forEach((m, idx) => {
      const dirIcon = m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP';
      const rangeStr = `${formatUsd(m.startPrice, 0)} -> ${formatUsd(m.endPrice, 0)}`;
      const pctStr = `${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%`;
      const cvdStr = formatCompactUsd(m.takerCvdDelta);
      const oiStr = m.oiDeltaPercent != null ? `${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%` : 'N/A';
      const lsStr = m.lsRatio != null ? m.lsRatio.toFixed(2) : 'N/A';
      parts.push(`| ${idx + 1} | ${m.startTimeVn} | ${dirIcon} | ${rangeStr} | **${pctStr}** | ${cvdStr} | ${oiStr} | ${lsStr} | **${m.mechanismHypothesis}** |`);
    });

    parts.push('');
    parts.push(`**Chi tiết vi cấu trúc từng cú giật 24h:**`);
    moves24h.forEach((m, idx) => {
      parts.push(`- **Cú giật #${idx + 1} (${m.direction} ${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%):**`);
      parts.push(`  - *Thời điểm diễn ra:* Từ ${m.startTimeVn} đến ${m.endTimeVn} (${m.candleCount} nến 15m).`);
      parts.push(`  - *Biên độ giá:* Bắt đầu tại ${formatUsd(m.startPrice)}, chạm cực đại ${formatUsd(m.direction === 'PUMP' ? m.highPrice : m.lowPrice)}, kết thúc tại ${formatUsd(m.endPrice)}.`);
      parts.push(`  - *Khối lượng & Dòng lệnh:* Quote Vol: ${formatCompactUsd(m.quoteVolume)} | Taker CVD Delta: **${formatCompactUsd(m.takerCvdDelta)}**.`);
      parts.push(`  - *Biến động Open Interest:* ${m.oiBefore != null ? `${m.oiBefore.toLocaleString()} -> ${m.oiAfter.toLocaleString()} BTC (${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%)` : 'Chưa có chuỗi lịch sử OI'}.`);
      parts.push(`  - *Phản ứng sau cú giật:* Sau 1h: ${formatUsd(m.forwardReactions?.price1h)} | Sau 4h: ${formatUsd(m.forwardReactions?.price4h)} | Tỷ lệ thoái lui (Retracement): **${m.forwardReactions?.retracementPercent != null ? `${m.forwardReactions.retracementPercent.toFixed(1)}%` : 'N/A'}** (${m.forwardReactions?.trendContinuation || 'N/A'}).`);
      if (m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0) {
        parts.push(`  - *Sự kiện vĩ mô trùng khớp:* ${m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title} (${e.country})`).join('; ')}.`);
      }
      parts.push(`  - *Nhận định cơ chế:* **${m.mechanismHypothesis}** — ${m.mechanismExplanation}`);
    });
  }

  parts.push('');

  // 2. TOP 5 TRONG 7D
  parts.push(`### 2. TOP 5 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 7 NGÀY QUA (NẾN 1H)`);
  if (!moves7d || moves7d.length === 0) {
    parts.push(`- *Không ghi nhận biến động đột biến nào trong 7 ngày qua.*`);
  } else {
    parts.push(`| # | Thời gian (GMT+7) | Hướng | Giá Bắt Đầu -> Đích | Biên Độ | Taker CVD Delta | Δ OI | L/S | Phản Ứng Sau Đợt | Cơ Chế Giả Thuyết |`);
    parts.push(`|---|---|---|---|---|---|---|---|---|---|`);

    moves7d.forEach((m, idx) => {
      const dirIcon = m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP';
      const rangeStr = `${formatUsd(m.startPrice, 0)} -> ${formatUsd(m.endPrice, 0)}`;
      const pctStr = `${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%`;
      const cvdStr = formatCompactUsd(m.takerCvdDelta);
      const oiStr = m.oiDeltaPercent != null ? `${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%` : 'N/A';
      const lsStr = m.lsRatio != null ? m.lsRatio.toFixed(2) : 'N/A';
      const reactStr = m.forwardReactions?.trendContinuation || 'N/A';
      parts.push(`| ${idx + 1} | ${m.startTimeVn} | ${dirIcon} | ${rangeStr} | **${pctStr}** | ${cvdStr} | ${oiStr} | ${lsStr} | ${reactStr} | **${m.mechanismHypothesis}** |`);
    });

    parts.push('');
    parts.push(`**Chi tiết vi cấu trúc từng cú giật 7d:**`);
    moves7d.forEach((m, idx) => {
      parts.push(`- **Đợt biến động #${idx + 1} (${m.direction} ${m.priceChangePercent >= 0 ? '+' : ''}${m.priceChangePercent.toFixed(2)}%):**`);
      parts.push(`  - *Thời điểm:* Từ ${m.startTimeVn} đến ${m.endTimeVn} (${m.candleCount} nến 1h).`);
      parts.push(`  - *Biên độ giá:* ${formatUsd(m.startPrice)} -> ${formatUsd(m.endPrice)} (Cao nhất: ${formatUsd(m.highPrice)} | Thấp nhất: ${formatUsd(m.lowPrice)}).`);
      parts.push(`  - *Taker CVD:* ${formatCompactUsd(m.takerCvdDelta)} | *Quote Vol:* ${formatCompactUsd(m.quoteVolume)}.`);
      if (m.oiDeltaPercent != null) {
        parts.push(`  - *Biến động Open Interest:* ${m.oiBefore != null ? `${m.oiBefore.toLocaleString()} -> ${m.oiAfter.toLocaleString()} BTC (${m.oiDeltaPercent >= 0 ? '+' : ''}${m.oiDeltaPercent.toFixed(2)}%)` : 'N/A'}.`);
      }
      if (m.lsRatio != null) {
        parts.push(`  - *Long/Short Ratio:* ${m.lsRatio.toFixed(2)}.`);
      }
      parts.push(`  - *Phản ứng sau cú giật (Retracement):* ${m.forwardReactions?.retracementPercent != null ? `${m.forwardReactions.retracementPercent.toFixed(1)}%` : 'N/A'} -> ${m.forwardReactions?.trendContinuation || 'N/A'}.`);
      parts.push(`  - *Cơ chế chủ đạo:* **${m.mechanismHypothesis}** — ${m.mechanismExplanation}`);
    });
  }

  parts.push('');
  parts.push(`---`);
  return parts.join('\n');
}

/**
 * Market Bias History & Price Comparison Service
 * 
 * Cung cấp dữ liệu chuỗi thời gian đối chiếu song song giữa Market Bias Score
 * và Giá Bitcoin (7D, 30D và Realtime Snapshots), kèm phân tích tương quan
 * Pearson (r) và thuật toán phát hiện phân kỳ (Divergence Detection).
 */

import { calculateMarketBias, toFiniteNumber } from './biasEngine.js';

/**
 * Format timestamp / Date thành định dạng hiển thị ngày DD/MM
 */
export function formatDayMonth(dateInput) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * Chuyển đổi định dạng ngày DD/MM/YY hoặc DD/MM/YYYY thành chuỗi YYYY-MM-DD để so sánh thứ tự
 */
export function toSortableDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return dateStr;
  const [d, m, y] = parts;
  const fullYear = y.length === 2 ? `20${y}` : y;
  return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Tính toán hệ số tương quan Pearson (r) giữa mảng Giá BTC và Bias Score
 * @param {Array<{btcPrice: number, biasScore: number}>} dataPoints
 * @returns {{r: number, label: string, color: string, strength: string}}
 */
export function calculateBiasPriceCorrelation(dataPoints) {
  if (!Array.isArray(dataPoints) || dataPoints.length < 2) {
    return {
      r: 0,
      label: 'Chưa đủ dữ liệu',
      color: 'var(--text-slate-400)',
      strength: 'INSUFFICIENT_DATA',
    };
  }

  const valid = dataPoints.filter(
    (p) => Number.isFinite(Number(p?.btcPrice)) && Number.isFinite(Number(p?.biasScore))
  );

  const n = valid.length;
  if (n < 2) {
    return {
      r: 0,
      label: 'Chưa đủ dữ liệu',
      color: 'var(--text-slate-400)',
      strength: 'INSUFFICIENT_DATA',
    };
  }

  const prices = valid.map((p) => Number(p.btcPrice));
  const scores = valid.map((p) => Number(p.biasScore));

  const meanP = prices.reduce((acc, v) => acc + v, 0) / n;
  const meanS = scores.reduce((acc, v) => acc + v, 0) / n;

  let num = 0;
  let denP = 0;
  let denS = 0;

  for (let i = 0; i < n; i++) {
    const diffP = prices[i] - meanP;
    const diffS = scores[i] - meanS;
    num += diffP * diffS;
    denP += diffP * diffP;
    denS += diffS * diffS;
  }

  const denominator = Math.sqrt(denP * denS);
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return {
      r: 0,
      label: 'Tách pha / Không đổi (r = 0.00)',
      color: 'var(--text-slate-400)',
      strength: 'NEUTRAL',
    };
  }

  const r = Math.max(-1, Math.min(1, num / denominator));
  const roundedR = Number(r.toFixed(2));

  if (roundedR >= 0.6) {
    return {
      r: roundedR,
      label: `Đồng pha mạnh (+${roundedR})`,
      color: '#10b981',
      strength: 'STRONG_POSITIVE',
    };
  }
  if (roundedR >= 0.2) {
    return {
      r: roundedR,
      label: `Đồng pha nhẹ (+${roundedR})`,
      color: '#34d399',
      strength: 'MODERATE_POSITIVE',
    };
  }
  if (roundedR > -0.2) {
    return {
      r: roundedR,
      label: `Tách pha / Độc lập (${roundedR >= 0 ? '+' : ''}${roundedR})`,
      color: 'var(--text-slate-400)',
      strength: 'NEUTRAL',
    };
  }
  if (roundedR > -0.6) {
    return {
      r: roundedR,
      label: `Phân kỳ nhẹ (${roundedR})`,
      color: '#f59e0b',
      strength: 'MODERATE_NEGATIVE',
    };
  }
  return {
    r: roundedR,
    label: `Phân kỳ mạnh ⚠ (${roundedR})`,
    color: '#f43f5e',
    strength: 'STRONG_NEGATIVE',
  };
}

/**
 * Phát hiện trạng thái Phân kỳ (Divergence) hoặc Xác nhận xu hướng (Confirmation)
 * giữa Giá BTC và Market Bias Score qua toàn bộ chuỗi (kết hợp cả mốc biên lẫn quét cực trị nội chuỗi)
 * @param {Array<{btcPrice: number, biasScore: number, timestamp?: number}>} dataPoints
 * @returns {Object}
 */
export function detectBiasPriceDivergence(dataPoints) {
  if (!Array.isArray(dataPoints) || dataPoints.length < 2) {
    return {
      type: 'INSUFFICIENT_DATA',
      label: 'Đang tích lũy dữ liệu',
      shortLabel: 'TÍCH LŨY DỮ LIỆU',
      color: 'var(--text-slate-400)',
      deltaPricePct: 0,
      deltaBias: 0,
      desc: 'Cần tối thiểu 2 mốc thời gian để so sánh phân kỳ.',
    };
  }

  const valid = dataPoints.filter(
    (p) => Number.isFinite(Number(p?.btcPrice)) && Number.isFinite(Number(p?.biasScore))
  );

  const n = valid.length;
  if (n < 2) {
    return {
      type: 'INSUFFICIENT_DATA',
      label: 'Đang tích lũy dữ liệu',
      shortLabel: 'TÍCH LŨY DỮ LIỆU',
      color: 'var(--text-slate-400)',
      deltaPricePct: 0,
      deltaBias: 0,
      desc: 'Cần tối thiểu 2 mốc thời gian để so sánh phân kỳ.',
    };
  }

  const first = valid[0];
  const last = valid[n - 1];

  const firstPrice = Number(first.btcPrice);
  const lastPrice = Number(last.btcPrice);
  const firstBias = Number(first.biasScore);
  const lastBias = Number(last.biasScore);

  const deltaPricePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const deltaBias = lastBias - firstBias;

  // 1. Kiểm tra biên tổng thể (Endpoint-to-Endpoint)
  const isPriceDown = deltaPricePct < -0.8;
  const isPriceUp = deltaPricePct > 0.8;
  const isBiasUp = deltaBias > 6;
  const isBiasDown = deltaBias < -6;

  // 1A. BULLISH DIVERGENCE (Biên ngoài): Giá giảm/đi ngang nhưng Bias Score tăng mạnh (Tích lũy ngầm)
  if (isPriceDown && isBiasUp) {
    return {
      type: 'BULLISH_DIVERGENCE',
      label: 'PHÂN KỲ DƯƠNG (BULLISH DIVERGENCE)',
      shortLabel: 'TÍCH LŨY NGẦM ▲',
      color: '#10b981',
      deltaPricePct,
      deltaBias,
      desc: `Giá BTC giảm (${deltaPricePct.toFixed(1)}%) nhưng Bias Score tăng mạnh (+${deltaBias.toFixed(0)} pt) — Dòng tiền định chế/on-chain đang gom ngầm.`,
    };
  }

  // 1B. BEARISH DIVERGENCE (Biên ngoài): Giá tăng nhưng Bias Score sụt giảm rõ rệt (Cảnh báo bull trap/phân phối)
  if (isPriceUp && isBiasDown) {
    return {
      type: 'BEARISH_DIVERGENCE',
      label: 'PHÂN KỲ ÂM (BEARISH DIVERGENCE)',
      shortLabel: 'CẢNH BÁO PHÂN PHỐI ▼',
      color: '#f43f5e',
      deltaPricePct,
      deltaBias,
      desc: `Giá BTC tăng (+${deltaPricePct.toFixed(1)}%) nhưng Bias Score suy giảm (${deltaBias.toFixed(0)} pt) — Cảnh báo rủi ro bẫy tăng giá (Bull trap).`,
    };
  }

  // 2. Quét cực trị nội chuỗi (Internal Peak/Trough Extrema Scan) cho chuỗi dài (>= 5 điểm)
  if (n >= 5) {
    let maxPriceIdx = 0;
    let minPriceIdx = 0;
    for (let i = 1; i < n; i++) {
      if (Number(valid[i].btcPrice) > Number(valid[maxPriceIdx].btcPrice)) maxPriceIdx = i;
      if (Number(valid[i].btcPrice) < Number(valid[minPriceIdx].btcPrice)) minPriceIdx = i;
    }

    const peakPrice = Number(valid[maxPriceIdx].btcPrice);
    const troughPrice = Number(valid[minPriceIdx].btcPrice);

    // Peak divergence: Giá tạo đỉnh cao mới (> +2%) nhưng Bias tại đỉnh suy yếu rõ rệt
    const peakPriceGain = firstPrice > 0 ? ((peakPrice - firstPrice) / firstPrice) * 100 : 0;
    const biasAtPeak = Number(valid[maxPriceIdx].biasScore);
    if (peakPriceGain > 2.0 && (biasAtPeak < firstBias - 8 || lastBias < firstBias - 10)) {
      return {
        type: 'BEARISH_DIVERGENCE',
        label: 'PHÂN KỲ ÂM (BEARISH DIVERGENCE)',
        shortLabel: 'CẢNH BÁO PHÂN PHỐI ▼',
        color: '#f43f5e',
        deltaPricePct,
        deltaBias,
        desc: `Giá BTC đạt đỉnh cao (+${peakPriceGain.toFixed(1)}%) nhưng mô hình Bias suy giảm — Cảnh báo rủi ro suy kiệt đà tăng (Bull trap).`,
      };
    }

    // Trough divergence: Giá giảm sâu (> -2%) nhưng Bias tại đáy giữ vững hoặc bật tăng
    const troughPriceDrop = firstPrice > 0 ? ((troughPrice - firstPrice) / firstPrice) * 100 : 0;
    const biasAtTrough = Number(valid[minPriceIdx].biasScore);
    if (troughPriceDrop < -2.0 && (biasAtTrough > firstBias + 8 || lastBias > firstBias + 10)) {
      return {
        type: 'BULLISH_DIVERGENCE',
        label: 'PHÂN KỲ DƯƠNG (BULLISH DIVERGENCE)',
        shortLabel: 'TÍCH LŨY NGẦM ▲',
        color: '#10b981',
        deltaPricePct,
        deltaBias,
        desc: `Giá BTC tạo đáy thấp (${troughPriceDrop.toFixed(1)}%) nhưng Bias Score duy trì tăng (+${(biasAtTrough - firstBias).toFixed(0)} pt) — Lực gom ngầm xuất hiện.`,
      };
    }
  }

  // 3. BULLISH CONFIRMED: Cả 2 cùng tăng mạnh đồng thuận
  if (isPriceUp && isBiasUp) {
    return {
      type: 'BULLISH_CONFIRMED',
      label: 'XÁC NHẬN TĂNG (TREND CONFIRMED)',
      shortLabel: 'ĐỒNG PHA TĂNG ▲',
      color: '#34d399',
      deltaPricePct,
      deltaBias,
      desc: `Cả Giá BTC (+${deltaPricePct.toFixed(1)}%) và Bias Score (+${deltaBias.toFixed(0)} pt) đều đồng thuận tăng trưởng lành mạnh.`,
    };
  }

  // 4. BEARISH CONFIRMED: Cả 2 cùng giảm đồng thuận
  if (isPriceDown && isBiasDown) {
    return {
      type: 'BEARISH_CONFIRMED',
      label: 'XÁC NHẬN GIẢM (TREND CONFIRMED)',
      shortLabel: 'ĐỒNG PHA GIẢM ▼',
      color: '#f87171',
      deltaPricePct,
      deltaBias,
      desc: `Cả Giá BTC (${deltaPricePct.toFixed(1)}%) và Bias Score (${deltaBias.toFixed(0)} pt) đều đồng thuận chịu áp lực giảm.`,
    };
  }

  // 5. NEUTRAL / BALANCED
  return {
    type: 'NEUTRAL',
    label: 'TRUNG LẬP / CÂN BẰNG',
    shortLabel: 'CÂN BẰNG ⚖',
    color: 'var(--text-slate-400)',
    deltaPricePct,
    deltaBias,
    desc: `Biến động giá (${deltaPricePct >= 0 ? '+' : ''}${deltaPricePct.toFixed(1)}%) và Bias Score (${deltaBias >= 0 ? '+' : ''}${deltaBias.toFixed(0)} pt) trong biên độ cân bằng.`,
  };
}

/**
 * Dựng chuỗi dữ liệu Daily Checkpoint lịch sử (7D, 30D) từ nến ngày và các chỉ báo thành phần,
 * TUÂN THỦ NGUYÊN TẮC NHÂN QUẢ (Không Look-ahead leakage).
 * @param {Object} dashboardData
 * @param {Array} etfHistory
 * @param {number} days (7 hoặc 30)
 * @returns {Array<Object>}
 */
export function buildDailyBiasHistory(dashboardData, etfHistory = [], days = 30) {
  if (!dashboardData) return [];

  const rawKlines = dashboardData.btcDailyKlinesAll ?? dashboardData.dailyKlines ?? dashboardData.klines;
  if (!Array.isArray(rawKlines) || rawKlines.length < 2) {
    return [];
  }

  const count = Math.min(days, rawKlines.length);
  const startIndex = rawKlines.length - count;
  const slicedKlines = rawKlines.slice(startIndex);

  // Chuẩn hóa ETF rows kèm sortable date
  const processedEtf = Array.isArray(etfHistory)
    ? etfHistory.map((item) => ({
        ...item,
        _sortableDate: toSortableDateStr(item?.date),
      }))
    : [];

  const result = [];

  for (let idx = 0; idx < slicedKlines.length; idx++) {
    const kline = slicedKlines[idx];
    const rawTime = kline.time ?? kline[0];
    const candleDate = rawTime instanceof Date ? rawTime : new Date(rawTime);
    const closePrice = toFiniteNumber(kline.close ?? kline[4]);
    const isLast = idx === slicedKlines.length - 1;

    // 1. Slices klines up to current historical day (Không dùng nến tương lai)
    const historyUpToCandle = rawKlines.slice(0, startIndex + idx + 1);

    // 2. Cắt ETF History đúng theo mốc thời gian của nến ngày (Không look-ahead)
    const candleIso = candleDate.toISOString().slice(0, 10);
    const etfUpToDay = processedEtf.filter((item) => item._sortableDate && item._sortableDate <= candleIso);

    // 3. Chuẩn bị CVD points up to current day nếu dữ liệu là dạng mảng points
    let cvd30dSpotForDay = dashboardData.cvdHistory30dSpot;
    let cvd30dForDay = dashboardData.cvdHistory30d;

    if (dashboardData.cvdHistory30dSpot?.points && Array.isArray(dashboardData.cvdHistory30dSpot.points)) {
      const allPoints = dashboardData.cvdHistory30dSpot.points;
      const targetLen = Math.max(1, allPoints.length - (count - 1 - idx));
      cvd30dSpotForDay = { ...dashboardData.cvdHistory30dSpot, points: allPoints.slice(0, targetLen) };
    }

    if (dashboardData.cvdHistory30d?.points && Array.isArray(dashboardData.cvdHistory30d.points)) {
      const allPoints = dashboardData.cvdHistory30d.points;
      const targetLen = Math.max(1, allPoints.length - (count - 1 - idx));
      cvd30dForDay = { ...dashboardData.cvdHistory30d, points: allPoints.slice(0, targetLen) };
    }

    // 4. Tạo snapshot dữ liệu giả lập cho ngày idx
    const mockDataForDay = {
      ...dashboardData,
      btcDailyKlinesAll: historyUpToCandle,
      cvdHistory30dSpot: cvd30dSpotForDay,
      cvdHistory30d: cvd30dForDay,
      btc: {
        ...(dashboardData.btc || {}),
        price: closePrice,
      },
    };

    // Nếu là ngày cuối cùng (hôm nay), dùng trực tiếp kết quả bias hiện tại nếu có
    let biasResult;
    if (isLast && dashboardData.bias?.score != null) {
      biasResult = dashboardData.bias;
    } else {
      biasResult = calculateMarketBias(mockDataForDay, etfUpToDay, {
        livePrice: closePrice,
        referenceTime: candleDate.getTime(),
      });
    }

    result.push({
      timestamp: candleDate.getTime(),
      dateStr: formatDayMonth(candleDate),
      fullDateStr: candleDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      btcPrice: closePrice,
      biasScore: Math.round(biasResult.score),
      confidence: Math.round(biasResult.confidence),
      label: biasResult.label,
      color: biasResult.color,
      isLive: isLast,
    });
  }

  return result;
}

/**
 * Lấy toàn bộ series đối chiếu theo timeframe đã chọn: '7d', '30d' hoặc 'realtime'
 * @param {Object} params
 * @param {'7d'|'30d'|'realtime'} params.timeframe
 * @param {Object} params.dashboardData
 * @param {Array} params.etfHistory
 * @param {Array} params.liveSnapshots
 * @returns {{
 *   series: Array,
 *   correlation: Object,
 *   divergence: Object,
 *   timeframe: string,
 *   hasData: boolean
 * }}
 */
export function getBiasComparisonSeries({
  timeframe = '7d',
  dashboardData,
  etfHistory = [],
  liveSnapshots = [],
}) {
  let series = [];

  if (timeframe === 'realtime') {
    if (Array.isArray(liveSnapshots) && liveSnapshots.length > 0) {
      series = liveSnapshots
        .filter((s) => Number.isFinite(Number(s.btcPrice)) && Number.isFinite(Number(s.biasScore)))
        .map((s) => ({
          timestamp: s.timestamp,
          dateStr: s.timeStr || formatDayMonth(s.timestamp),
          fullDateStr: `${s.dateStr || ''} ${s.timeStr || ''}`.trim(),
          btcPrice: Number(s.btcPrice),
          biasScore: Number(s.biasScore),
          confidence: Number(s.confidence ?? 0),
          label: s.confirmationLabel || 'Realtime',
          color: Number(s.biasScore) > 10 ? '#34d399' : Number(s.biasScore) < -10 ? '#f87171' : '#94a3b8',
          isLive: true,
        }));
    }
  } else {
    const days = timeframe === '30d' ? 30 : 7;
    series = buildDailyBiasHistory(dashboardData, etfHistory, days);
  }

  const correlation = calculateBiasPriceCorrelation(series);
  const divergence = detectBiasPriceDivergence(series);

  return {
    timeframe,
    series,
    correlation,
    divergence,
    hasData: series.length >= 2,
  };
}

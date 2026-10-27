/**
 * Pure calculation engine for Multi-Asset Rolling Correlation Matrix (30D / 90D).
 * Handles alignment between 24/7 Crypto and Monday-Friday TradFi calendar dates.
 * NO React dependencies, NO network side effects.
 */

export const CORRELATION_ASSETS = ['BTC', 'ETH', 'SOL', 'SPX', 'DXY', 'GOLD', 'US10Y'];
export const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL'];
export const MACRO_ASSETS = ['SPX', 'DXY', 'GOLD', 'US10Y'];

export const ASSET_METADATA = {
  BTC: { name: 'Bitcoin', category: 'Crypto', color: '#F7931A' },
  ETH: { name: 'Ethereum', category: 'Crypto', color: '#627EEA' },
  SOL: { name: 'Solana', category: 'Crypto', color: '#14F195' },
  SPX: { name: 'S&P 500', category: 'Equities', color: '#38BDF8' },
  DXY: { name: 'US Dollar Index', category: 'Currency', color: '#818CF8' },
  GOLD: { name: 'Gold Spot', category: 'Commodity', color: '#FBBF24' },
  US10Y: { name: 'US 10Y Yield', category: 'Rates', color: '#F43F5E' },
};

/**
 * Normalizes input date to 'YYYY-MM-DD'
 * @param {string|number|Date} dateInput
 * @returns {string|null}
 */
export function normalizeDateStr(dateInput) {
  if (!dateInput) return null;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Computes daily change series from raw chronological price series.
 *
 * @param {Array<{ date: string|number, close: number }>} series - Raw prices
 * @param {'pct'|'diff'} [mode='pct'] - 'pct' for returns, 'diff' for basis points/levels
 * @returns {Array<{ date: string, change: number, close: number }>}
 */
export function computeDailyChanges(series, mode = 'pct') {
  if (!Array.isArray(series) || series.length < 2) return [];

  // Normalize, deduplicate by date, and sort ascending
  const map = new Map();
  for (const item of series) {
    if (!item) continue;
    const dateStr = normalizeDateStr(item.date || item.time || item.timestamp);
    const close = Number(item.close != null ? item.close : item.price);
    if (dateStr && Number.isFinite(close) && close > 0) {
      map.set(dateStr, close);
    }
  }

  const sortedDates = Array.from(map.keys()).sort();
  const results = [];

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const prevClose = map.get(prevDate);
    const currClose = map.get(currDate);

    let change = 0;
    if (mode === 'diff') {
      change = currClose - prevClose;
    } else {
      change = (currClose - prevClose) / prevClose;
    }

    results.push({
      date: currDate,
      change,
      close: currClose,
    });
  }

  return results;
}

/**
 * Computes Pearson correlation coefficient between two numeric series of equal length.
 *
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} [minSamples=15]
 * @returns {number|null} Pearson r in range [-1, 1], or null if insufficient data / zero variance
 */
export function pearsonCorrelation(xs, ys, minSamples = 15) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < minSamples) {
    return null;
  }

  const n = xs.length;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sumX += x;
    sumY += y;
  }

  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den === 0) return null;

  const r = num / den;
  return Math.max(-1, Math.min(1, Number(r.toFixed(4))));
}

/**
 * Aligns two daily change series by exact calendar date intersection (Inner Join).
 * This eliminates the weekend attenuation bias between 24/7 Crypto and Mon-Fri TradFi.
 *
 * @param {Array<{ date: string, change: number }>} changesA
 * @param {Array<{ date: string, change: number }>} changesB
 * @param {number} [windowDays=30]
 * @returns {{ xs: number[], ys: number[], dates: string[] }}
 */
export function alignSeriesPair(changesA, changesB, windowDays = 30) {
  if (!Array.isArray(changesA) || !Array.isArray(changesB)) {
    return { xs: [], ys: [], dates: [] };
  }

  const mapA = new Map(changesA.map((c) => [c.date, c.change]));
  const mapB = new Map(changesB.map((c) => [c.date, c.change]));

  // Find common dates
  const commonDates = [];
  for (const date of mapA.keys()) {
    if (mapB.has(date)) {
      commonDates.push(date);
    }
  }

  // Sort descending to get the most recent N sessions, then take windowDays
  commonDates.sort().reverse();
  const selectedDates = commonDates.slice(0, windowDays).reverse();

  const xs = selectedDates.map((d) => mapA.get(d));
  const ys = selectedDates.map((d) => mapB.get(d));

  return { xs, ys, dates: selectedDates };
}

/**
 * Generates an institutional narrative based on BTC's correlations with Macro assets.
 */
export function generateCorrelationNarrative(matrix, windowDays = 30) {
  const btcSpc = matrix?.BTC?.SPX;
  const btcDxy = matrix?.BTC?.DXY;
  const btcGold = matrix?.BTC?.GOLD;
  const btc10y = matrix?.BTC?.US10Y;

  const points = [];

  // 1. Equities (SPX)
  if (btcSpc != null) {
    if (btcSpc >= 0.5) {
      points.push(`Đồng pha chặt chẽ với S&P 500 (+${btcSpc.toFixed(2)}) phản ánh cơ chế Risk-On truyền thống chi phối dòng vốn.`);
    } else if (btcSpc <= -0.3) {
      points.push(`Nghịch pha với S&P 500 (${btcSpc.toFixed(2)}), Crypto đang phản ứng độc lập với chứng khoán Mỹ.`);
    } else {
      points.push(`Tương quan thấp với S&P 500 (${btcSpc >= 0 ? '+' : ''}${btcSpc.toFixed(2)}) báo hiệu trạng thái tách rời (Decoupling) tạm thời.`);
    }
  }

  // 2. US Dollar (DXY)
  if (btcDxy != null) {
    if (btcDxy <= -0.4) {
      points.push(`Nghịch pha mạnh với DXY (${btcDxy.toFixed(2)}) xác nhận sự phụ thuộc cao vào chu kỳ nới lỏng thanh khoản toàn cầu.`);
    } else if (btcDxy >= 0.3) {
      points.push(`Biến động cùng chiều bất thường với DXY (+${btcDxy.toFixed(2)}), cho thấy dòng tiền trú ẩn đang tìm đến cả USD và BTC.`);
    } else {
      points.push(`Tác động của đồng USD ở mức trung tính (${btcDxy >= 0 ? '+' : ''}${btcDxy.toFixed(2)}).`);
    }
  }

  // 3. Gold (GOLD)
  if (btcGold != null) {
    if (btcGold >= 0.4) {
      points.push(`Đồng pha với Vàng (+${btcGold.toFixed(2)}), củng cố luận điểm tài sản lưu trữ giá trị (Digital Gold / Hard Asset).`);
    } else if (btcGold <= -0.3) {
      points.push(`Nghịch pha với Vàng (${btcGold.toFixed(2)}), BTC thiên về tài sản công nghệ rủi ro cao hơn là vàng số.`);
    }
  }

  // 4. Rates (US10Y)
  if (btc10y != null && Math.abs(btc10y) >= 0.3) {
    if (btc10y < 0) {
      points.push(`Nhạy cảm tiêu cực với lợi suất TP Mỹ 10Y (${btc10y.toFixed(2)}), áp lực chi phí vốn gia tăng khi lợi suất tăng.`);
    } else {
      points.push(`Đồng pha với lợi suất 10Y (+${btc10y.toFixed(2)}), thị trường chấp nhận lãi suất cao trong bối cảnh tăng trưởng kinh tế.`);
    }
  }

  if (points.length === 0) {
    return `Đang tính toán ma trận tương quan ${windowDays} ngày giữa Crypto và tài sản vĩ mô...`;
  }

  return points.join(' ');
}

/**
 * Builds the full 7×7 rolling correlation matrix and Crypto vs Macro summary table.
 *
 * @param {Object.<string, Array<{ date: string, close: number }>>} seriesMap - Map of raw price series
 * @param {number} [windowDays=30] - Rolling window length (30 or 90)
 * @returns {Object} Complete correlation matrix dataset
 */
export function buildCorrelationMatrix(seriesMap = {}, windowDays = 30) {
  const assets = CORRELATION_ASSETS;
  const changesMap = {};

  // Pre-calculate daily change series for all provided assets
  for (const asset of assets) {
    const raw = seriesMap[asset] || [];
    changesMap[asset] = computeDailyChanges(raw, asset === 'US10Y' ? 'diff' : 'pct');
  }

  const matrix = {};
  const sampleCounts = {};

  // Initialize matrix
  for (const a of assets) {
    matrix[a] = {};
    const validSamples = changesMap[a]?.length || 0;
    for (const b of assets) {
      if (a === b) {
        if (validSamples >= 15) {
          matrix[a][b] = 1.0;
          sampleCounts[`${a}_${b}`] = validSamples;
        } else {
          matrix[a][b] = null;
          sampleCounts[`${a}_${b}`] = validSamples;
        }
      } else {
        matrix[a][b] = null;
      }
    }
  }

  // Compute upper triangular & mirror to lower
  for (let i = 0; i < assets.length; i++) {
    const assetA = assets[i];
    const chA = changesMap[assetA];

    for (let j = i + 1; j < assets.length; j++) {
      const assetB = assets[j];
      const chB = changesMap[assetB];

      const { xs, ys, dates } = alignSeriesPair(chA, chB, windowDays);
      const r = pearsonCorrelation(xs, ys, 15);

      matrix[assetA][assetB] = r;
      matrix[assetB][assetA] = r;
      sampleCounts[`${assetA}_${assetB}`] = dates.length;
      sampleCounts[`${assetB}_${assetA}`] = dates.length;
    }
  }

  // Build Crypto vs Macro focused subtable (3x4)
  const cryptoVsMacro = CRYPTO_ASSETS.map((crypto) => {
    const macroRow = {};
    for (const macro of MACRO_ASSETS) {
      macroRow[macro] = {
        r: matrix[crypto]?.[macro] ?? null,
        count: sampleCounts[`${crypto}_${macro}`] ?? 0,
      };
    }
    return {
      crypto,
      macroCorrelations: macroRow,
    };
  });

  const narrative = generateCorrelationNarrative(matrix, windowDays);

  return {
    windowDays,
    assets,
    cryptoAssets: CRYPTO_ASSETS,
    macroAssets: MACRO_ASSETS,
    matrix,
    sampleCounts,
    cryptoVsMacro,
    narrative,
    timestamp: Date.now(),
  };
}

export const calculateCorrelationMatrix = buildCorrelationMatrix;
export const ASSET_KEYS = CORRELATION_ASSETS;


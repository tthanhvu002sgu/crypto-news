/**
 * Real-time Bias Snapshot Provenance Store
 * 
 * Lưu trữ lịch sử snapshot thực tế của Market Bias Score và BTC Price
 * tại thời điểm phát sinh thực tế.
 * 
 * NGUYÊN TẮC BẢO TOÀN PROVENANCE:
 * 1. Tuyệt đối KHÔNG dựng lại (backfill) bias score quá khứ bằng dữ liệu hiện tại
 *    để loại bỏ hoàn toàn look-ahead bias.
 * 2. Chỉ ghi nhận snapshot khi ứng dụng chạy thời gian thực với dữ liệu hợp lệ.
 * 3. Mỗi snapshot lưu kèm timestamp, BTC price, 24h change, bias score, confidence,
 *    confirmation state và data oldest freshness.
 */

const STORAGE_KEY = 'crypto_market_bias_snapshots_v1';
const MAX_SNAPSHOTS = 500;
const MIN_RECORD_INTERVAL_MS = 60 * 1000; // Tối thiểu 1 phút giữa 2 lần ghi để tránh spam

/**
 * Kiểm tra xem môi trường có hỗ trợ localStorage không
 */
function isLocalStorageAvailable() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const testKey = '__test_ls__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lấy toàn bộ danh sách snapshots đã lưu trong localStorage
 */
export function getBiasSnapshots(maxLimit = 100) {
  if (!isLocalStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-maxLimit);
  } catch (err) {
    console.warn('[biasSnapshotStore] Failed to read snapshots:', err);
    return [];
  }
}

/**
 * Ghi nhận một snapshot thời gian thực mới
 * @param {Object} data
 * @param {number} data.btcPrice
 * @param {number} [data.btcChange24h]
 * @param {number} data.biasScore
 * @param {number} [data.confidence]
 * @param {string} [data.confirmationState]
 * @param {string} [data.confirmationLabel]
 * @param {string} [data.oldestSource]
 * @param {string} [data.regimeTrend]
 * @returns {Object|null} snapshot object nếu ghi thành công, null nếu bỏ qua
 */
export function recordBiasSnapshot(data) {
  if (!data || typeof data !== 'object') return null;
  const btcPrice = Number(data.btcPrice);
  const biasScore = Number(data.biasScore);

  if (!Number.isFinite(btcPrice) || btcPrice <= 0 || !Number.isFinite(biasScore)) {
    return null;
  }

  if (!isLocalStorageAvailable()) return null;

  try {
    const existing = getBiasSnapshots(MAX_SNAPSHOTS);
    const now = Date.now();

    // Throttling: Nếu snapshot gần nhất cách chưa tới MIN_RECORD_INTERVAL_MS và giá/score không đổi đáng kể, bỏ qua
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      const timeDiff = now - (last.timestamp || 0);
      const priceDiffRatio = Math.abs(btcPrice - last.btcPrice) / last.btcPrice;
      const scoreDiff = Math.abs(biasScore - last.biasScore);

      if (timeDiff < MIN_RECORD_INTERVAL_MS && priceDiffRatio < 0.001 && scoreDiff === 0) {
        return null;
      }
    }

    const newSnapshot = {
      id: `snap_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      timeStr: new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      dateStr: new Date(now).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      btcPrice,
      btcChange24h: Number(data.btcChange24h ?? 0),
      biasScore,
      confidence: Number(data.confidence ?? 0),
      confirmationState: data.confirmationState || 'NEUTRAL_ALIGNED',
      confirmationLabel: data.confirmationLabel || 'Trung lập',
      oldestSource: data.oldestSource || 'Live',
      regimeTrend: data.regimeTrend || 'UNKNOWN',
      isRealtime: true,
    };

    const updated = [...existing, newSnapshot].slice(-MAX_SNAPSHOTS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return newSnapshot;
  } catch (err) {
    console.warn('[biasSnapshotStore] Failed to record snapshot:', err);
    return null;
  }
}

/**
 * Xóa toàn bộ snapshots đã lưu (chỉ dùng cho tests hoặc reset người dùng)
 */
export function clearBiasSnapshots() {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[biasSnapshotStore] Failed to clear snapshots:', err);
  }
}

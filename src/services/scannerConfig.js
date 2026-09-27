/**
 * Scanner v9: Configuration and Constants
 * Asset Ranking Engine across 24H / 7D / 30D
 * 4 Pillars: RS (40%), Flow & Derivatives (25%), Fundamentals (25%), Liquidity (10%)
 */

export const SCANNER_SCHEMA_VERSION = 'v9.0.0';
export const SCANNER_MODEL_VERSION = 'v1.0.0';
export const SCANNER_VERSION = 'v9';
export const CONFIG_VERSION = 'v9.0.0';

export const DATA_BRANCH = 'codex/scanner-data';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/tthanhvu002sgu/crypto-news';

export const MANIFEST_STORAGE_KEY = 'crypto_scanner_v9_manifest';
export const SNAPSHOT_CACHE_KEY_PREFIX = 'crypto_scanner_v9_snapshot_';
export const SNAPSHOT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes in browser memory/localStorage

export const STALE_SNAPSHOT_THRESHOLD_HOURS = 36;

export const WINDOWS = ['24h', '7d', '30d'];
export const DEFAULT_WINDOW = '7d';

export const WINDOW_LABELS = {
  '24h': '24H',
  '7d': '7D',
  '30d': '30D',
};

export const WINDOW_TITLES = {
  '24h': '24 Giờ (1 Ngày)',
  '7d': '7 Ngày',
  '30d': '30 Ngày',
};

export const PILLAR_WEIGHTS = {
  rs: 0.40,
  flow: 0.25,
  fundamentals: 0.25,
  liquidity: 0.10,
};

export const PILLAR_LABELS = {
  rs: 'Relative Strength',
  flow: 'Dòng tiền & Phái sinh',
  fundamentals: 'Fundamentals',
  liquidity: 'Thanh khoản',
};

export const FLOW_LABELS = {
  SPOT_SUPPORTED: 'SPOT_SUPPORTED',
  DERIVATIVES_DOMINATED: 'DERIVATIVES_DOMINATED',
  SHORT_COVERING: 'SHORT_COVERING',
  MIXED_OR_INSUFFICIENT: 'MIXED_OR_INSUFFICIENT',
};

export const FLOW_LABEL_TEXTS = {
  SPOT_SUPPORTED: 'Spot hỗ trợ',
  DERIVATIVES_DOMINATED: 'Phái sinh chi phối',
  SHORT_COVERING: 'Có dấu hiệu short covering',
  MIXED_OR_INSUFFICIENT: 'Hỗn hợp/chưa đủ dữ liệu',
};

export const FLOW_LABEL_DESCRIPTIONS = {
  SPOT_SUPPORTED: 'Giá tăng kèm Spot CVD dương; dòng tiền mua giao ngay chủ động tích lũy.',
  DERIVATIVES_DOMINATED: 'Giá tăng kèm Futures CVD và lượng OI tăng, nhưng Spot CVD không dương; vị thế phái sinh chi phối nhịp kéo.',
  SHORT_COVERING: 'Giá tăng, Futures CVD dương nhưng lượng OI giảm; vị thế Short đóng lệnh cắt lỗ/chốt lời.',
  MIXED_OR_INSUFFICIENT: 'Dòng tiền hỗn hợp, giá giảm hoặc chưa đủ điều kiện phân loại rõ ràng.',
};

export const SECTOR_OPTIONS = [
  { value: 'ALL', label: 'Tất cả Sectors' },
  { value: 'L1', label: 'Layer 1' },
  { value: 'L2', label: 'Layer 2' },
  { value: 'DeFi', label: 'DeFi' },
  { value: 'DePIN', label: 'DePIN' },
  { value: 'AI', label: 'AI & Data' },
  { value: 'RWA', label: 'RWA' },
  { value: 'Meme', label: 'Meme' },
  { value: 'Infra', label: 'Infra' },
  { value: 'Payments', label: 'Payments' },
];

export const STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'COMPLETE', label: 'Đủ 4 trụ cột' },
  { value: 'INCOMPLETE', label: 'Thiếu dữ liệu' },
];

export const SORT_FIELDS = {
  RANK: 'rank',
  SCORE: 'score',
  DELTA_SCORE: 'deltaScore',
  DELTA_RANK: 'deltaRank',
  RS_BTC: 'rsBtc',
  RS_ETH: 'rsEth',
  SPOT_FLOW: 'spotFlowPressure',
  VOLUME: 'quoteVolume',
  COMPLETENESS: 'completeness',
};

export const METHODOLOGY_DISCLAIMERS = [
  'Dữ liệu dòng tiền CVD & OI là dữ liệu khớp lệnh trên Binance, không đại diện cho toàn bộ thanh khoản liên sàn.',
  'Chỉ số Relative Strength (RS) đo lường hiệu suất tương đối so với BTC/ETH, không đồng nghĩa loại bỏ rủi ro thị trường chung.',
  'Nhãn dòng tiền và điểm xếp hạng là quan sát định lượng khách quan; không phải khuyến nghị đầu tư hoặc cam kết xác suất tăng giá.',
  'Dữ liệu phân tích chỉ sử dụng các nến ngày UTC đã đóng hoàn chỉnh (00:00 UTC) để ngăn ngừa hoàn toàn look-ahead bias.',
];

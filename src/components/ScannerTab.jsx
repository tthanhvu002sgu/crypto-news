import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  loadScannerManifest,
  loadDailySnapshot,
  findPriorSnapshotDates,
  hydrateAssetsWithTracking,
  exportScannerCsv,
  exportScannerJson,
  triggerFileDownload,
  isSnapshotStale,
  WINDOWS,
  DEFAULT_WINDOW,
  WINDOW_LABELS,
  WINDOW_TITLES,
  PILLAR_WEIGHTS,
  PILLAR_LABELS,
  FLOW_LABELS,
  FLOW_LABEL_TEXTS,
  FLOW_LABEL_DESCRIPTIONS,
  SECTOR_OPTIONS,
  STATUS_OPTIONS,
  SORT_FIELDS,
  METHODOLOGY_DISCLAIMERS,
  SCANNER_VERSION,
  CONFIG_VERSION,
} from '../services/coinScanner';
import {
  RefreshCw, Zap, ExternalLink, TrendingUp, TrendingDown,
  Clock, ChevronDown, ChevronUp, AlertTriangle, HelpCircle,
  X, Check, Layers, BarChart2, ShieldCheck, Download,
  Filter, Search, ArrowUpDown, Info, Sparkles, Activity,
} from 'lucide-react';

// ── FORMATTING HELPERS ────────────────────────────────────────────────────────

const fmtCvd = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const num = Number(n);
  const sign = num > 0 ? '+' : '';
  const abs = Math.abs(num);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPct = (n, withSign = true, decimals = 2) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Number(n);
  const sign = withSign && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(decimals)}%`;
};

const fmtPrice = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Number(n);
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtScore = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  return Number(n).toFixed(1);
};

// ── METHODOLOGY DRAWER COMPONENT ──────────────────────────────────────────────

function ScannerMethodologyDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="scanner-drawer-overlay" onClick={onClose}>
      <div className="scanner-drawer-modal glass-panel font-mono" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <Zap size={18} className="text-amber-400" />
            <h3 className="drawer-title">PHƯƠNG PHÁP LUẬN ALTCOIN SCANNER V9</h3>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-section">
            <h4 className="section-title text-emerald-400">1. MỤC TIÊU & 4 TRỤ CỘT ĐỊNH LƯỢNG</h4>
            <p className="section-body">
              Scanner v9 thay thế hoàn toàn các setup giao dịch cũ bằng mô hình <strong>xếp hạng sức mạnh tài sản khách quan từ mạnh đến yếu</strong> (0–100) theo 4 trụ cột độc lập:
            </p>
            <div className="pillar-explainer-grid">
              <div className="pillar-item">
                <div className="pillar-head">
                  <TrendingUp size={14} className="text-emerald-400" />
                  <strong>Relative Strength — RS (40%)</strong>
                </div>
                <p>
                  Trung bình percentile RS so với <strong>BTC</strong> và <strong>ETH</strong>. Tỷ giá ALT/BTC và ALT/ETH được ghép nối từ các nến Spot USDT cùng timestamp. RS dương nghĩa là vượt benchmark kể cả khi giá USD giảm.
                </p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <Activity size={14} className="text-cyan-400" />
                  <strong>Dòng Tiền & Phái Sinh (25%)</strong>
                </div>
                <p>
                  Gồm <strong>70% percentile Spot CVD / Volume</strong> + <strong>30% điểm xác nhận phái sinh</strong> (Spot CVD &gt; 0, Futures CVD &gt; 0, Giá &amp; OI base cùng tăng, Funding rate TB ngày &le; 0.03%).
                </p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <ShieldCheck size={14} className="text-indigo-400" />
                  <strong>Fundamentals Theo Sector (25%)</strong>
                </div>
                <p>
                  Gồm <strong>60% định lượng sector</strong> (tăng trưởng 2 chỉ số cốt lõi so với cửa sổ liền trước, chỉ tính khi &ge; 5 peers cùng sector) + <strong>40% qualitative rubric</strong> (Sản phẩm 50% + Token accrual 50%, hạn 90 ngày).
                </p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <BarChart2 size={14} className="text-amber-400" />
                  <strong>Thanh Khoản & Độ Ổn Định (10%)</strong>
                </div>
                <p>
                  Trung bình percentile quote volume trong cửa sổ và percentile nghịch đảo hệ số biến thiên volume 30 ngày (1 / CV_vol30d) nhằm ưu tiên thanh khoản bền vững.
                </p>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-contrast">2. QUY TẮC PHÂN LOẠI NHÃN DÒNG TIỀN (FLOW LABELS)</h4>
            <div className="status-explainer-list">
              <div className="status-exp-row">
                <span className="conclusion-badge badge-emerald">Spot hỗ trợ</span>
                <span>Giá tăng kèm Spot CVD dương; dòng tiền giao ngay tích lũy chủ động.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-cyan">Phái sinh chi phối</span>
                <span>Giá tăng, Futures CVD và lượng OI tăng nhưng Spot CVD không dương; vị thế phái sinh chi phối.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-indigo">Short covering</span>
                <span>Giá tăng, Futures CVD dương nhưng lượng hợp đồng OI giảm; phe bán đóng lệnh cắt lỗ/chốt lời.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-slate">Hỗn hợp/Chưa đủ dữ liệu</span>
                <span>Dòng tiền chưa đồng thuận, giá giảm hoặc thiếu một trong các chỉ số cần thiết.</span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-slate-400">3. NGUYÊN TẮC DỮ LIỆU & TÍNH MINH BẠCH</h4>
            <ul className="drawer-notes-list text-muted text-xs">
              {METHODOLOGY_DISCLAIMERS.map((disc, idx) => (
                <li key={idx}>• {disc}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="drawer-footer">
          <button className="btn-drawer-close" onClick={onClose}>Đã Hiểu</button>
        </div>
      </div>
    </div>
  );
}

// ── EXPANDED ROW DETAILS ──────────────────────────────────────────────────────

const AssetRowDetails = React.memo(function AssetRowDetails({ asset, selectedWindow }) {
  const win = asset.windows?.[selectedWindow] || {};
  const metrics = win.metrics || {};
  const scores = win.scores || {};
  const comp = win.completeness || {};
  const rubric = asset.rubric || {};

  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${asset.symbol}`;
  const binanceSpotUrl = `https://www.binance.com/en/trade/${asset.baseAsset}_USDT`;
  const binanceFuturesUrl = asset.hasFutures ? `https://www.binance.com/en/futures/${asset.baseAsset}USDT` : null;
  const defillamaUrl = asset.defillamaSlug ? `https://defillama.com/protocol/${asset.defillamaSlug}` : null;

  return (
    <div className="scanner-details-panel">
      {/* 1. Score Breakdown Decomposition (4 Pillars) */}
      <div className="details-score-breakdown-banner glass-panel">
        <div className="breakdown-header">
          <div className="breakdown-title-group">
            <Sparkles size={16} className="text-amber-400" />
            <strong className="text-contrast">PHÂN RÃ 4 TRỤ CỘT ĐIỂM SỐ — KHUNG {WINDOW_LABELS[selectedWindow]}</strong>
          </div>
          <div className="total-score-callout">
            <span className="text-muted text-xs">ĐIỂM TỔNG:</span>
            <strong className="text-contrast text-lg ml-2 font-bold">{fmtScore(scores.totalScore)}</strong>
            <span className="text-muted text-xs ml-1">/ 100</span>
          </div>
        </div>

        <div className="pillars-score-grid">
          {/* Pillar 1: RS */}
          <div className="pillar-score-card">
            <div className="pillar-card-head">
              <span className="text-muted text-xs">1. RS (40%)</span>
              <strong className="text-contrast">{fmtScore(scores.rsPillar)}</strong>
            </div>
            <div className="pillar-card-body">
              <div className="metric-subrow">
                <span>Percentile RS/BTC:</span>
                <strong className={metrics.rsBtc > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {fmtScore(win.percentiles?.rsBtc)} ({fmtPct(metrics.rsBtc)})
                </strong>
              </div>
              <div className="metric-subrow">
                <span>Percentile RS/ETH:</span>
                <strong className={metrics.rsEth > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {fmtScore(win.percentiles?.rsEth)} ({fmtPct(metrics.rsEth)})
                </strong>
              </div>
            </div>
          </div>

          {/* Pillar 2: Flow */}
          <div className="pillar-score-card">
            <div className="pillar-card-head">
              <span className="text-muted text-xs">2. FLOW & PHÁI SINH (25%)</span>
              <strong className="text-contrast">{fmtScore(scores.flowPillar)}</strong>
            </div>
            <div className="pillar-card-body">
              <div className="metric-subrow">
                <span>Spot Pressure (70%):</span>
                <strong className={metrics.spotCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {fmtScore(win.percentiles?.spotFlowPressure)} ({fmtPct(metrics.spotFlowPressure * 100)})
                </strong>
              </div>
              <div className="metric-subrow">
                <span>Xác nhận phái sinh (30%):</span>
                <strong className="text-cyan-400">{scores.derivativesConfirmationScore || 0} / 100</strong>
              </div>
            </div>
          </div>

          {/* Pillar 3: Fundamentals */}
          <div className="pillar-score-card">
            <div className="pillar-card-head">
              <span className="text-muted text-xs">3. FUNDAMENTALS (25%)</span>
              <strong className="text-contrast">{fmtScore(scores.fundPillar)}</strong>
            </div>
            <div className="pillar-card-body">
              <div className="metric-subrow">
                <span>Định lượng sector (60%):</span>
                <strong>{fmtScore(scores.quantSectorScore)}</strong>
              </div>
              <div className="metric-subrow">
                <span>Qualitative rubric (40%):</span>
                <strong>{fmtScore(scores.rubricScore)}</strong>
              </div>
            </div>
          </div>

          {/* Pillar 4: Liquidity */}
          <div className="pillar-score-card">
            <div className="pillar-card-head">
              <span className="text-muted text-xs">4. THANH KHOẢN (10%)</span>
              <strong className="text-contrast">{fmtScore(scores.liqPillar)}</strong>
            </div>
            <div className="pillar-card-body">
              <div className="metric-subrow">
                <span>Volume cửa sổ (50%):</span>
                <strong>{fmtScore(win.percentiles?.windowVolume)}</strong>
              </div>
              <div className="metric-subrow">
                <span>Độ ổn định 30D (50%):</span>
                <strong>{fmtScore(win.percentiles?.volumeStability)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Three-Window Comparison Table */}
      <div className="details-windows-table-wrap glass-panel mt-3">
        <h5 className="details-subhead text-contrast">ĐỐI CHIẾU METRICS 3 CỬA SỔ (24H / 7D / 30D)</h5>
        <table className="windows-comparison-table">
          <thead>
            <tr>
              <th>CHỈ SỐ</th>
              <th>24 GIỜ (24H)</th>
              <th>7 NGÀY (7D)</th>
              <th>30 NGÀY (30D)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Biến động giá USD</td>
              <td className={asset.windows?.['24h']?.metrics?.priceChangePct > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['24h']?.metrics?.priceChangePct)}
              </td>
              <td className={asset.windows?.['7d']?.metrics?.priceChangePct > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['7d']?.metrics?.priceChangePct)}
              </td>
              <td className={asset.windows?.['30d']?.metrics?.priceChangePct > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['30d']?.metrics?.priceChangePct)}
              </td>
            </tr>
            <tr>
              <td>RS vs BTC</td>
              <td className={asset.windows?.['24h']?.metrics?.rsBtc > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['24h']?.metrics?.rsBtc)}
              </td>
              <td className={asset.windows?.['7d']?.metrics?.rsBtc > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['7d']?.metrics?.rsBtc)}
              </td>
              <td className={asset.windows?.['30d']?.metrics?.rsBtc > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['30d']?.metrics?.rsBtc)}
              </td>
            </tr>
            <tr>
              <td>RS vs ETH</td>
              <td className={asset.windows?.['24h']?.metrics?.rsEth > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['24h']?.metrics?.rsEth)}
              </td>
              <td className={asset.windows?.['7d']?.metrics?.rsEth > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['7d']?.metrics?.rsEth)}
              </td>
              <td className={asset.windows?.['30d']?.metrics?.rsEth > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtPct(asset.windows?.['30d']?.metrics?.rsEth)}
              </td>
            </tr>
            <tr>
              <td>Spot CVD (Binance)</td>
              <td className={asset.windows?.['24h']?.metrics?.spotCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['24h']?.metrics?.spotCvd)}
              </td>
              <td className={asset.windows?.['7d']?.metrics?.spotCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['7d']?.metrics?.spotCvd)}
              </td>
              <td className={asset.windows?.['30d']?.metrics?.spotCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['30d']?.metrics?.spotCvd)}
              </td>
            </tr>
            <tr>
              <td>Futures CVD (Binance)</td>
              <td className={asset.windows?.['24h']?.metrics?.futuresCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['24h']?.metrics?.futuresCvd)}
              </td>
              <td className={asset.windows?.['7d']?.metrics?.futuresCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['7d']?.metrics?.futuresCvd)}
              </td>
              <td className={asset.windows?.['30d']?.metrics?.futuresCvd > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {fmtCvd(asset.windows?.['30d']?.metrics?.futuresCvd)}
              </td>
            </tr>
            <tr>
              <td>ΔOI Base (Coin)</td>
              <td>{fmtPct(asset.windows?.['24h']?.metrics?.deltaOiBasePct)}</td>
              <td>{fmtPct(asset.windows?.['7d']?.metrics?.deltaOiBasePct)}</td>
              <td>{fmtPct(asset.windows?.['30d']?.metrics?.deltaOiBasePct)}</td>
            </tr>
            <tr>
              <td>Funding Rate TB Ngày</td>
              <td>{fmtPct((asset.windows?.['24h']?.metrics?.fundingAvgDaily || 0) * 100, true, 4)}</td>
              <td>{fmtPct((asset.windows?.['7d']?.metrics?.fundingAvgDaily || 0) * 100, true, 4)}</td>
              <td>{fmtPct((asset.windows?.['30d']?.metrics?.fundingAvgDaily || 0) * 100, true, 4)}</td>
            </tr>
            <tr>
              <td>Nhãn dòng tiền</td>
              <td><span className="text-xs font-mono">{asset.windows?.['24h']?.metrics?.flowLabelText || '---'}</span></td>
              <td><span className="text-xs font-mono">{asset.windows?.['7d']?.metrics?.flowLabelText || '---'}</span></td>
              <td><span className="text-xs font-mono">{asset.windows?.['30d']?.metrics?.flowLabelText || '---'}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Qualitative Rubric & Evidence Breakdown */}
      <div className="details-rubric-wrap glass-panel mt-3">
        <h5 className="details-subhead text-contrast">HỒ SƠ BẰNG CHỨNG FUNDAMENTALS & RUBRIC (90-DAY EXPIRY)</h5>
        <div className="rubric-grid">
          <div className="rubric-box">
            <div className="rubric-box-head">
              <span className="text-muted text-xs">TIÊU CHÍ 1: SẢN PHẨM (50%)</span>
              <span className="rubric-score-badge text-contrast font-bold">{rubric.productScore ?? '---'} / 100</span>
            </div>
            <p className="rubric-evidence-text">{rubric.productEvidence || 'Chưa có bằng chứng hoạt động trả phí.'}</p>
          </div>

          <div className="rubric-box">
            <div className="rubric-box-head">
              <span className="text-muted text-xs">TIÊU CHÍ 2: GIÁ TRỊ CHO TOKEN (50%)</span>
              <span className="rubric-score-badge text-contrast font-bold">{rubric.tokenAccrualScore ?? '---'} / 100</span>
            </div>
            <p className="rubric-evidence-text">{rubric.tokenAccrualEvidence || 'Chưa có cơ chế token accrual được ghi nhận.'}</p>
          </div>
        </div>

        <div className="rubric-meta-row text-xs text-muted mt-2">
          <span>Ngày đánh giá: <strong>{rubric.evaluatedAt ? rubric.evaluatedAt.slice(0, 10) : '---'}</strong></span>
          <span className="ml-4">Hạn rubric: <strong>{rubric.expiresAt ? rubric.expiresAt.slice(0, 10) : '---'}</strong></span>
          {rubric.sourceUrl && (
            <a href={rubric.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center text-cyan-400 hover:underline">
              Nguồn chính thức <ExternalLink size={12} className="ml-1" />
            </a>
          )}
        </div>
      </div>

      {/* 4. External Links Footer */}
      <div className="details-footer-links mt-3">
        <a href={binanceSpotUrl} target="_blank" rel="noreferrer" className="details-link-btn">
          Binance Spot <ExternalLink size={12} className="ml-1" />
        </a>
        {binanceFuturesUrl && (
          <a href={binanceFuturesUrl} target="_blank" rel="noreferrer" className="details-link-btn">
            Binance Futures <ExternalLink size={12} className="ml-1" />
          </a>
        )}
        <a href={tvChartUrl} target="_blank" rel="noreferrer" className="details-link-btn">
          TradingView <ExternalLink size={12} className="ml-1" />
        </a>
        {defillamaUrl && (
          <a href={defillamaUrl} target="_blank" rel="noreferrer" className="details-link-btn">
            DefiLlama <ExternalLink size={12} className="ml-1" />
          </a>
        )}
      </div>
    </div>
  );
});

// ── MAIN SCANNER COMPONENT ───────────────────────────────────────────────────

export default function ScannerTab() {
  const [manifest, setManifest] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedWindow, setSelectedWindow] = useState(DEFAULT_WINDOW);
  const [currentSnapshot, setCurrentSnapshot] = useState(null);
  const [priorSnapshot1d, setPriorSnapshot1d] = useState(null);
  const [priorSnapshot7d, setPriorSnapshot7d] = useState(null);
  const [priorSnapshot30d, setPriorSnapshot30d] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Filters & Sorting
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState(SORT_FIELDS.SCORE);
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' | 'desc'

  // Load Manifest on Mount
  useEffect(() => {
    let isMounted = true;
    async function init() {
      setIsLoading(true);
      const man = await loadScannerManifest();
      if (isMounted && man) {
        setManifest(man);
        const latest = man.latestDate || man.snapshots?.[0]?.date;
        setSelectedDate(latest);
      }
    }
    init();
    return () => { isMounted = false; };
  }, []);

  // Load Snapshot when selectedDate changes
  const fetchSnapshotData = useCallback(async (date, activeManifest = manifest, forceRefresh = false) => {
    if (!date) return;
    setIsLoading(true);
    try {
      const snap = await loadDailySnapshot(date, activeManifest, forceRefresh);
      setCurrentSnapshot(snap);

      // Try loading prior 1d, 7d, and 30d snapshots for delta tracking
      if (activeManifest?.snapshots) {
        const { date1d, date7d, date30d } = findPriorSnapshotDates(activeManifest, date);
        const [snap1d, snap7d, snap30d] = await Promise.all([
          date1d ? loadDailySnapshot(date1d, activeManifest, forceRefresh) : Promise.resolve(null),
          date7d ? loadDailySnapshot(date7d, activeManifest, forceRefresh) : Promise.resolve(null),
          date30d ? loadDailySnapshot(date30d, activeManifest, forceRefresh) : Promise.resolve(null),
        ]);
        setPriorSnapshot1d(snap1d);
        setPriorSnapshot7d(snap7d);
        setPriorSnapshot30d(snap30d);
      } else {
        setPriorSnapshot1d(null);
        setPriorSnapshot7d(null);
        setPriorSnapshot30d(null);
      }
    } catch (e) {
      console.error('[ScannerTab] Failed to load snapshot:', e);
    } finally {
      setIsLoading(false);
    }
  }, [manifest]);

  useEffect(() => {
    if (selectedDate) {
      fetchSnapshotData(selectedDate);
    }
  }, [selectedDate, fetchSnapshotData]);

  // Hydrate assets with tracking deltas
  const hydratedAssets = useMemo(() => {
    if (!currentSnapshot) return [];
    return hydrateAssetsWithTracking(currentSnapshot, priorSnapshot1d, priorSnapshot7d, priorSnapshot30d, selectedWindow);
  }, [currentSnapshot, priorSnapshot1d, priorSnapshot7d, priorSnapshot30d, selectedWindow]);

  // Filter and Sort Assets
  const filteredAssets = useMemo(() => {
    return hydratedAssets.filter(asset => {
      // Sector filter
      if (sectorFilter !== 'ALL' && asset.sector !== sectorFilter) {
        return false;
      }

      // Status filter (Completeness)
      const isComp = asset.windows?.[selectedWindow]?.completeness?.isComplete;
      if (statusFilter === 'COMPLETE' && !isComp) return false;
      if (statusFilter === 'INCOMPLETE' && isComp) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const sym = (asset.symbol || '').toLowerCase();
        const name = (asset.name || '').toLowerCase();
        const base = (asset.baseAsset || '').toLowerCase();
        if (!sym.includes(query) && !name.includes(query) && !base.includes(query)) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      const winA = a.windows?.[selectedWindow] || {};
      const winB = b.windows?.[selectedWindow] || {};
      const diffKey = selectedWindow === '24h' ? 'diff1d' : `diff${selectedWindow}`;

      let valA = null;
      let valB = null;

      switch (sortField) {
        case SORT_FIELDS.RANK:
          valA = winA.rank != null ? winA.rank : 9999;
          valB = winB.rank != null ? winB.rank : 9999;
          return sortDirection === 'asc' ? valA - valB : valB - valA;

        case SORT_FIELDS.SCORE:
          valA = winA.scores?.totalScore != null ? winA.scores.totalScore : -9999;
          valB = winB.scores?.totalScore != null ? winB.scores.totalScore : -9999;
          break;

        case SORT_FIELDS.DELTA_SCORE:
          valA = a.tracking?.[diffKey]?.deltaScore != null ? a.tracking[diffKey].deltaScore : -9999;
          valB = b.tracking?.[diffKey]?.deltaScore != null ? b.tracking[diffKey].deltaScore : -9999;
          break;

        case SORT_FIELDS.DELTA_RANK:
          valA = a.tracking?.[diffKey]?.deltaRank != null ? a.tracking[diffKey].deltaRank : -9999;
          valB = b.tracking?.[diffKey]?.deltaRank != null ? b.tracking[diffKey].deltaRank : -9999;
          break;

        case SORT_FIELDS.RS_BTC:
          valA = winA.metrics?.rsBtc != null ? winA.metrics.rsBtc : -9999;
          valB = winB.metrics?.rsBtc != null ? winB.metrics.rsBtc : -9999;
          break;

        case SORT_FIELDS.RS_ETH:
          valA = winA.metrics?.rsEth != null ? winA.metrics.rsEth : -9999;
          valB = winB.metrics?.rsEth != null ? winB.metrics.rsEth : -9999;
          break;

        case SORT_FIELDS.SPOT_FLOW:
          valA = winA.metrics?.spotCvd != null ? winA.metrics.spotCvd : -999999999;
          valB = winB.metrics?.spotCvd != null ? winB.metrics.spotCvd : -999999999;
          break;

        case SORT_FIELDS.VOLUME:
          valA = winA.metrics?.quoteVolume != null ? winA.metrics.quoteVolume : -9999;
          valB = winB.metrics?.quoteVolume != null ? winB.metrics.quoteVolume : -9999;
          break;

        default:
          valA = winA.scores?.totalScore != null ? winA.scores.totalScore : -9999;
          valB = winB.scores?.totalScore != null ? winB.scores.totalScore : -9999;
      }

      if (valA === valB) return 0;
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });
  }, [hydratedAssets, sectorFilter, statusFilter, searchQuery, sortField, sortDirection, selectedWindow]);

  // Handle Sort Toggle
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === SORT_FIELDS.RANK ? 'asc' : 'desc');
    }
  };

  const isStale = isSnapshotStale(currentSnapshot?.asOf);
  const summary = currentSnapshot?.summary?.[selectedWindow] || null;

  const handleExportCsv = () => {
    if (!currentSnapshot) return;
    const exportSnap = { ...currentSnapshot, assets: hydratedAssets };
    const csv = exportScannerCsv(exportSnap, selectedWindow);
    const filename = `scanner_v9_${selectedDate}_${selectedWindow}.csv`;
    triggerFileDownload(csv, filename, 'text/csv');
  };

  const handleExportJson = () => {
    if (!currentSnapshot) return;
    const exportSnap = { ...currentSnapshot, assets: hydratedAssets };
    const jsonStr = exportScannerJson(exportSnap, selectedWindow);
    const filename = `scanner_v9_${selectedDate}_${selectedWindow}.json`;
    triggerFileDownload(jsonStr, filename, 'application/json');
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    const man = await loadScannerManifest(true);
    if (man) {
      setManifest(man);
      const targetDate = selectedDate || man.latestDate || man.snapshots?.[0]?.date;
      if (targetDate) {
        await fetchSnapshotData(targetDate, man, true);
      }
    }
    setIsLoading(false);
  };

  return (
    <div className="scanner-tab-container font-mono">
      {/* ── 1. HEADER CONTROL BAR ────────────────────────────────────────── */}
      <div className="scanner-header-card glass-panel">
        <div className="scanner-header-left">
          <div className="scanner-title-row">
            <span className="scanner-icon-badge">
              <Zap size={18} className="text-amber-400" />
            </span>
            <div className="scanner-heading-group">
              <h2 className="scanner-main-title">ALTCOIN SCANNER V9</h2>
              <span className="scanner-version-badge">RANKING ENGINE {SCANNER_VERSION.toUpperCase()}</span>
            </div>
          </div>
          <p className="scanner-subtitle text-muted">
            Xếp hạng 50 Altcoin thanh khoản Spot cao nhất từ 4 Trụ Cột: RS (40%), Dòng Tiền (25%), Fundamentals (25%), Thanh Khoản (10%).
          </p>
        </div>

        <div className="scanner-header-right">
          {/* Snapshot Date Selector */}
          <div className="scanner-control-group">
            <label className="text-xs text-muted flex items-center">
              <Clock size={12} className="mr-1" /> Snapshot:
            </label>
            <select
              className="scanner-select font-mono"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {(manifest?.snapshots || []).map(s => (
                <option key={s.date} value={s.date}>
                  {s.date} (UTC)
                </option>
              ))}
            </select>
          </div>

          {/* Window Selector */}
          <div className="scanner-window-pill-group">
            {WINDOWS.map(winKey => (
              <button
                key={winKey}
                className={`scanner-win-btn ${selectedWindow === winKey ? 'is-active' : ''}`}
                onClick={() => setSelectedWindow(winKey)}
              >
                {WINDOW_LABELS[winKey]}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="scanner-actions-row">
            <button
              className="scanner-btn-secondary"
              onClick={() => setIsDrawerOpen(true)}
              title="Xem phương pháp luận"
            >
              <Info size={14} className="mr-1" /> Phương Pháp Luận
            </button>

            <button
              className="scanner-btn-secondary"
              onClick={handleExportCsv}
              title="Xuất CSV"
            >
              <Download size={14} className="mr-1" /> CSV
            </button>

            <button
              className="scanner-btn-secondary"
              onClick={handleExportJson}
              title="Xuất JSON"
            >
              <Download size={14} className="mr-1" /> JSON
            </button>

            <button
              className={`scanner-refresh-btn ${isLoading ? 'is-loading' : ''}`}
              onClick={handleRefresh}
              title="Làm mới snapshot"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── STALE WARNING BANNER ─────────────────────────────────────────── */}
      {isStale && (
        <div className="scanner-stale-banner glass-panel">
          <AlertTriangle size={16} className="text-amber-400 mr-2 shrink-0" />
          <span>
            <strong>Cảnh báo snapshot cũ:</strong> Dữ liệu snapshot hiện tại được tạo hơn 36 giờ trước. Job tự động cập nhật hằng ngày lúc 08:15 VN (01:15 UTC).
          </span>
        </div>
      )}

      {/* ── 2. SUMMARY STATISTICS STRIP ──────────────────────────────────── */}
      {summary && (
        <div className="scanner-summary-strip-grid">
          <div className="summary-stat-card glass-panel">
            <span className="stat-label">ĐỘ ĐẦY ĐỦ DỮ LIỆU</span>
            <div className="stat-val-group">
              <strong className="text-contrast text-lg">{summary.completeCount}</strong>
              <span className="text-muted text-xs">/ {summary.totalAssets} coin đủ 4 trụ</span>
            </div>
            <div className="stat-progress-bar">
              <div
                className="stat-progress-fill"
                style={{ width: `${(summary.completeCount / Math.max(summary.totalAssets, 1)) * 100}%` }}
              />
            </div>
          </div>

          <div className="summary-stat-card glass-panel">
            <span className="stat-label">VƯỢT BENCHMARK (RS &gt; 0)</span>
            <div className="stat-benchmark-split">
              <div>
                <span className="text-xs text-muted">vs BTC:</span>
                <strong className="text-emerald-400 ml-1">{fmtPct(summary.rsBtcPositiveRatio, false, 0)}</strong>
              </div>
              <div>
                <span className="text-xs text-muted">vs ETH:</span>
                <strong className="text-cyan-400 ml-1">{fmtPct(summary.rsEthPositiveRatio, false, 0)}</strong>
              </div>
            </div>
            <small className="text-muted text-xs mt-1">
              Trung vị: BTC {fmtPct(summary.medianRsBtc)} · ETH {fmtPct(summary.medianRsEth)}
            </small>
          </div>

          <div className="summary-stat-card glass-panel">
            <span className="stat-label">CƠ CẤU DÒNG TIỀN (FLOW)</span>
            <div className="stat-flow-pills">
              <span className="flow-pill text-emerald-400">Spot: {summary.flowDistribution?.SPOT_SUPPORTED || 0}</span>
              <span className="flow-pill text-cyan-400">Phái sinh: {summary.flowDistribution?.DERIVATIVES_DOMINATED || 0}</span>
              <span className="flow-pill text-indigo-400">Covering: {summary.flowDistribution?.SHORT_COVERING || 0}</span>
            </div>
          </div>

          <div className="summary-stat-card glass-panel">
            <span className="stat-label">BENCHMARKS NẾN ĐÓNG UTC</span>
            <div className="stat-val-group">
              <span className="text-xs text-muted">BTC:</span>
              <strong className="text-contrast text-sm ml-1">{fmtPrice(currentSnapshot?.benchmarks?.btc?.current)}</strong>
              <span className="text-xs text-muted ml-3">ETH:</span>
              <strong className="text-contrast text-sm ml-1">{fmtPrice(currentSnapshot?.benchmarks?.eth?.current)}</strong>
            </div>
            <small className="text-muted text-xs mt-1">
              Mốc dữ liệu kết thúc: {currentSnapshot?.asOf ? currentSnapshot.asOf.slice(0, 10) : '---'} 00:00 UTC
            </small>
          </div>
        </div>
      )}

      {/* ── 3. FILTER & SEARCH TOOLBAR ───────────────────────────────────── */}
      <div className="scanner-filter-bar glass-panel">
        <div className="filter-group">
          <label className="filter-label">Sector:</label>
          <select
            className="scanner-select font-mono"
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
          >
            {SECTOR_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Trạng thái:</label>
          <select
            className="scanner-select font-mono"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-search-wrap">
          <Search size={14} className="search-icon text-muted" />
          <input
            type="text"
            className="scanner-search-input font-mono"
            placeholder="Tìm theo symbol hoặc tên..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="filter-count-badge text-muted text-xs ml-auto">
          Hiển thị: <strong>{filteredAssets.length}</strong> / {hydratedAssets.length} tài sản
        </div>
      </div>

      {/* ── 4. MAIN RANKING TABLE ────────────────────────────────────────── */}
      <div className="scanner-table-wrapper glass-panel">
        {isLoading ? (
          <div className="scanner-loading-state">
            <RefreshCw size={24} className="animate-spin text-amber-400 mb-2" />
            <p className="text-muted text-sm">Đang tải dữ liệu snapshot...</p>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="scanner-empty-state">
            <Info size={24} className="text-muted mb-2" />
            <p className="text-contrast">Không tìm thấy tài sản nào phù hợp với bộ lọc.</p>
            <button
              className="scanner-btn-secondary mt-3"
              onClick={() => { setSectorFilter('ALL'); setStatusFilter('ALL'); setSearchQuery(''); }}
            >
              Xóa bộ lọc
            </button>
          </div>
        ) : (
          <table className="scanner-table">
            <thead>
              <tr>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.RANK)}>
                  <div className="th-wrap">
                    <span>COIN / SECTOR</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.SCORE)}>
                  <div className="th-wrap">
                    <span>ĐIỂM TỔNG</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.DELTA_RANK)}>
                  <div className="th-wrap">
                    <span>Δ HẠNG</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.RS_BTC)}>
                  <div className="th-wrap">
                    <span>RS / BTC</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.RS_ETH)}>
                  <div className="th-wrap">
                    <span>RS / ETH</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th className="th-clickable" onClick={() => handleSort(SORT_FIELDS.SPOT_FLOW)}>
                  <div className="th-wrap">
                    <span>SPOT FLOW (BINANCE)</span>
                    <ArrowUpDown size={12} className="ml-1" />
                  </div>
                </th>
                <th>PHÁI SINH (FLOW / OI / FUNDING)</th>
                <th>ĐỘ ĐẦY ĐỦ</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => {
                const win = asset.windows?.[selectedWindow] || {};
                const metrics = win.metrics || {};
                const scores = win.scores || {};
                const comp = win.completeness || {};
                const tracking = asset.tracking || {};
                const isExpanded = expandedRow === asset.symbol;

                const rank = win.rank;
                const totalScore = scores.totalScore;
                
                const diffKey = selectedWindow === '24h' ? 'diff1d' : `diff${selectedWindow}`;
                const deltaScore = tracking[diffKey]?.deltaScore;
                const deltaRank = tracking[diffKey]?.deltaRank;

                return (
                  <React.Fragment key={asset.symbol}>
                    <tr
                      className={`scanner-row ${isExpanded ? 'is-expanded' : ''} ${!comp.isComplete ? 'is-incomplete' : ''}`}
                      onClick={() => setExpandedRow(isExpanded ? null : asset.symbol)}
                    >
                      {/* 1. Coin & Sector */}
                      <td>
                        <div className="asset-info-cell">
                          <div className="asset-rank-badge">
                            {rank != null ? `#${rank}` : '---'}
                          </div>
                          <div className="asset-names-group">
                            <div className="symbol-row">
                              <strong className="asset-symbol text-contrast">{asset.baseAsset}</strong>
                              {tracking.isNewInUniverse && (
                                <span className="new-coin-badge">NEW</span>
                              )}
                            </div>
                            <span className="asset-fullname text-muted text-xs">{asset.name}</span>
                          </div>
                          <span className="sector-tag ml-auto">{asset.sector || 'Other'}</span>
                        </div>
                      </td>

                      {/* 2. Total Score (0-100) & Delta */}
                      <td>
                        <div className="score-cell-group">
                          {totalScore != null ? (
                            <>
                              <div className="score-badge-wrap">
                                <strong className="score-number text-contrast">{fmtScore(totalScore)}</strong>
                                {deltaScore != null && (
                                  <span className={`score-delta-pill ${deltaScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {fmtPct(deltaScore, true, 1)}
                                  </span>
                                )}
                              </div>
                              <div className="score-micro-bar">
                                <div className="score-micro-fill" style={{ width: `${Math.min(100, Math.max(0, totalScore))}%` }} />
                              </div>
                            </>
                          ) : (
                            <div className="score-incomplete-tag" title={comp.missingReasons?.join(', ') || 'Thiếu dữ liệu'}>
                              <span className="text-muted font-bold">---</span>
                              <span className="text-xs text-amber-400 ml-1">(Thiếu {comp.missingPillars?.length || 1} trụ)</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 3. Delta Rank */}
                      <td>
                        <div className="delta-rank-cell">
                          {deltaRank != null ? (
                            deltaRank > 0 ? (
                              <span className="rank-up text-emerald-400 flex items-center">
                                <TrendingUp size={12} className="mr-1" /> +{deltaRank}
                              </span>
                            ) : deltaRank < 0 ? (
                              <span className="rank-down text-rose-400 flex items-center">
                                <TrendingDown size={12} className="mr-1" /> {deltaRank}
                              </span>
                            ) : (
                              <span className="rank-flat text-muted">0</span>
                            )
                          ) : (
                            <span className="text-muted">---</span>
                          )}
                        </div>
                      </td>

                      {/* 4. RS / BTC */}
                      <td>
                        <div className="rs-cell">
                          <strong className={metrics.rsBtc > 0 ? 'text-emerald-400' : metrics.rsBtc < 0 ? 'text-rose-400' : 'text-muted'}>
                            {fmtPct(metrics.rsBtc)}
                          </strong>
                          {win.percentiles?.rsBtc != null && (
                            <small className="text-muted text-xs">P{Math.round(win.percentiles.rsBtc)}</small>
                          )}
                        </div>
                      </td>

                      {/* 5. RS / ETH */}
                      <td>
                        <div className="rs-cell">
                          <strong className={metrics.rsEth > 0 ? 'text-cyan-400' : metrics.rsEth < 0 ? 'text-rose-400' : 'text-muted'}>
                            {fmtPct(metrics.rsEth)}
                          </strong>
                          {win.percentiles?.rsEth != null && (
                            <small className="text-muted text-xs">P{Math.round(win.percentiles.rsEth)}</small>
                          )}
                        </div>
                      </td>

                      {/* 6. Spot Flow */}
                      <td>
                        <div className="flow-cell">
                          <strong className={metrics.spotCvd > 0 ? 'text-emerald-400' : metrics.spotCvd < 0 ? 'text-rose-400' : 'text-muted'}>
                            {fmtCvd(metrics.spotCvd)}
                          </strong>
                          {metrics.spotFlowPressure != null && (
                            <small className="text-muted text-xs">
                              {fmtPct(metrics.spotFlowPressure * 100)} / vol
                            </small>
                          )}
                        </div>
                      </td>

                      {/* 7. Derivatives (Flow / OI / Funding) */}
                      <td>
                        <div className="derivatives-cell">
                          <span className={`conclusion-badge badge-${
                            metrics.flowLabel === FLOW_LABELS.SPOT_SUPPORTED ? 'emerald' :
                            metrics.flowLabel === FLOW_LABELS.DERIVATIVES_DOMINATED ? 'cyan' :
                            metrics.flowLabel === FLOW_LABELS.SHORT_COVERING ? 'indigo' : 'slate'
                          }`}>
                            {metrics.flowLabelText || 'Hỗn hợp'}
                          </span>
                          {asset.hasFutures ? (
                            <small className="text-muted text-xs mt-1">
                              ΔOI: {fmtPct(metrics.deltaOiBasePct)} · Fund: {fmtPct((metrics.fundingAvgDaily || 0) * 100, true, 3)}/d
                            </small>
                          ) : (
                            <small className="text-muted text-xs mt-1">Spot Only (Không có Futures)</small>
                          )}
                        </div>
                      </td>

                      {/* 8. Data Completeness */}
                      <td>
                        <div className="completeness-cell">
                          {comp.isComplete ? (
                            <span className="complete-badge text-emerald-400 flex items-center text-xs">
                              <ShieldCheck size={14} className="mr-1" /> ĐỦ 4 TRỤ
                            </span>
                          ) : (
                            <span className="incomplete-badge text-amber-400 flex items-center text-xs" title={comp.missingReasons?.join(', ')}>
                              <AlertTriangle size={14} className="mr-1" /> THIẾU ({comp.missingPillars?.join('+')})
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Row Details */}
                    {isExpanded && (
                      <tr className="scanner-details-row">
                        <td colSpan={8}>
                          <AssetRowDetails asset={asset} selectedWindow={selectedWindow} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── METHODOLOGY DRAWER MODAL ─────────────────────────────────────── */}
      <ScannerMethodologyDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
}

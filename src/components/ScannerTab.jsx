/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Terminal */
import { useState, useEffect, useCallback } from 'react';
import { runFullScan } from '../services/coinScanner';
import {
  RefreshCw, Zap, ExternalLink, TrendingUp, TrendingDown, ShieldCheck,
  Clock, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, HelpCircle,
  X, Activity, Gauge, Layers, Check,
} from 'lucide-react';

const fmtUsd = (n) => {
  if (n == null) return '---';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtCvd = (n) => {
  if (n == null || n === 0) return '---';
  const sign = n > 0 ? '+' : '';
  if (Math.abs(n) >= 1e9) return `${sign}$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${sign}$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${sign}$${(n / 1e3).toFixed(0)}K`;
  return `${sign}$${n.toFixed(0)}`;
};

const fmtPct = (n, withSign = true) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Number(n);
  const sign = withSign && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
};

const fmtPrice = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Number(n);
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const isFiniteValue = value => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const isFreshEtfObservation = (row, now = new Date()) => {
  if (!row?.date || !isFiniteValue(row.flow)) return false;
  const [day, month, shortYear] = String(row.date).split('/').map(Number);
  if (!day || !month || !shortYear) return false;
  const year = shortYear < 100 ? 2000 + shortYear : shortYear;
  const observedAt = new Date(year, month - 1, day, 12).getTime();
  const ageMs = now.getTime() - observedAt;
  return ageMs >= 0 && ageMs <= 4 * 24 * 60 * 60 * 1000;
};

// ── SUBCOMPONENT: METHODOLOGY DRAWER ──────────────────────────────────────────
function ScannerMethodologyDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="scanner-drawer-overlay" onClick={onClose}>
      <div className="scanner-drawer-modal glass-panel font-mono" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <Zap size={18} className="text-amber-400" />
            <h3 className="drawer-title">CÁCH SCANNER XẾP HẠNG SHORTLIST</h3>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-section">
            <h4 className="section-title text-emerald-400">1. ĐỊNH HƯỚNG SẢN PHẨM &amp; PHẠM VI</h4>
            <p className="section-body">
              Scanner là công cụ <strong>xếp hạng shortlist</strong> khách quan giúp trader trả lời nhanh 3 câu hỏi:
              <br />• <em>Coin nào đáng xem?</em> (Top 5 theo chiều Mua hoặc Bán)
              <br />• <em>Vì sao nó được chọn?</em> (4 Pillars định lượng &amp; Top 3 lý do)
              <br />• <em>Dữ liệu có đủ tin cậy không?</em> (Quality Gate &amp; Data coverage)
              <br /><strong>Lưu ý:</strong> Scanner tuyệt đối không đưa điểm vào lệnh (Entry), Cắt lỗ (Stop) hay Mục tiêu (Target).
            </p>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-contrast">2. BỐN TRỤ CỘT ĐỊNH LƯỢNG (4 PILLARS — TỐI ĐA 25 ĐIỂM)</h4>
            <div className="pillar-explainer-grid">
              <div className="pillar-item">
                <div className="pillar-head">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  <strong>QUALITY (Max 5.0)</strong>
                </div>
                <p>Thanh khoản 30D (&gt;$300M-$1B), Vốn hóa (&gt;$1B-$2B), Độ ổn định volume (VolCV &le; 0.6), Spread Futures (&le; 0.03%-0.08%) và Data coverage.</p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <Gauge size={14} className="text-emerald-400" />
                  <strong>RELATIVE STRENGTH (Max 8.0)</strong>
                </div>
                <p>Hiệu suất tương đối so với BTC (1H/4H/24H RS Percentile trong Universe) và Breakout ATR so với đỉnh/đáy 20 phiên.</p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <Activity size={14} className="text-emerald-400" />
                  <strong>FLOW (Max 6.0)</strong>
                </div>
                <p>CVD Futures chuẩn hóa, CVD Spot gom/xả ròng, Gia tốc dòng tiền (CVD Trend Ratio) và Open Interest (OI) đồng thuận biến động giá.</p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <Layers size={14} className="text-emerald-400" />
                  <strong>MARKET CONTEXT (Max 6.0)</strong>
                </div>
                <p>Cấu trúc EMA 4H (21/55) &amp; Độ dốc, Xu hướng Daily 1D, Vùng cân bằng RSI (42-68/32-58) và Khung vĩ mô BTC/ETF Inflow. Trừ điểm nếu bị kéo xa EMA21 &gt;8% hoặc crowded.</p>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-amber-400">3. BẢO TỒN UNIVERSE &amp; QUOTA MOMENTUM</h4>
            <p className="section-body">
              Hệ thống lọc universe gồm 30 coin thanh khoản cao nhất + 10 coin tăng mạnh nhất + 10 coin giảm mạnh nhất 24H. Cơ chế quota giữ nguyên các đại diện momentum, không bị sort volume cuối đè mất.
            </p>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-slate-400">4. MIỄN TRỪ TRÁCH NHIỆM (DISCLAIMER)</h4>
            <p className="section-body text-muted">
              Dữ liệu được tổng hợp từ Binance REST/Futures và CoinGecko/CoinCap. Không có bất kỳ thông tin nào cấu thành lời khuyên đầu tư hay khuyến nghị giao dịch. Trader tự chịu trách nhiệm phân tích chart và quản lý vốn.
            </p>
          </div>
        </div>

        <div className="drawer-footer">
          <button className="btn-drawer-close" onClick={onClose}>Đã Hiểu</button>
        </div>
      </div>
    </div>
  );
}

// ── SUBCOMPONENT: EXPANDED ROW DETAILS ─────────────────────────────────────────
function ScannerRowDetails({ coin }) {
  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;
  const binanceUrl = `https://www.binance.com/en/trade/${coin.baseAsset}_USDT`;

  return (
    <div className="scanner-details-panel">
      {/* 1. Price Action Context Statement */}
      <div className="details-pa-banner">
        <div className="pa-badge">
          <Activity size={13} className="text-cyan-400" />
          <span>BỐI CẢNH PRICE ACTION (NẾN ĐÓNG):</span>
        </div>
        <p className="pa-statement-text font-bold">
          {coin.paContext?.statement || '4H cấu trúc nến đóng đang phát triển'}
        </p>
      </div>

      <div className="details-grid-two-col">
        {/* Left: Top 3 Reasons & Warnings */}
        <div className="details-insights-col">
          <div className="insights-block positive-block">
            <div className="insights-header">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="insights-title">VÌ SAO ĐƯỢC CHỌN (TOP LÝ DO):</span>
            </div>
            <ul className="reasons-list">
              {(coin.positiveReasons || []).length > 0 ? (
                coin.positiveReasons.map((reason, idx) => (
                  <li key={idx} className="reason-item">
                    <Check size={12} className="text-emerald-400 flex-shrink-0" />
                    <span>{reason}</span>
                  </li>
                ))
              ) : (
                <li className="reason-item text-muted">Đạt tiêu chuẩn thanh khoản và cấu trúc kỹ thuật cơ bản.</li>
              )}
            </ul>
          </div>

          <div className="insights-block warnings-block">
            <div className="insights-header">
              <AlertTriangle size={14} className={(coin.warnings || []).length > 0 ? 'text-amber-400' : 'text-slate-400'} />
              <span className="insights-title">CẢNH BÁO &amp; YẾU TỐ BẤT LỢI:</span>
            </div>
            {(coin.warnings || []).length > 0 ? (
              <div className="warnings-tags-flex">
                {coin.warnings.map((warn, idx) => (
                  <span key={idx} className={`warning-chip chip-${warn.level || 'amber'}`}>
                    {warn.message}
                  </span>
                ))}
              </div>
            ) : (
              <p className="no-warning-text">✓ Không phát hiện yếu tố rủi ro vi cấu trúc (Crowded / Stretched / High Spread).</p>
            )}
          </div>
        </div>

        {/* Right: 4-Pillar Score Cards */}
        <div className="details-pillars-col">
          <div className="pillar-cards-grid">
            <div className="pillar-mini-card">
              <div className="pillar-card-head">
                <span className="pillar-label">1. Quality</span>
                <span className="pillar-pts font-bold">{coin.qualityScore || 0}<small>/5.0</small></span>
              </div>
              <div className="pillar-bar-bg">
                <div className="pillar-bar-fill emerald" style={{ width: `${((coin.qualityScore || 0) / 5) * 100}%` }} />
              </div>
              <span className="pillar-sub-state">{coin.qualityState || 'ACCEPTABLE'}</span>
            </div>

            <div className="pillar-mini-card">
              <div className="pillar-card-head">
                <span className="pillar-label">2. Rel Strength</span>
                <span className="pillar-pts font-bold">{coin.strengthScore || 0}<small>/8.0</small></span>
              </div>
              <div className="pillar-bar-bg">
                <div className="pillar-bar-fill cyan" style={{ width: `${((coin.strengthScore || 0) / 8) * 100}%` }} />
              </div>
              <span className="pillar-sub-state">{coin.strengthState || 'STRONG'}</span>
            </div>

            <div className="pillar-mini-card">
              <div className="pillar-card-head">
                <span className="pillar-label">3. Flow CVD/OI</span>
                <span className="pillar-pts font-bold">{coin.flowScore || 0}<small>/6.0</small></span>
              </div>
              <div className="pillar-bar-bg">
                <div className="pillar-bar-fill indigo" style={{ width: `${((coin.flowScore || 0) / 6) * 100}%` }} />
              </div>
              <span className="pillar-sub-state">{coin.flowState || 'NEUTRAL'}</span>
            </div>

            <div className="pillar-mini-card">
              <div className="pillar-card-head">
                <span className="pillar-label">4. Context / Trend</span>
                <span className="pillar-pts font-bold">{coin.contextScore || 0}<small>/6.0</small></span>
              </div>
              <div className="pillar-bar-bg">
                <div className="pillar-bar-fill amber" style={{ width: `${((coin.contextScore || 0) / 6) * 100}%` }} />
              </div>
              <span className="pillar-sub-state">{coin.trendState || 'UPTREND'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Raw Metrics Bento Grid */}
      <div className="details-raw-metrics-wrap">
        <span className="raw-metrics-label">RAW DECISION METRICS:</span>
        <div className="raw-metrics-bento">
          <div className="raw-metric-item">
            <span className="m-label">Vol 30D</span>
            <span className="m-val">{fmtUsd(coin.vol30d)}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Market Cap</span>
            <span className="m-val">{fmtUsd(coin.marketCap)}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Vol CV</span>
            <span className="m-val">{coin.volCV ?? '---'}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Futures Spread</span>
            <span className="m-val">{coin.spreadPct != null ? `${coin.spreadPct.toFixed(3)}%` : '---'}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Futures CVD 24H</span>
            <span className={`m-val ${coin.cvd24h > 0 ? 'text-emerald-400' : coin.cvd24h < 0 ? 'text-rose-400' : ''}`}>
              {fmtCvd(coin.cvd24h)}
            </span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Spot CVD 24H</span>
            <span className={`m-val ${coin.spotCvd24h > 0 ? 'text-emerald-400' : coin.spotCvd24h < 0 ? 'text-rose-400' : ''}`}>
              {fmtCvd(coin.spotCvd24h)}
            </span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Taker Buy %</span>
            <span className="m-val">{coin.takerBuyRatio != null ? `${coin.takerBuyRatio}%` : '---'}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Funding Rate</span>
            <span className="m-val">{coin.fundingRate != null ? `${coin.fundingRate > 0 ? '+' : ''}${coin.fundingRate.toFixed(4)}%` : '---'}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">Basis %</span>
            <span className="m-val">{fmtPct(coin.basisPct)}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">RSI (14 4H)</span>
            <span className="m-val">{coin.rsi14 ?? '---'}</span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">RS 4H vs BTC</span>
            <span className={`m-val ${coin.relativeStrength4h > 0 ? 'text-emerald-400' : coin.relativeStrength4h < 0 ? 'text-rose-400' : ''}`}>
              {fmtPct(coin.relativeStrength4h)}
            </span>
          </div>
          <div className="raw-metric-item">
            <span className="m-label">RS 24H vs BTC</span>
            <span className={`m-val ${coin.relativeStrength24h > 0 ? 'text-emerald-400' : coin.relativeStrength24h < 0 ? 'text-rose-400' : ''}`}>
              {fmtPct(coin.relativeStrength24h)}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Action Bar */}
      <div className="details-actions-bar">
        <a
          href={tvChartUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-chart-direct tv"
        >
          <ExternalLink size={13} />
          <span>Mở Chart {coin.symbol} trên TradingView</span>
        </a>
        <a
          href={binanceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-chart-direct binance"
        >
          <ExternalLink size={13} />
          <span>Xem trên Binance Spot</span>
        </a>
      </div>
    </div>
  );
}

// ── SUBCOMPONENT: 5-COLUMN TABLE ROW ──────────────────────────────────────────
function ScannerRow({ coin, rank, isExpanded, onToggle, direction }) {
  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

  const isStrengthPositive = coin.strengthScore >= 6.0;
  const isStrengthModerate = coin.strengthScore >= 3.5;
  const isFlowConfirmed = coin.flowState === 'FLOW CONFIRMED';
  const isFlowDivergent = coin.flowState === 'DIVERGENT';

  return (
    <>
      <tr
        className={`scanner-row rank-${rank} ${isExpanded ? 'is-expanded' : ''}`}
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        role="button"
        aria-expanded={isExpanded}
      >
        {/* CỘT 1: COIN */}
        <td className="td-coin-primary">
          <div className="coin-cell-layout">
            <span className={`rank-badge rank-${rank}`}>#{rank}</span>
            <div className="coin-meta">
              <a
                href={tvChartUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="coin-symbol-link"
                onClick={e => e.stopPropagation()}
                title="Mở TradingView Chart"
              >
                <strong className="symbol-base">{coin.baseAsset}</strong>
                <span className="pair-sub">/USDT</span>
                <ExternalLink size={11} className="link-ext-icon" />
              </a>
              <div className="coin-price-row">
                <span className="price-num">{fmtPrice(coin.price)}</span>
                <span className={`change-pill ${coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmtPct(coin.priceChange24h)}
                </span>
              </div>
            </div>
          </div>
        </td>

        {/* CỘT 2: STRENGTH */}
        <td className="td-strength">
          <div className="conclusion-badge-wrap">
            <span className={`conclusion-badge ${isStrengthPositive ? 'badge-emerald' : isStrengthModerate ? 'badge-cyan' : 'badge-slate'}`}>
              {isStrengthPositive ? 'STRONG' : isStrengthModerate ? 'NEUTRAL' : 'WEAK'}
            </span>
            <div className="strength-sub-text">
              <span>RS vs BTC: <strong>Top {100 - Math.round(direction === 'BUY' ? coin.strengthPercentile : (100 - coin.strengthPercentile))}%</strong></span>
              <span className="tf-trend-tag">
                {coin.isDailyUptrend ? '1D ▲' : coin.isDailyUptrend === false ? '1D ▼' : '1D ~'}
              </span>
            </div>
          </div>
        </td>

        {/* CỘT 3: FLOW */}
        <td className="td-flow">
          <div className="conclusion-badge-wrap">
            <span className={`conclusion-badge ${isFlowConfirmed ? 'badge-emerald' : isFlowDivergent ? 'badge-amber' : 'badge-slate'}`}>
              {isFlowConfirmed ? 'FLOW CONFIRMED' : isFlowDivergent ? 'DIVERGENT' : 'NEUTRAL FLOW'}
            </span>
            <div className="flow-sub-bar">
              <div className="taker-mini-track" title={`Taker Buy: ${coin.takerBuyRatio}%`}>
                <div className="taker-mini-fill" style={{ width: `${coin.takerBuyRatio || 50}%` }} />
              </div>
              <span className="oi-sub-text">
                OI 4H: <strong>{coin.oiChange4h != null ? fmtPct(coin.oiChange4h) : '---'}</strong>
              </span>
            </div>
          </div>
        </td>

        {/* CỘT 4: QUALITY */}
        <td className="td-quality">
          <div className="conclusion-badge-wrap">
            <span className={`conclusion-badge ${coin.qualityScore >= 4.0 ? 'badge-emerald' : coin.qualityScore >= 3.0 ? 'badge-cyan' : 'badge-amber'}`}>
              {coin.qualityState || 'ACCEPTABLE'}
            </span>
            <div className="quality-sub-text">
              <span>Spread: <strong>{coin.spreadPct != null ? `${coin.spreadPct.toFixed(2)}%` : '---'}</strong></span>
              <span>VolCV: <strong>{coin.volCV ?? '---'}</strong></span>
            </div>
          </div>
        </td>

        {/* CỘT 5: RANK SCORE */}
        <td className="td-score">
          <div className="score-cell-layout">
            <div className="score-main-wrap">
              <span className="score-numeric font-extrabold" style={{ color: coin.statusColor }}>
                {coin.score}<small className="score-max">/25</small>
              </span>
              <span className="status-label-pill" style={{ color: coin.statusColor, borderColor: `${coin.statusColor}40`, backgroundColor: `${coin.statusColor}12` }}>
                {coin.status}
              </span>
            </div>
            <button
              className="btn-expand-chevron"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-label={isExpanded ? 'Thu gọn' : 'Mở rộng chi tiết'}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="scanner-details-row">
          <td colSpan={5} className="td-details-container">
            <ScannerRowDetails coin={coin} direction={direction} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── SUBCOMPONENT: MOBILE COMPACT CARD ─────────────────────────────────────────
function ScannerMobileCard({ coin, rank, isExpanded, onToggle, direction }) {
  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

  return (
    <div className={`scanner-mobile-card glass-panel rank-${rank} ${isExpanded ? 'is-expanded' : ''}`}>
      <div className="mobile-card-header" onClick={onToggle}>
        <div className="mobile-card-title-group">
          <span className={`rank-badge rank-${rank}`}>#{rank}</span>
          <div className="mobile-coin-names">
            <a
              href={tvChartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="symbol-base"
              onClick={e => e.stopPropagation()}
            >
              {coin.baseAsset}<span className="pair-sub">/USDT</span>
            </a>
            <span className="price-num">{fmtPrice(coin.price)}</span>
          </div>
        </div>

        <div className="mobile-card-score-group">
          <span className="score-numeric font-extrabold" style={{ color: coin.statusColor }}>
            {coin.score}<small>/25</small>
          </span>
          <span className={`change-pill ${coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtPct(coin.priceChange24h)}
          </span>
          <span className="mobile-chevron-icon">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </div>

      <div className="mobile-conclusions-strip" onClick={onToggle}>
        <span className={`conclusion-badge ${coin.strengthScore >= 6.0 ? 'badge-emerald' : 'badge-cyan'}`}>
          {coin.strengthState}
        </span>
        <span className={`conclusion-badge ${coin.flowState === 'FLOW CONFIRMED' ? 'badge-emerald' : 'badge-slate'}`}>
          {coin.flowState}
        </span>
        <span className={`conclusion-badge ${coin.qualityScore >= 4.0 ? 'badge-emerald' : 'badge-cyan'}`}>
          {coin.qualityState}
        </span>
      </div>

      {coin.paContext?.statement && (
        <div className="mobile-pa-statement" onClick={onToggle}>
          <Activity size={11} className="text-cyan-400" />
          <span>{coin.paContext.statement}</span>
        </div>
      )}

      {isExpanded && (
        <div className="mobile-card-expanded-content">
          <ScannerRowDetails coin={coin} direction={direction} />
        </div>
      )}
    </div>
  );
}

// ── MAIN SCANNER TAB COMPONENT ────────────────────────────────────────────────
export default function ScannerTab({ data = {}, btcChange24h = null, etfHistory = [] }) {
  const [scanResult, setScanResult] = useState({
    topBuy: [],
    topSell: [],
    scannedCount: 0,
    qualifiedCount: 0,
    errorState: null,
    timestamp: 0,
  });
  const [isScanning, setIsScanning] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(300);
  const [activeDirection, setActiveDirection] = useState('BUY'); // 'BUY' | 'SELL'
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);

  const fallbackBtcChange = data.btc?.change;

  const executeScan = useCallback(async (force = false) => {
    setIsScanning(true);
    try {
      const btcChange = isFiniteValue(btcChange24h)
        ? Number(btcChange24h)
        : isFiniteValue(fallbackBtcChange) ? Number(fallbackBtcChange) : null;
      const latestEtf = [...etfHistory].reverse().find(row => isFreshEtfObservation(row));
      const isBtcBullish = btcChange === null ? null : btcChange > 0;
      const isEtfInflow = latestEtf ? Number(latestEtf.flow) > 0 : null;
      const res = await runFullScan({ isBtcBullish, isEtfInflow }, force);
      setScanResult(res);
      setSecondsUntilRefresh(300);
    } catch (e) {
      console.error('[ScannerTab] Scan error:', e);
      setScanResult(prev => ({ ...prev, errorState: 'PROVIDER_UNAVAILABLE' }));
    } finally {
      setIsScanning(false);
    }
  }, [btcChange24h, fallbackBtcChange, etfHistory]);

  useEffect(() => {
    const initialScan = setTimeout(() => executeScan(false), 0);
    return () => clearTimeout(initialScan);
  }, [executeScan]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) {
          executeScan(false);
          return 300;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [executeScan]);

  const formatTimeRemaining = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentCoins = activeDirection === 'BUY'
    ? (scanResult.topBuy || [])
    : (scanResult.topSell || []);

  const toggleRowExpansion = (symbol) => {
    setExpandedSymbol(prev => (prev === symbol ? null : symbol));
  };

  const renderEmptyOrErrorState = () => {
    if (scanResult.errorState === 'PROVIDER_UNAVAILABLE') {
      return (
        <div className="scanner-empty-state">
          <AlertTriangle size={36} className="text-amber-400" />
          <h4 className="empty-heading font-bold">Lỗi kết nối nhà cung cấp dữ liệu</h4>
          <p className="empty-sub">
            API Binance hoặc CoinGecko tạm thời không phản hồi. Vui lòng bấm <strong>Quét Ngay</strong> để thử lại.
          </p>
          <button className="btn-retry-scan" onClick={() => executeScan(true)}>
            <RefreshCw size={13} />
            <span>Thử lại</span>
          </button>
        </div>
      );
    }

    if (scanResult.errorState === 'INSUFFICIENT_COVERAGE') {
      return (
        <div className="scanner-empty-state">
          <AlertTriangle size={36} className="text-amber-400" />
          <h4 className="empty-heading font-bold">Độ phủ dữ liệu chưa đủ an toàn</h4>
          <p className="empty-sub">
            Chưa đủ số nến 4H / 1D hoặc dữ liệu phái sinh để xếp hạng shortlist khách quan.
          </p>
        </div>
      );
    }

    return (
      <div className="scanner-empty-state">
        <ShieldCheck size={36} className="text-amber-400" />
        <h4 className="empty-heading font-bold">
          Không có coin nào đạt Quality Gate cho chiều {activeDirection === 'BUY' ? 'MUA (LONG)' : 'BÁN (SHORT)'} lúc này.
        </h4>
        <p className="empty-sub">
          Bộ lọc giữ kỷ luật: Chỉ shortlist khi vượt <strong>Score &ge; 14/25, Directional Edge &ge; 3, MCap &ge; $1B, VolCV &le; 1.3, Spread &le; 0.15%</strong> để bảo vệ vốn.
        </p>
      </div>
    );
  };

  return (
    <div className="scanner-tab-container hallmark-scanner-container font-mono">
      {/* ── HEADER CONTROL BAR ────────────────────────────────────────────── */}
      <div className="scanner-header-card glass-panel">
        <div className="scanner-header-left">
          <div className="scanner-title-row">
            <span className="scanner-icon-badge">
              <Zap size={18} className="text-amber-400" />
            </span>
            <div>
              <div className="scanner-title-with-tag">
                <h2 className="scanner-title">SCANNER SHORTLIST — 2 CHIỀU (BUY &amp; SELL)</h2>
                <span className="algo-version-tag">v7</span>
              </div>
              <p className="scanner-subtitle">
                Xếp hạng shortlist 4 Pillars: <strong>Quality · RS vs BTC · Flow CVD/OI · Market Context</strong>. Không đưa entry/stop — chỉ gợi ý coin đáng xem để mở chart.
              </p>
            </div>
          </div>
        </div>

        <div className="scanner-header-right">
          <button
            className="btn-methodology-drawer"
            onClick={() => setIsMethodologyOpen(true)}
            title="Xem cách scanner hoạt động"
          >
            <HelpCircle size={14} className="text-cyan-400" />
            <span>Cách Scanner Hoạt Động</span>
          </button>

          <div className="scanner-timer-badge">
            <Clock size={13} className="text-emerald-400" />
            <span>Tự động quét: <strong className="text-contrast">{formatTimeRemaining(secondsUntilRefresh)}</strong></span>
          </div>

          <button
            className={`scanner-refresh-btn ${isScanning ? 'is-loading' : ''}`}
            onClick={() => executeScan(true)}
            disabled={isScanning}
          >
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
            <span>{isScanning ? 'Đang Xếp Hạng...' : 'Quét Ngay'}</span>
          </button>
        </div>
      </div>

      {/* ── DUAL DIRECTION TAB SWITCHER & UNIVERSE STATS ───────────────────── */}
      <div className="scanner-direction-bar">
        <div className="direction-toggle-group">
          <button
            onClick={() => setActiveDirection('BUY')}
            className={`btn-direction-tab ${activeDirection === 'BUY' ? 'active buy-active' : ''}`}
          >
            <TrendingUp size={16} />
            <span>TOP LONG (BUY)</span>
            <span className="chip-count buy">
              {scanResult.topBuy?.length || 0} COIN
            </span>
          </button>

          <button
            onClick={() => setActiveDirection('SELL')}
            className={`btn-direction-tab ${activeDirection === 'SELL' ? 'active sell-active' : ''}`}
          >
            <TrendingDown size={16} />
            <span>TOP SHORT (SELL)</span>
            <span className="chip-count sell">
              {scanResult.topSell?.length || 0} COIN
            </span>
          </button>
        </div>

        <div className="scanner-universe-info">
          <span className="universe-stat-item">
            Quét: <strong>{scanResult.scannedCount || 0} coin</strong>
          </span>
          <span className="stat-separator">·</span>
          <span className="universe-stat-item">
            Qua Quality Gate: <strong>{scanResult.qualifiedCount || 0} coin</strong>
          </span>
          {scanResult.timestamp > 0 && (
            <>
              <span className="stat-separator">·</span>
              <span className="universe-stat-item text-muted">
                Cập nhật: {new Date(scanResult.timestamp).toLocaleTimeString('vi-VN')}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── MAIN SCANNER TABLE (DESKTOP 5-COLUMNS) ─────────────────────────── */}
      <div className="scanner-table-wrapper glass-panel hide-on-mobile">
        {isScanning && currentCoins.length === 0 ? (
          <div className="scanner-skeleton-loader">
            <RefreshCw size={24} className="spin text-amber-400" />
            <p className="loading-text">Đang đo lường 4 Pillars (Quality, RS vs BTC, Flow CVD, Multi-TF Context)...</p>
          </div>
        ) : currentCoins.length === 0 ? (
          renderEmptyOrErrorState()
        ) : (
          <div className="table-responsive-scroll">
            <table className="scanner-table table-five-col">
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>COIN</th>
                  <th style={{ width: '22%' }}>STRENGTH</th>
                  <th style={{ width: '22%' }}>FLOW</th>
                  <th style={{ width: '18%' }}>QUALITY</th>
                  <th style={{ width: '16%' }}>RANK SCORE</th>
                </tr>
              </thead>
              <tbody>
                {currentCoins.map((coin, index) => (
                  <ScannerRow
                    key={coin.symbol}
                    coin={coin}
                    rank={index + 1}
                    direction={activeDirection}
                    isExpanded={expandedSymbol === coin.symbol}
                    onToggle={() => toggleRowExpansion(coin.symbol)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MOBILE COMPACT CARDS VIEW ──────────────────────────────────────── */}
      <div className="scanner-mobile-container hide-on-desktop">
        {isScanning && currentCoins.length === 0 ? (
          <div className="scanner-skeleton-loader glass-panel">
            <RefreshCw size={24} className="spin text-amber-400" />
            <p className="loading-text">Đang lọc shortlist 4 pillars...</p>
          </div>
        ) : currentCoins.length === 0 ? (
          <div className="glass-panel">{renderEmptyOrErrorState()}</div>
        ) : (
          <div className="mobile-cards-list">
            {currentCoins.map((coin, index) => (
              <ScannerMobileCard
                key={coin.symbol}
                coin={coin}
                rank={index + 1}
                direction={activeDirection}
                isExpanded={expandedSymbol === coin.symbol}
                onToggle={() => toggleRowExpansion(coin.symbol)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── METHODOLOGY DRAWER MODAL ───────────────────────────────────────── */}
      <ScannerMethodologyDrawer
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />
    </div>
  );
}


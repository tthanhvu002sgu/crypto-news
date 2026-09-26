import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { runFullScan, getTrackingSummary } from '../services/coinScanner';
import { SETUP_STATES, SETUP_TYPES } from '../services/scannerConfig';
import {
  RefreshCw, Zap, ExternalLink, TrendingUp, TrendingDown, ShieldCheck,
  Clock, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, HelpCircle,
  X, Activity, Check, Crosshair, Target, History, Award, Flame,
} from 'lucide-react';

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
            <h3 className="drawer-title">SCANNER V8: LỌC SỨC MẠNH TRƯỚC, XÁC NHẬN SETUP SAU</h3>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-section">
            <h4 className="section-title text-emerald-400">1. ĐỊNH HƯỚNG VÀ 5 CỬA LỌC BẮT BUỘC</h4>
            <p className="section-body">
              Scanner v8 thay đổi triệt để cơ chế xếp hạng theo tổng điểm cũ. Không một đồng coin nào có thể xuất hiện trong danh sách chỉ vì tổng điểm cao. Hệ thống yêu cầu vượt qua 5 cửa lọc liên hoàn:
              <br />• <strong>Dữ liệu:</strong> Kiểm tra nến đóng, đồng bộ thời gian, không lookahead, báo thiếu dữ liệu nếu thiếu benchmark.
              <br />• <strong>Thanh khoản:</strong> Vốn hóa &ge; $1B, Spread &le; 0.15%, VolCV &le; 1.3, Vol 30D &ge; $100M, có Futures.
              <br />• <strong>Sức mạnh (Strength):</strong> Bắt buộc đạt RS 4H/24H vs BTC, nằm trong nhóm percentile &ge; 70% (LONG) hoặc &le; 30% (SHORT), xu hướng 4H EMA21/55 cùng độ dốc, và RS24H bền vững trong &ge; 3/4 nến 1H gần nhất.
              <br />• <strong>Setup:</strong> Bắt buộc khớp mẫu hình kỹ thuật rõ ràng (Pullback tiếp diễn hoặc Breakout–Retest).
              <br />• <strong>Vị trí hiện tại:</strong> Đo khoảng cách ATR đến vùng kích hoạt, không chấp nhận tín hiệu đã chạy quá xa (&gt; 1.5 ATR).
            </p>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-contrast">2. HAI MẪU HÌNH NHẬN DIỆN SETUP (1H / 4H)</h4>
            <div className="pillar-explainer-grid">
              <div className="pillar-item">
                <div className="pillar-head">
                  <Crosshair size={14} className="text-emerald-400" />
                  <strong>PULLBACK TIẾP DIỄN</strong>
                </div>
                <p>
                  Giá điều chỉnh về vùng tham chiếu hỗ trợ (Swing Low pivot đã xác nhận) trong xu hướng tăng. Xác nhận khi nến 1H tăng đóng lấy lại vùng và vượt đỉnh nến trước. Vô hiệu hóa khi phá đáy cấu trúc.
                </p>
              </div>

              <div className="pillar-item">
                <div className="pillar-head">
                  <Target size={14} className="text-cyan-400" />
                  <strong>BREAKOUT – RETEST</strong>
                </div>
                <p>
                  Giá đóng vượt vùng đỉnh/đáy 20 nến 1H trước đó, sau đó quay lại kiểm tra (retest). Xác nhận khi nến retest đóng giữ vững trên vùng breakout với phản ứng tăng dứt khoát.
                </p>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-amber-400">3. CÁC TRẠNG THÁI HIỂN THỊ TRÊN GIAO DIỆN</h4>
            <div className="status-explainer-list">
              <div className="status-exp-row">
                <span className="conclusion-badge badge-emerald">READY</span>
                <span>Đã xác nhận setup, dữ liệu đầy đủ và vị trí hiện tại còn trong tầm &le; 1.5 ATR.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-cyan">FORMING</span>
                <span>Đã đạt sức mạnh, setup đang hình thành nhưng đang chờ kiểm tra lại hoặc thiếu nến xác nhận.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-indigo">WATCH</span>
                <span>Đạt sức mạnh vượt trội nhưng chưa có điểm pullback hoặc breakout hợp lệ để vào form.</span>
              </div>
              <div className="status-exp-row">
                <span className="conclusion-badge badge-amber">EXTENDED</span>
                <span>Coin mạnh và setup đã kích hoạt nhưng giá đã chạy quá xa vùng kích hoạt (&gt; 1.5 ATR), rủi ro đu đỉnh.</span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="section-title text-slate-400">4. MỨC THAM CHIẾU VÀ TÍNH TOÁN R:R</h4>
            <p className="section-body text-muted">
              Mỗi setup hiển thị các mức tham chiếu đo bằng ATR: <strong>Vùng kích hoạt (Trigger Zone), Mức vô hiệu hóa (Stop Invalidation), và Cản tiếp theo (Next Resistance)</strong>. R:R được tính theo giá vào khả dụng (Gross và Net sau phí 0.08%). Bắt buộc có cản mục tiêu cấu trúc hợp lệ và đạt tối thiểu 2.0R mới đủ điều kiện hiển thị trạng thái READY.
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

  const setupLabel = coin.setupType === SETUP_TYPES.PULLBACK ? 'Pullback Tiếp Diễn'
    : coin.setupType === SETUP_TYPES.BREAKOUT_RETEST ? 'Breakout – Retest'
    : 'Chưa có setup cụ thể (Đang theo dõi)';

  const triggerLow = coin.triggerZone?.low;
  const triggerHigh = coin.triggerZone?.high;

  return (
    <div className="scanner-details-panel">
      {/* 1. Reference Levels & Setup Card */}
      <div className="details-setup-summary-banner">
        <div className="setup-banner-head">
          <div className="setup-title-group">
            <Crosshair size={14} className="text-cyan-400" />
            <strong className="setup-type-name">{setupLabel}</strong>
            <span className={`conclusion-badge badge-${coin.status?.toLowerCase() || 'slate'}`}>
              {coin.status}
            </span>
          </div>
          {coin.distanceAtr !== null && (
            <span className="setup-distance-tag">
              Khoảng cách: <strong>+{coin.distanceAtr} ATR</strong> từ vùng trigger
            </span>
          )}
        </div>

        <div className="setup-levels-grid">
          <div className="level-box current-price">
            <span className="level-label">GIÁ FUTURES HIỆN TẠI</span>
            <span className="level-val text-contrast font-bold">
              {fmtPrice(coin.latestFuturesPrice || coin.currentPrice || coin.price)}
            </span>
            <small className="level-sub">
              {coin.confirmationPrice
                ? `Giá xác nhận: ${fmtPrice(coin.confirmationPrice)}`
                : coin.confirmedAt
                ? `Xác nhận: ${new Date(coin.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                : coin.formedAt
                ? `Hình thành: ${new Date(coin.formedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                : 'Đang theo dõi'}
            </small>
            {coin.confirmationPrice && coin.confirmedAt && (
              <small className="level-sub text-muted" style={{ display: 'block', marginTop: '2px' }}>
                Xác nhận: {new Date(coin.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </small>
            )}
            {coin.spotClose && (
              <small className="level-sub text-muted" style={{ display: 'block', marginTop: '1px' }}>
                (Spot đóng: {fmtPrice(coin.spotClose)})
              </small>
            )}
          </div>

          <div className="level-box trigger">
            <span className="level-label">VÙNG KÍCH HOẠT (TRIGGER)</span>
            <span className="level-val">
              {triggerLow && triggerHigh
                ? `${fmtPrice(triggerLow)} - ${fmtPrice(triggerHigh)}`
                : coin.triggerPrice ? fmtPrice(coin.triggerPrice) : '---'}
            </span>
            <small className="level-sub">Vùng swing/breakout tham chiếu</small>
          </div>

          <div className="level-box invalidation">
            <span className="level-label">MỨC VÔ HIỆU (STOP LEVEL)</span>
            <span className="level-val text-rose-400">
              {coin.invalidationLevel ? fmtPrice(coin.invalidationLevel) : '---'}
            </span>
            <small className="level-sub">Phá vỡ cấu trúc (-0.5 ATR buffer)</small>
          </div>

          <div className="level-box target">
            <span className="level-label">CẢN TIẾP THEO (TARGET)</span>
            <span className="level-val text-emerald-400">
              {coin.targetLevel ? fmtPrice(coin.targetLevel) : 'Chưa có cản swing rõ'}
            </span>
            <small className="level-sub">Swing đỉnh/đáy gần nhất</small>
          </div>

          <div className="level-box rr">
            <span className="level-label">TỶ LỆ R:R (GROSS / NET)</span>
            <span className="level-val text-contrast">
              {coin.rewardRiskRatio ? `${coin.rewardRiskRatio} R` : '---'}
              {coin.rewardRiskNet && <small className="rr-net"> ({coin.rewardRiskNet} R sau phí)</small>}
            </span>
            <small className="level-sub">Giả định phí/slippage 0.08%</small>
          </div>
        </div>

        {coin.setupReason && (
          <p className="setup-rationale-text font-bold">
            <Check size={12} className="text-emerald-400 inline mr-1" />
            {coin.setupReason}
          </p>
        )}
      </div>

      {/* 2. Contraction & PA Statement */}
      <div className="details-pa-banner">
        <div className="pa-badge">
          <Activity size={13} className="text-cyan-400" />
          <span>VI CẤU TRÚC NẾN (PRICE ACTION &amp; CO BIÊN ĐỘ):</span>
        </div>
        <div className="pa-metrics-split">
          <span className={`pa-metric-chip ${coin.contraction?.volumeContraction ? 'active' : ''}`}>
            Volume: <strong>{coin.contraction?.volumeContraction ? 'Co lại' : 'Bình thường'}</strong> ({coin.contraction?.volumeRatio}x)
          </span>
          <span className={`pa-metric-chip ${coin.contraction?.rangeContraction ? 'active' : ''}`}>
            Biên độ nến: <strong>{coin.contraction?.rangeContraction ? 'Co hẹp' : 'Bình thường'}</strong> ({coin.contraction?.rangeRatio}x ATR)
          </span>
          <span className="pa-statement-text font-bold">
            {coin.paContext?.statement || '4H cấu trúc nến đóng đang phát triển'}
          </span>
        </div>
      </div>

      {/* 3. Reasons and Warnings */}
      <div className="details-grid-two-col">
        <div className="details-insights-col">
          <div className="insights-block positive-block">
            <div className="insights-header">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="insights-title">TIÊU CHUẨN SỨC MẠNH ĐẠT ĐƯỢC:</span>
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
              <span className="insights-title">CẢNH BÁO VI CẤU TRÚC / CROWDING:</span>
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

        <div className="details-pillars-col">
          <div className="raw-metrics-bento">
            <div className="raw-metric-item">
              <span className="m-label">Độ bền RS24H</span>
              <span className="m-val text-emerald-400 font-bold">
                {coin.durabilityCount != null ? `${coin.durabilityCount}/${coin.durabilityTotal || 4} nến 1H` : '---'}
              </span>
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
            <div className="raw-metric-item">
              <span className="m-label">RS 1H vs BTC</span>
              <span className={`m-val ${coin.relativeStrength1h > 0 ? 'text-emerald-400' : coin.relativeStrength1h < 0 ? 'text-rose-400' : ''}`}>
                {fmtPct(coin.relativeStrength1h)}
              </span>
            </div>
            <div className="raw-metric-item">
              <span className="m-label">ATR 1H</span>
              <span className="m-val">{coin.atr1h ? `$${coin.atr1h.toFixed(3)}` : '---'}</span>
            </div>
            <div className="raw-metric-item">
              <span className="m-label">Độ dốc EMA21 4H</span>
              <span className="m-val">{fmtPct(coin.emaSlopePct)}</span>
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

// ── SUBCOMPONENT: 5-COLUMN TABLE ROW (SCANNER V8) ─────────────────────────────
function ScannerRow({ coin, rank, isExpanded, onToggle, direction }) {
  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

  const isLong = direction === 'BUY';
  const statusBadgeClass = coin.status === SETUP_STATES.READY ? 'badge-emerald'
    : coin.status === SETUP_STATES.FORMING ? 'badge-cyan'
    : coin.status === SETUP_STATES.WATCH ? 'badge-indigo'
    : coin.status === SETUP_STATES.EXTENDED ? 'badge-amber'
    : coin.status === SETUP_STATES.INVALIDATED ? 'badge-rose'
    : 'badge-slate';

  const setupName = coin.setupType === SETUP_TYPES.PULLBACK ? 'Pullback Tiếp Diễn'
    : coin.setupType === SETUP_TYPES.BREAKOUT_RETEST ? 'Breakout–Retest'
    : 'Theo Dõi Setup';

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
                <span className="price-num" title="Giá Futures hiện tại">{fmtPrice(coin.latestFuturesPrice || coin.currentPrice || coin.price)}</span>
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
            <span className="conclusion-badge badge-emerald">
              STRONG
            </span>
            <div className="strength-sub-text">
              <span>RS vs BTC: <strong>Top {100 - Math.round(isLong ? coin.strengthPercentile : (100 - coin.strengthPercentile))}%</strong></span>
              <span className="tf-trend-tag">
                {coin.isDailyUptrend ? '1D ▲' : coin.isDailyUptrend === false ? '1D ▼' : '1D ~'}
              </span>
            </div>
            <span className="durability-micro-tag">
              Độ bền 1H: {coin.durabilityCount || 0}/4 nến
            </span>
          </div>
        </td>

        {/* CỘT 3: SETUP / TRẠNG THÁI */}
        <td className="td-setup">
          <div className="setup-cell-wrap">
            <div className="setup-badge-row">
              <span className={`conclusion-badge ${statusBadgeClass}`}>
                {coin.status}
              </span>
              <span className="setup-type-tag">{setupName}</span>
            </div>
            <div className="setup-context-sub">
              {coin.confirmedAt ? (
                <span className="setup-confirmed-time">
                  Xác nhận {new Date(coin.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : coin.formedAt ? (
                <span className="setup-formed-time">
                  Tạo {new Date(coin.formedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : null}
              {coin.distanceAtr !== null ? (
                <span>Cách trigger: <strong>{coin.distanceAtr} ATR</strong></span>
              ) : (
                <span>Đang theo dõi nến 1H</span>
              )}
            </div>
          </div>
        </td>

        {/* CỘT 4: KHOẢNG TRỐNG / R:R */}
        <td className="td-rr">
          <div className="rr-cell-wrap">
            {coin.rewardRiskRatio ? (
              <div className="rr-main-block">
                <span className="rr-numeric font-extrabold text-emerald-400">
                  {coin.rewardRiskRatio} R
                </span>
                {coin.rewardRiskNet && (
                  <span className="rr-net-sub">
                    ({coin.rewardRiskNet} R sau phí)
                  </span>
                )}
              </div>
            ) : (
              <span className="rr-na-text text-muted">--- (chưa định target)</span>
            )}
            {coin.invalidationLevel && (
              <div className="invalidation-micro-sub">
                Dừng: <strong>{fmtPrice(coin.invalidationLevel)}</strong>
              </div>
            )}
          </div>
        </td>

        {/* CỘT 5: FLOW */}
        <td className="td-flow">
          <div className="flow-cell-wrap">
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

  const statusBadgeClass = coin.status === SETUP_STATES.READY ? 'badge-emerald'
    : coin.status === SETUP_STATES.FORMING ? 'badge-cyan'
    : coin.status === SETUP_STATES.WATCH ? 'badge-indigo'
    : coin.status === SETUP_STATES.EXTENDED ? 'badge-amber'
    : coin.status === SETUP_STATES.INVALIDATED ? 'badge-rose'
    : 'badge-slate';

  const setupName = coin.setupType === SETUP_TYPES.PULLBACK ? 'Pullback Tiếp Diễn'
    : coin.setupType === SETUP_TYPES.BREAKOUT_RETEST ? 'Breakout–Retest'
    : 'Theo Dõi Setup';

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
            <span className="price-num">{fmtPrice(coin.latestFuturesPrice || coin.currentPrice || coin.price)}</span>
          </div>
        </div>

        <div className="mobile-card-score-group">
          <span className={`conclusion-badge ${statusBadgeClass}`}>
            {coin.status}
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
        <span className="mobile-setup-tag">{setupName}</span>
        {coin.confirmedAt && (
          <span className="mobile-confirmed-tag">
            Xác nhận {new Date(coin.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {coin.rewardRiskRatio && (
          <span className="mobile-rr-tag font-bold text-emerald-400">
            R:R {coin.rewardRiskRatio}R
          </span>
        )}
        {coin.distanceAtr !== null && (
          <span className="mobile-atr-tag">
            {coin.distanceAtr} ATR
          </span>
        )}
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

// ── SUBCOMPONENT: 24H / 7D TRACKING SUMMARY VIEW ─────────────────────────────
function TrackingSummaryView({ trackingData, isLoading, viewMode }) {
  if (isLoading) {
    return (
      <div className="scanner-skeleton-loader glass-panel">
        <RefreshCw size={24} className="spin text-cyan-400" />
        <p className="loading-text">
          Đang truy vấn lịch sử tracking {viewMode === 'TRACKING_7D' ? '7 ngày' : '24 giờ'} từ IndexedDB...
        </p>
      </div>
    );
  }

  const tfLabel = viewMode === 'TRACKING_7D' ? '7 Ngày Qua' : '24 Giờ Qua';
  const leaders = trackingData?.leaders || [];
  const winRate = trackingData?.winRate;
  const avgRelReturn = trackingData?.avgRelReturn24h;
  const bestPerformer = trackingData?.bestPerformer;

  return (
    <div className="scanner-tracking-panel">
      {/* 1. Bento Metric Banner */}
      <div className="tracking-metric-banner glass-panel">
        <div className="track-stat-card">
          <span className="track-stat-label">
            <Award size={13} className="text-amber-400 inline mr-1" />
            LEADERS GHI NHẬN ({tfLabel.toUpperCase()})
          </span>
          <span className="track-stat-value text-contrast">
            {trackingData?.totalTrackedCoins || leaders.length} <small>coin vào bảng</small>
          </span>
          <span className="track-stat-sub">
            Xếp hạng theo độ bền bỉ &amp; tần suất giữ vị thế
          </span>
        </div>

        <div className="track-stat-card">
          <span className="track-stat-label">
            <Target size={13} className="text-emerald-400 inline mr-1" />
            TỶ LỆ THẮNG SETUP (WIN RATE)
          </span>
          <span className="track-stat-value text-emerald-400 font-bold">
            {winRate !== null ? `${winRate}%` : 'Đang đo lường'}
          </span>
          <span className="track-stat-sub">
            {trackingData?.winCount || 0} win / {(trackingData?.winCount || 0) + (trackingData?.lossCount || 0)} kèo chạm cản hoặc dừng lỗ
          </span>
        </div>

        <div className="track-stat-card">
          <span className="track-stat-label">
            <TrendingUp size={13} className="text-cyan-400 inline mr-1" />
            HIỆU SUẤT VS BITCOIN
          </span>
          <span className={`track-stat-value font-bold ${avgRelReturn && avgRelReturn > 0 ? 'text-emerald-400' : 'text-contrast'}`}>
            {avgRelReturn !== null ? `${avgRelReturn > 0 ? '+' : ''}${avgRelReturn}%` : '---'}
          </span>
          <span className="track-stat-sub">Mức vượt trội trung bình 24H so với BTC</span>
        </div>

        <div className="track-stat-card">
          <span className="track-stat-label">
            <Flame size={13} className="text-rose-400 inline mr-1" />
            ĐỈNH SÓNG CAO NHẤT (BEST MFE)
          </span>
          <span className="track-stat-value text-rose-400 font-bold">
            {bestPerformer?.peakGainPct ? `+${bestPerformer.peakGainPct}%` : '---'}
          </span>
          <span className="track-stat-sub">
            {bestPerformer?.symbol || 'Đang theo dõi chu kỳ'}
          </span>
        </div>
      </div>

      {/* 2. Persistent Leaders Table */}
      <div className="scanner-table-wrapper glass-panel">
        <div className="tracking-table-header">
          <div className="tracking-title-wrap">
            <History size={16} className="text-cyan-400" />
            <h3 className="tracking-title">
              TOP COIN TRỤ BẢNG BỀN BỈ &amp; KẾT QUẢ THEO DÕI ({tfLabel.toUpperCase()})
            </h3>
          </div>
          <span className="tracking-note text-muted">
            Tự động lưu vết IndexedDB · Xếp hạng theo độ bền bỉ (tần suất giữ vị thế) và mức tăng tối đa
          </span>
        </div>

        {leaders.length === 0 ? (
          <div className="scanner-empty-state">
            <Clock size={36} className="text-cyan-400" />
            <h4 className="empty-heading font-bold">Chưa có đủ lịch sử quét cho chu kỳ {tfLabel}</h4>
            <p className="empty-sub">
              Hệ thống lưu vết tự động vào IndexedDB ở mỗi lần quét. Hãy tiếp tục sử dụng Scanner để hệ thống tích lũy dữ liệu tracking!
            </p>
          </div>
        ) : (
          <div className="table-responsive-scroll">
            <table className="scanner-table table-five-col tracking-table">
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>COIN &amp; HƯỚNG</th>
                  <th style={{ width: '24%' }}>ĐỘ BỀN BỈ (PERSISTENCE)</th>
                  <th style={{ width: '18%' }}>GIÁ VÀO / CẢN</th>
                  <th style={{ width: '18%' }}>MỨC TĂNG TỐI ĐA (PEAK)</th>
                  <th style={{ width: '18%' }}>KẾT QUẢ / TRẠNG THÁI</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((coin, idx) => {
                  const isWin = coin.resolution === 'TRIGGERED_WIN';
                  const isLoss = coin.resolution === 'TRIGGERED_LOSS';
                  const isRunning = coin.resolution === 'RUNNING' || coin.latestStatus === 'READY';
                  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

                  return (
                    <tr key={`${coin.symbol}_${idx}`} className="scanner-row">
                      <td className="td-coin-primary">
                        <div className="coin-cell-layout">
                          <span className={`rank-badge rank-${idx + 1}`}>#{idx + 1}</span>
                          <div className="coin-meta">
                            <a
                              href={tvChartUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="coin-symbol-link"
                              title="Mở TradingView Chart"
                            >
                              <strong className="symbol-base">{coin.baseAsset || coin.symbol}</strong>
                              <ExternalLink size={10} className="link-ext-icon" />
                            </a>
                            <div className="coin-price-row">
                              <span className={`conclusion-badge ${coin.direction === 'LONG' ? 'badge-emerald' : 'badge-rose'}`}>
                                {coin.direction}
                              </span>
                              <span className="price-num">{fmtPrice(coin.latestPrice)}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="td-strength">
                        <div className="tracking-persistence-cell">
                          <span className="persistence-badge font-bold text-contrast">
                            Xuất hiện {coin.appearanceCount} lần quét
                          </span>
                          <span className="persistence-hours text-muted">
                            Duy trì: ~{coin.hoursSpan} giờ
                          </span>
                          <div className="persistence-bar-track">
                            <div
                              className="persistence-bar-fill"
                              style={{ width: `${Math.min(100, (coin.appearanceCount / (viewMode === 'TRACKING_7D' ? 40 : 12)) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="td-setup">
                        <div className="tracking-levels-cell">
                          <span className="track-level-entry">
                            Entry: <strong>{fmtPrice(coin.initialPrice || coin.latestPrice)}</strong>
                          </span>
                          {coin.targetLevel && (
                            <span className="track-level-target text-emerald-400">
                              Target: {fmtPrice(coin.targetLevel)}
                            </span>
                          )}
                          {coin.rewardRiskRatio && (
                            <span className="track-level-rr text-muted">
                              R:R: {coin.rewardRiskRatio}R
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="td-rr">
                        <div className="tracking-peak-cell">
                          {coin.peakGainPct != null ? (
                            <span className="peak-gain-badge text-emerald-400 font-extrabold">
                              +{coin.peakGainPct}%
                            </span>
                          ) : (
                            <span className="text-muted">Đang theo dõi</span>
                          )}
                          {coin.relReturnVsBtc != null && (
                            <small className={`rel-btc-sub ${coin.relReturnVsBtc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {coin.relReturnVsBtc >= 0 ? '+' : ''}{coin.relReturnVsBtc}% vs BTC
                            </small>
                          )}
                        </div>
                      </td>

                      <td className="td-flow">
                        <div className="tracking-status-cell">
                          {isWin ? (
                            <span className="conclusion-badge badge-emerald">
                              TARGET HIT 🎯
                            </span>
                          ) : isLoss ? (
                            <span className="conclusion-badge badge-rose">
                              STOPPED ⛔
                            </span>
                          ) : isRunning ? (
                            <span className="conclusion-badge badge-cyan">
                              RUNNING ⏳
                            </span>
                          ) : (
                            <span className="conclusion-badge badge-slate">
                              {coin.latestStatus}
                            </span>
                          )}
                          <span className="track-date-time text-muted">
                            Lần cuối: {new Date(coin.lastSeen).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN SCANNER TAB COMPONENT ────────────────────────────────────────────────
export default function ScannerTab({ data = {}, btcChange24h = null, etfHistory = [] }) {
  const [scanResult, setScanResult] = useState({
    topBuy: [],
    topSell: [],
    allCandidates: { buy: [], sell: [] },
    scannedCount: 0,
    qualifiedCount: 0,
    errorState: null,
    timestamp: 0,
  });
  const [isScanning, setIsScanning] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(300);
  const [activeDirection, setActiveDirection] = useState('BUY'); // 'BUY' | 'SELL'
  const [activeStatusFilter, setActiveStatusFilter] = useState('ALL'); // 'ALL' | 'READY' | 'FORMING' | 'WATCH' | 'EXTENDED'
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const [viewMode, setViewMode] = useState('LIVE'); // 'LIVE' | 'TRACKING_24H' | 'TRACKING_7D'
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  const [trackingData, setTrackingData] = useState(null);
  const [isLoadingTracking, setIsLoadingTracking] = useState(false);

  const loadTracking = useCallback(async (mode) => {
    if (mode === 'LIVE') return;
    setIsLoadingTracking(true);
    try {
      const tf = mode === 'TRACKING_7D' ? '7d' : '24h';
      const summary = await getTrackingSummary(tf);
      if (viewModeRef.current === mode) {
        setTrackingData(summary);
      }
    } catch (e) {
      console.error('[ScannerTab] Error loading tracking summary:', e);
    } finally {
      if (viewModeRef.current === mode) {
        setIsLoadingTracking(false);
      }
    }
  }, []);

  const handleSelectViewMode = (mode) => {
    viewModeRef.current = mode;
    setViewMode(mode);
    if (mode !== 'LIVE') {
      loadTracking(mode);
    }
  };

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
      if (viewMode !== 'LIVE') {
        loadTracking(viewMode);
      }
    } catch (e) {
      console.error('[ScannerTab] Scan error:', e);
      setScanResult(prev => ({ ...prev, errorState: 'PROVIDER_UNAVAILABLE' }));
    } finally {
      setIsScanning(false);
    }
  }, [btcChange24h, fallbackBtcChange, etfHistory, viewMode, loadTracking]);

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

  const rawDirectionCoins = useMemo(() => {
    return activeDirection === 'BUY'
      ? (scanResult.allCandidates?.buy?.length ? scanResult.allCandidates.buy : scanResult.topBuy || [])
      : (scanResult.allCandidates?.sell?.length ? scanResult.allCandidates.sell : scanResult.topSell || []);
  }, [activeDirection, scanResult.allCandidates, scanResult.topBuy, scanResult.topSell]);

  const filteredCoins = useMemo(() => {
    if (activeStatusFilter === 'ALL') {
      // Default: top 8 prioritized results (expanded from 5 to prevent churn dropoff)
      return activeDirection === 'BUY'
        ? (scanResult.allCandidates?.buy?.length ? scanResult.allCandidates.buy.slice(0, 8) : scanResult.topBuy || [])
        : (scanResult.allCandidates?.sell?.length ? scanResult.allCandidates.sell.slice(0, 8) : scanResult.topSell || []);
    }
    return rawDirectionCoins.filter(coin => coin.status === activeStatusFilter).slice(0, 8);
  }, [rawDirectionCoins, activeStatusFilter, activeDirection, scanResult.allCandidates, scanResult.topBuy, scanResult.topSell]);

  const statusCounts = useMemo(() => {
    const counts = { ALL: rawDirectionCoins.length, READY: 0, FORMING: 0, WATCH: 0, EXTENDED: 0, INVALIDATED: 0 };
    rawDirectionCoins.forEach(coin => {
      if (counts[coin.status] !== undefined) counts[coin.status] += 1;
    });
    return counts;
  }, [rawDirectionCoins]);

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
          <h4 className="empty-heading font-bold">Độ phủ dữ liệu hoặc Benchmark BTC chưa đủ</h4>
          <p className="empty-sub">
            Thiếu nến 1H/4H/Daily đóng hoặc BTC benchmark để đo lường sức mạnh và setup an toàn.
          </p>
        </div>
      );
    }

    return (
      <div className="scanner-empty-state">
        <ShieldCheck size={36} className="text-amber-400" />
        <h4 className="empty-heading font-bold">
          Không có coin nào đạt cửa lọc sức mạnh cho chiều {activeDirection === 'BUY' ? 'LONG (MUA)' : 'SHORT (BÁN)'} lúc này.
        </h4>
        <p className="empty-sub">
          Bộ lọc v8 giữ kỷ luật: Chỉ hiển thị coin nằm trong <strong>Top 30% RS vs BTC, EMA21 &gt; EMA55 có độ dốc, giá đóng 4H trên EMA21, và RS24H bền vững &ge; 3/4 nến 1H</strong> để loại trừ tín hiệu nhiễu.
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
                <h2 className="scanner-title">SCANNER V8 — LỌC SỨC MẠNH TRƯỚC, XÁC NHẬN SETUP SAU</h2>
                <span className="algo-version-tag">v8</span>
              </div>
              <p className="scanner-subtitle">
                Đa khung thời gian: <strong>1D bối cảnh · 4H xu hướng · 1H xác nhận setup</strong>. Hai mẫu hình: Pullback tiếp diễn &amp; Breakout–Retest.
              </p>
            </div>
          </div>
        </div>

        <div className="scanner-header-right">
          <button
            className="btn-methodology-drawer"
            onClick={() => setIsMethodologyOpen(true)}
            title="Xem cách scanner v8 hoạt động"
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
            <span>{isScanning ? 'Đang Lọc Setup...' : 'Quét Ngay'}</span>
          </button>
        </div>
      </div>

      {/* ── VIEW MODE SELECTOR (LIVE / 24H TRACKING / 7D TRACKING) ───────── */}
      <div className="view-mode-toggle-group">
        <button
          className={`btn-mode-tab ${viewMode === 'LIVE' ? 'active' : ''}`}
          onClick={() => handleSelectViewMode('LIVE')}
        >
          <Zap size={14} />
          <span>THỜI GIAN THỰC (LIVE)</span>
        </button>
        <button
          className={`btn-mode-tab ${viewMode === 'TRACKING_24H' ? 'active' : ''}`}
          onClick={() => handleSelectViewMode('TRACKING_24H')}
        >
          <History size={14} />
          <span>BẢNG THEO DÕI 24 GIỜ</span>
        </button>
        <button
          className={`btn-mode-tab ${viewMode === 'TRACKING_7D' ? 'active' : ''}`}
          onClick={() => handleSelectViewMode('TRACKING_7D')}
        >
          <Award size={14} />
          <span>BẢNG THEO DÕI 7 NGÀY</span>
        </button>
      </div>

      {viewMode !== 'LIVE' ? (
        <TrackingSummaryView
          trackingData={trackingData}
          isLoading={isLoadingTracking}
          viewMode={viewMode}
        />
      ) : (
        <>
          {/* ── DUAL DIRECTION TAB SWITCHER & STATUS FILTERS ───────────────────── */}
          <div className="scanner-direction-bar">
            <div className="direction-toggle-group">
              <button
                onClick={() => setActiveDirection('BUY')}
                className={`btn-direction-tab ${activeDirection === 'BUY' ? 'active buy-active' : ''}`}
              >
                <TrendingUp size={16} />
                <span>TOP LONG (BUY)</span>
                <span className="chip-count buy">
                  {scanResult.topBuy?.length || 0}
                </span>
              </button>

              <button
                onClick={() => setActiveDirection('SELL')}
                className={`btn-direction-tab ${activeDirection === 'SELL' ? 'active sell-active' : ''}`}
              >
                <TrendingDown size={16} />
                <span>TOP SHORT (SELL)</span>
                <span className="chip-count sell">
                  {scanResult.topSell?.length || 0}
                </span>
              </button>
            </div>

            <div className="status-filter-group">
              <button
                className={`filter-chip ${activeStatusFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setActiveStatusFilter('ALL')}
              >
                Ưu Tiên Top 8
              </button>
              <button
                className={`filter-chip chip-ready ${activeStatusFilter === 'READY' ? 'active' : ''}`}
                onClick={() => setActiveStatusFilter('READY')}
              >
                READY ({statusCounts.READY})
              </button>
              <button
                className={`filter-chip chip-forming ${activeStatusFilter === 'FORMING' ? 'active' : ''}`}
                onClick={() => setActiveStatusFilter('FORMING')}
              >
                FORMING ({statusCounts.FORMING})
              </button>
              <button
                className={`filter-chip chip-watch ${activeStatusFilter === 'WATCH' ? 'active' : ''}`}
                onClick={() => setActiveStatusFilter('WATCH')}
              >
                WATCH ({statusCounts.WATCH})
              </button>
              <button
                className={`filter-chip chip-extended ${activeStatusFilter === 'EXTENDED' ? 'active' : ''}`}
                onClick={() => setActiveStatusFilter('EXTENDED')}
              >
                EXTENDED ({statusCounts.EXTENDED})
              </button>
              {statusCounts.INVALIDATED > 0 && (
                <button
                  className={`filter-chip chip-invalidated ${activeStatusFilter === 'INVALIDATED' ? 'active' : ''}`}
                  onClick={() => setActiveStatusFilter('INVALIDATED')}
                >
                  INVALIDATED ({statusCounts.INVALIDATED})
                </button>
              )}
            </div>

            <div className="scanner-universe-info">
              <span className="universe-stat-item">
                Quét: <strong>{scanResult.scannedCount || 0} coin</strong>
              </span>
              <span className="stat-separator">·</span>
              <span className="universe-stat-item">
                Quality Gate: <strong>{scanResult.qualifiedCount || 0} coin</strong>
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

          {/* ── MAIN SCANNER TABLE (DESKTOP 5-COLUMNS: Coin · Strength · Setup · R:R · Flow) ── */}
          <div className="scanner-table-wrapper glass-panel hide-on-mobile">
            {isScanning && filteredCoins.length === 0 ? (
              <div className="scanner-skeleton-loader">
                <RefreshCw size={24} className="spin text-amber-400" />
                <p className="loading-text">Đang kiểm tra 5 cửa lọc: Dữ liệu · Thanh khoản · Sức mạnh · Setup · Vị trí giá...</p>
              </div>
            ) : filteredCoins.length === 0 ? (
              renderEmptyOrErrorState()
            ) : (
              <div className="table-responsive-scroll">
                <table className="scanner-table table-five-col">
                  <thead>
                    <tr>
                      <th style={{ width: '22%' }}>COIN</th>
                      <th style={{ width: '20%' }}>STRENGTH</th>
                      <th style={{ width: '24%' }}>SETUP / TRẠNG THÁI</th>
                      <th style={{ width: '18%' }}>KHOẢNG TRỐNG / R:R</th>
                      <th style={{ width: '16%' }}>FLOW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCoins.map((coin, index) => (
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
            {isScanning && filteredCoins.length === 0 ? (
              <div className="scanner-skeleton-loader glass-panel">
                <RefreshCw size={24} className="spin text-amber-400" />
                <p className="loading-text">Đang lọc setup Scanner v8...</p>
              </div>
            ) : filteredCoins.length === 0 ? (
              <div className="glass-panel">{renderEmptyOrErrorState()}</div>
            ) : (
              <div className="mobile-cards-list">
                {filteredCoins.map((coin, index) => (
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
        </>
      )}

      {/* ── METHODOLOGY DRAWER MODAL ───────────────────────────────────────── */}
      <ScannerMethodologyDrawer
        isOpen={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />
    </div>
  );
}

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Terminal */
import React, { useState, useEffect } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import { getBiasSnapshots, recordBiasSnapshot } from '../services/biasSnapshotStore';
import ModuleMenu from './ModuleMenu';
import {
  ChevronDown, ChevronUp, AlertTriangle, Activity, Gauge, Filter, X,
  Clock, Database, Zap, HelpCircle, History, TrendingUp, TrendingDown
} from 'lucide-react';

const fmt = (n, decimals = 0) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '---';
const fmtB = (n) => n != null ? `$${(n / 1e9).toFixed(1)}B` : '---';

function BiasSparkline({ snapshots, color }) {
  const validSnapshots = snapshots
    .filter((snapshot) => Number.isFinite(Number(snapshot?.biasScore)))
    .slice(-30);

  if (validSnapshots.length < 2) {
    return (
      <div className="bias-sparkline-empty" role="status">
        <span className="bias-sparkline-empty-line" />
        <span>Đang tích lũy lịch sử realtime · {validSnapshots.length}/2 điểm</span>
      </div>
    );
  }

  const width = 260;
  const height = 66;
  const xPadding = 4;
  const yPadding = 7;
  const scores = validSnapshots.map((snapshot) => Math.max(-100, Math.min(100, Number(snapshot.biasScore))));
  const minScore = Math.min(...scores, 0);
  const maxScore = Math.max(...scores, 0);
  const scoreRange = Math.max(20, maxScore - minScore);
  const chartMin = Math.max(-100, minScore - scoreRange * 0.18);
  const chartMax = Math.min(100, maxScore + scoreRange * 0.18);
  const chartRange = Math.max(1, chartMax - chartMin);
  const points = scores.map((score, index) => {
    const x = xPadding + (index / (scores.length - 1)) * (width - xPadding * 2);
    const y = yPadding + ((chartMax - score) / chartRange) * (height - yPadding * 2);
    return { x, y, score };
  });
  const polyline = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${points[0].x.toFixed(1)},${height - yPadding} ${polyline} ${points[points.length - 1].x.toFixed(1)},${height - yPadding}`;
  const zeroY = yPadding + ((chartMax - 0) / chartRange) * (height - yPadding * 2);
  const firstScore = scores[0];
  const lastScore = scores[scores.length - 1];
  const delta = lastScore - firstScore;
  const gradientId = `bias-sparkline-fill-${delta >= 0 ? 'up' : 'down'}`;
  const firstSnapshot = validSnapshots[0];
  const lastSnapshot = validSnapshots[validSnapshots.length - 1];
  const directionLabel = delta > 0 ? 'Tăng' : delta < 0 ? 'Giảm' : 'Không đổi';

  return (
    <div className="bias-sparkline-block">
      <div className="bias-sparkline-meta">
        <span className="bias-sparkline-label">XU HƯỚNG SNAPSHOT GẦN NHẤT</span>
        <span className={`bias-sparkline-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'}`}>
          {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : null}
          {delta >= 0 ? '+' : ''}{delta.toFixed(0)} điểm
        </span>
      </div>

      <svg
        className="bias-sparkline-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${directionLabel} ${Math.abs(delta).toFixed(0)} điểm qua ${validSnapshots.length} snapshot realtime`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {zeroY >= yPadding && zeroY <= height - yPadding && (
          <line className="bias-sparkline-zero" x1="0" y1={zeroY} x2={width} y2={zeroY} />
        )}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline className="bias-sparkline-path" points={polyline} style={{ stroke: color }} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.2" fill={color} />
      </svg>

      <div className="bias-sparkline-axis">
        <span>{firstSnapshot.dateStr} {firstSnapshot.timeStr}</span>
        <span>{validSnapshots.length} điểm thực</span>
        <span>{lastSnapshot.dateStr} {lastSnapshot.timeStr}</span>
      </div>
    </div>
  );
}

export default function MarketBiasCard({ data, etfHistory, btcDisplay, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [activePillarFilter, setActivePillarFilter] = useState(null); // null | 'microstructure' | 'onChain' | 'institutional' | 'newsRisk'
  const [snapshots, setSnapshots] = useState(() => getBiasSnapshots(30));

  const livePrice = btcDisplay?.price ?? data?.btc?.price;
  const liveChange = btcDisplay?.change ?? data?.btc?.change ?? 0;

  const bias = calculateMarketBias(data, etfHistory, { livePrice, liveChange });

  // Auto-record real-time snapshot without look-ahead bias
  useEffect(() => {
    if (livePrice && bias?.score != null && bias.confidence > 0) {
      const snap = recordBiasSnapshot({
        btcPrice: livePrice,
        btcChange24h: liveChange,
        biasScore: bias.score,
        confidence: bias.confidence,
        confirmationState: bias.confirmation?.state,
        confirmationLabel: bias.confirmation?.label,
        oldestSource: bias.freshness?.oldestDataStr,
        regimeTrend: bias.regime?.trend,
      });
      if (snap) {
        setSnapshots(getBiasSnapshots(30));
      }
    }
  }, [livePrice, liveChange, bias?.score, bias?.confidence, bias?.confirmation?.state, bias?.freshness?.oldestDataStr, bias?.regime?.trend]);

  const formatPillarScore = (val) => `${val >= 0 ? '+' : ''}${val}`;

  const getPillarStatus = (val) => {
    if (val >= 40) return { color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', label: 'MẠNH ▲' };
    if (val > 10) return { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', label: 'TÍCH CỰC' };
    if (val >= -10) return { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', label: 'TRUNG LẬP' };
    if (val > -40) return { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', label: 'TIÊU CỰC' };
    return { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', label: 'YẾU ▼' };
  };

  // Convert score (-100 to +100) to percentage (0% to 100%)
  const scorePercent = Math.min(100, Math.max(0, ((bias.score + 100) / 200) * 100));

  const pillarsList = [
    {
      key: 'institutional',
      code: '01',
      title: 'DÒNG TIỀN ĐỊNH CHẾ',
      weight: '40%',
      subtext: 'BTC Spot ETF 7D Net Flow, CME COT',
      score: bias.pillars.institutional,
      maxPts: 100,
    },
    {
      key: 'onChain',
      code: '02',
      title: 'ON-CHAIN & MẠNG LƯỚI',
      weight: '25%',
      subtext: 'MVRV Anchor, SSR Z-Score, Addrs, Mining Floor, Tx Demand',
      score: bias.pillars.onChain,
      maxPts: 100,
    },
    {
      key: 'newsRisk',
      code: '03',
      title: 'VĨ MÔ & THANH KHOẢN',
      weight: '20%',
      subtext: 'Fed/CPI Pulse, Net Liquidity, HY Spread, DXY, 10Y, VIX',
      score: bias.pillars.newsRisk,
      maxPts: 100,
    },
    {
      key: 'microstructure',
      code: '04',
      title: 'VI CẤU TRÚC & XU HƯỚNG',
      weight: '15%',
      subtext: 'BTC Daily MA50/200, CVD, Funding Confluence, OI, F&G',
      score: bias.pillars.microstructure,
      maxPts: 100,
    },
  ];

  const pillarMetaMap = {
    institutional: { code: '01', label: 'ETF FLOW' },
    onChain: { code: '02', label: 'ON-CHAIN' },
    newsRisk: { code: '03', label: 'MACRO' },
    microstructure: { code: '04', label: 'TREND/MICRO' },
  };

  const handlePillarClick = (pillarKey) => {
    if (activePillarFilter === pillarKey) {
      setActivePillarFilter(null);
    } else {
      setActivePillarFilter(pillarKey);
      setExpanded(true); // Auto expand drawer when selecting a pillar
    }
  };

  const activePillarObj = pillarsList.find(p => p.key === activePillarFilter);
  const regime = bias.regime || {};
  const confirmation = bias.confirmation || {};

  return (
    <div className="glass-panel bias-card-container hallmark-bias-card">
      {/* ── Top Header Toolbar ────────────────────────────────────────── */}
      <div className="bias-card-header">
        <div className="bias-header-left">
          <div className="bias-title-badge">
            <Gauge size={16} className="text-emerald-400" />
            <h3 className="bias-title font-mono">MARKET BIAS ENGINE</h3>
          </div>
          <span className="bias-confidence-pill font-mono">
            ĐỘ TIN CẬY: <strong className="text-contrast">{bias.confidence}%</strong>
          </span>
          <span className="bias-benchmark-badge font-mono">
            BENCHMARK ĐỐI CHỨNG
          </span>
        </div>

        <div className="bias-header-right">
          {activePillarFilter && (
            <button
              type="button"
              className="bias-clear-filter-btn font-mono"
              onClick={() => setActivePillarFilter(null)}
              title="Bỏ lọc trụ cột"
            >
              <X size={12} />
              <span>BỎ LỌC TRỤ CỘT</span>
            </button>
          )}

          <button
            type="button"
            className={`bias-toggle-btn font-mono ${showSnapshots ? 'is-active-btn' : ''}`}
            onClick={() => setShowSnapshots(!showSnapshots)}
            title="Xem lịch sử snapshot thực tế (Không look-ahead)"
          >
            <History size={13} />
            <span>{showSnapshots ? 'ẨN LỊCH SỬ' : 'LỊCH SỬ SNAPSHOT'}</span>
          </button>

          <button
            type="button"
            className="bias-toggle-btn font-mono"
            onClick={() => setExpanded(!expanded)}
          >
            <Activity size={13} />
            <span>{expanded ? 'THU GỌN' : 'CHI TIẾT TÍN HIỆU'}</span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* ── 3-Layer Bias Regime Chips ─────────────────────────────────── */}
      <div className="bias-regime-bar font-mono">
        <div className="bias-regime-chip">
          <span className="chip-label">TREND: </span>
          <strong style={{ color: regime.trend?.includes('UPTREND') ? '#34d399' : regime.trend?.includes('DOWNTREND') ? '#f87171' : 'var(--text-contrast)' }}>
            {regime.trend || 'UNKNOWN'}
          </strong>
        </div>
        <div className="bias-regime-chip">
          <span className="chip-label">VALUATION: </span>
          <strong style={{ color: regime.valuation === 'DEEP_VALUE' || regime.valuation === 'UNDERVALUED' ? '#34d399' : regime.valuation === 'OVERHEATED' ? '#f87171' : 'var(--text-contrast)' }}>
            {regime.valuation || 'FAIR_VALUE'}
          </strong>
        </div>
        <div className="bias-regime-chip">
          <span className="chip-label">LIQUIDITY: </span>
          <strong style={{ color: regime.liquidity === 'EXPANDING' ? '#34d399' : regime.liquidity === 'CONTRACTING' ? '#f87171' : 'var(--text-contrast)' }}>
            {regime.liquidity || 'NEUTRAL'}
          </strong>
        </div>
        <div className="bias-regime-chip">
          <span className="chip-label">TACTICAL: </span>
          <strong style={{ color: regime.tactical?.includes('SHORT_SQUEEZE') || regime.tactical?.includes('ACCUMULATION') ? '#34d399' : regime.tactical?.includes('LONG_SQUEEZE') || regime.tactical?.includes('DISTRIBUTION') ? '#f87171' : 'var(--text-contrast)' }}>
            {regime.tactical || 'BALANCED'}
          </strong>
        </div>
      </div>

      {/* ── Dual-Benchmark Cards Grid (BTC Price vs Market Bias) ────── */}
      <div className="bias-dual-grid">
        {/* Left: BTC Price Benchmark (Đối chứng khách quan) */}
        <div className="bias-benchmark-card font-mono">
          <div className="bias-card-top-tag">
            <span className="tag-label">BTC PRICE</span>
            <span className="tag-role-pill">ĐỐI CHỨNG KHÁCH QUAN</span>
          </div>

          <div className="bias-benchmark-val-row">
            <div className="bias-price-num text-contrast">
              {livePrice ? `$${fmt(livePrice, 0)}` : '---'}
              <span className="bias-currency-unit"> USD</span>
            </div>
            <div className={`bias-change-pill ${liveChange >= 0 ? 'is-up text-emerald' : 'is-down text-rose'}`}>
              {liveChange >= 0 ? '▲ +' : '▼ '}{liveChange != null ? liveChange.toFixed(2) : '0.00'}% (24H)
            </div>
          </div>

          <div className="bias-benchmark-meta-footer">
            <span className="meta-item">
              <Clock size={11} className="meta-icon text-slate-400" /> Price updated: <strong className="text-contrast">{bias.freshness?.priceUpdatedStr || 'Live'}</strong>
            </span>
            <span className="meta-item">
              Vol 24H: <strong className="text-contrast">{data?.btc?.volume ? fmtB(data.btc.volume) : '---'}</strong>
            </span>
          </div>
        </div>

        {/* Right: Market Bias Engine Model */}
        <div className="bias-benchmark-card font-mono" style={{ borderColor: `${bias.color}40`, background: bias.bgGradient }}>
          <div className="bias-card-top-tag">
            <span className="tag-label">MARKET BIAS SCORE</span>
            <span className="tag-confidence-badge">
              Confidence: <strong className="text-contrast">{bias.confidence}%</strong>
            </span>
          </div>

          <div className="bias-benchmark-val-row">
            <div className="bias-score-num" style={{ color: bias.color }}>
              {bias.score >= 0 ? `+${bias.score}` : bias.score}
              <span className="bias-score-status" style={{ color: bias.color }}> {bias.label}</span>
            </div>
            <span className="bias-score-scale-denom text-slate-400">/ 100</span>
          </div>

          <BiasSparkline snapshots={snapshots} color={bias.color} />

          <div className="bias-benchmark-meta-footer">
            <span className="meta-item">
              <Database size={11} className="meta-icon text-slate-400" /> Data oldest: <strong className="text-contrast">{bias.freshness?.oldestDataStr || 'Live'}</strong>
            </span>
            <span className="meta-item">
              Zero-Fallback: <strong className="text-emerald">{bias.confidence >= 60 ? 'PASS' : 'PARTIAL'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ── Bias–Price Confirmation / Divergence Status Banner ───────── */}
      <div
        className="bias-confirmation-banner font-mono"
        style={{
          borderColor: confirmation.border || 'rgba(148,163,184,0.25)',
          backgroundColor: confirmation.bg || 'rgba(148,163,184,0.08)',
        }}
      >
        <div className="bias-confirmation-header">
          <div className="bias-conf-title-group">
            <Zap size={14} style={{ color: confirmation.color || '#94a3b8' }} />
            <span className="bias-conf-title" style={{ color: confirmation.color || '#94a3b8' }}>
              TRẠNG THÁI KẾT HỢP: <strong>{confirmation.label?.toUpperCase() || 'TRUNG LẬP'}</strong>
            </span>
          </div>
          <span
            className="bias-conf-badge"
            style={{
              color: confirmation.color || '#94a3b8',
              borderColor: confirmation.border || 'rgba(148,163,184,0.3)',
            }}
          >
            {confirmation.shortLabel || 'TRUNG LẬP ⚖'}
          </span>
        </div>
        <div className="bias-conf-desc">
          {confirmation.description || 'Tín hiệu Bias và hành vi giá đang ở trạng thái cân bằng.'}
        </div>
      </div>

      {/* ── Modern Spectrum Gauge Bar ──────────────────────────────── */}
      <div className="bias-gauge-wrapper">
        <div className="bias-gauge-track">
          <div className="bias-gauge-tick tick-0" />
          <div className="bias-gauge-tick tick-25" />
          <div className="bias-gauge-tick tick-50" />
          <div className="bias-gauge-tick tick-75" />
          <div className="bias-gauge-tick tick-100" />

          <div
            className="bias-gauge-pointer"
            style={{
              left: `calc(${scorePercent}% - 3px)`,
              backgroundColor: bias.color,
              boxShadow: `0 0 10px ${bias.color}, 0 0 2px #fff`,
            }}
          >
            <div className="bias-pointer-head" style={{ borderTopColor: bias.color }} />
          </div>
        </div>

        <div className="bias-scale-labels font-mono">
          <span className="scale-bear text-rose-400">BEARISH (-100)</span>
          <span className="scale-neutral">NEUTRAL (0)</span>
          <span className="scale-bull text-emerald-400">BULLISH (+100)</span>
        </div>
      </div>

      {/* ── Transparency & Weight Disclaimer Note ────────────────────── */}
      <div className="bias-transparency-note font-mono">
        <HelpCircle size={13} className="text-amber-400 note-icon" />
        <span>
          <strong>Lưu ý tính độc lập:</strong> Bias Engine bao gồm <strong>3%</strong> tín hiệu xu hướng giá (BTC Daily MA50/200 &amp; Realized Vol); <strong>97%</strong> còn lại được tổng hợp độc lập từ dòng tiền định chế (ETF, COT), on-chain, vĩ mô và vi cấu trúc phái sinh (CVD, Funding, OI). BTC Price tại đây đóng vai trò <em>đối chứng khách quan</em>, không phải bằng chứng mặc định Bias dự báo đúng.
        </span>
      </div>

      {/* ── 4 Pillars Bento Grid (Interactive Filter Buttons) ────────────── */}
      <div className="bias-pillars-grid">
        {pillarsList.map((pillar) => {
          const status = getPillarStatus(pillar.score);
          const fillRatio = Math.min(100, Math.max(0, ((pillar.score + pillar.maxPts) / (pillar.maxPts * 2)) * 100));
          const isSelected = activePillarFilter === pillar.key;

          return (
            <div
              key={pillar.key}
              className={`bias-pillar-card ${isSelected ? 'is-active-pillar' : ''}`}
              onClick={() => handlePillarClick(pillar.key)}
              style={{
                borderColor: isSelected ? status.color : status.border,
                boxShadow: isSelected ? `0 0 14px ${status.color}35` : 'none',
                transform: isSelected ? 'translateY(-2px)' : 'none',
                cursor: 'pointer',
              }}
              title="Click để lọc 10+ tín hiệu định lượng bên dưới"
            >
              <div>
                {/* Header: Code + Name + Score */}
                <div className="pillar-card-header">
                  <div className="pillar-card-title-group">
                    <span className="pillar-code-badge font-mono">{pillar.code}</span>
                    <span className="pillar-title font-mono">{pillar.title}</span>
                  </div>

                  <span className="pillar-score-val font-mono" style={{ color: status.color }}>
                    {formatPillarScore(pillar.score)}
                  </span>
                </div>

                {/* Subtext */}
                <div className="pillar-subtext font-mono">
                  {pillar.subtext}
                </div>
              </div>

              {/* Progress Bar & Status Pill */}
              <div className="pillar-card-footer">
                <div className="pillar-progress-track">
                  <div
                    className="pillar-progress-fill"
                    style={{
                      width: `${fillRatio}%`,
                      backgroundColor: status.color,
                    }}
                  />
                </div>
                <div className="pillar-meta-row font-mono">
                  <span className="pillar-weight">Trọng số: {pillar.weight}</span>
                  <span
                    className="pillar-status-badge"
                    style={{
                      color: status.color,
                      backgroundColor: status.bg,
                      borderColor: status.border,
                    }}
                  >
                    {isSelected ? 'ĐANG LỌC 🎯' : status.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Upcoming Macro Risk Alert Banner ─────────────────────────────── */}
      {bias.upcomingEvents.length > 0 && (
        <div className="bias-macro-alert font-mono">
          <AlertTriangle size={15} className="alert-icon text-amber-400" />
          <div>
            <strong className="alert-label">CẢNH BÁO LỊCH SỰ KIỆN:</strong>{' '}
            <span>
              Sự kiện High Impact <strong>{bias.upcomingEvents[0].title}</strong> diễn ra trong 24h tới. Thận trọng đòn bẩy!
            </span>
          </div>
        </div>
      )}

      {/* ── Real-Time Snapshot History (No Look-Ahead Bias) Drawer ────── */}
      {showSnapshots && (
        <div className="bias-snapshots-drawer font-mono">
          <div className="snapshots-drawer-header">
            <div className="snapshots-title">
              <History size={14} className="text-emerald-400" />
              <span>LỊCH SỬ SNAPSHOT ĐỐI CHIẾU THỰC TẾ (PROVENANCE LOG)</span>
            </div>
            <span className="snapshots-counter-badge">
              Đã ghi nhận: {snapshots.length} điểm
            </span>
          </div>

          <div className="snapshots-disclaimer-sub">
            🛡 <strong>Nguyên tắc bảo toàn dữ liệu:</strong> Chỉ lưu snapshot phát sinh thực tế khi ứng dụng hoạt động; tuyệt đối không tái tạo (backfill) điểm số quá khứ bằng dữ liệu hiện tại nhằm loại bỏ hoàn toàn look-ahead bias.
          </div>

          {snapshots.length < 2 ? (
            <div className="snapshots-warming-card">
              <div className="warming-spinner-dot" />
              <div>
                <strong>Đang tích lũy chuỗi thời gian thực...</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--text-slate-400)' }}>
                  Hệ thống đã lưu {snapshots.length} snapshot. Bảng đối chiếu thời gian thực sẽ hiển thị đầy đủ theo từng mốc phát sinh.
                </p>
              </div>
            </div>
          ) : (
            <div className="snapshots-table-wrap">
              <table className="snapshots-table">
                <thead>
                  <tr>
                    <th>THỜI GIAN</th>
                    <th style={{ textAlign: 'right' }}>BTC PRICE</th>
                    <th style={{ textAlign: 'right' }}>24H CHG</th>
                    <th style={{ textAlign: 'center' }}>BIAS SCORE</th>
                    <th style={{ textAlign: 'center' }}>CONFIDENCE</th>
                    <th style={{ textAlign: 'left' }}>XÁC NHẬN / PHÂN KỲ</th>
                    <th style={{ textAlign: 'right' }}>DATA OLDEST</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snapshots].reverse().map((s) => {
                    const isBull = s.biasScore > 10;
                    const isBear = s.biasScore < -10;
                    const scoreColor = isBull ? '#34d399' : isBear ? '#f87171' : 'var(--text-contrast)';
                    const chgColor = s.btcChange24h >= 0 ? '#34d399' : '#f87171';
                    return (
                      <tr key={s.id || s.timestamp}>
                        <td style={{ color: 'var(--text-slate-400)' }}>
                          {s.timeStr} <span style={{ fontSize: '9px', opacity: 0.7 }}>({s.dateStr})</span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          ${Number(s.btcPrice).toLocaleString('en-US')}
                        </td>
                        <td style={{ textAlign: 'right', color: chgColor }}>
                          {s.btcChange24h >= 0 ? '+' : ''}{Number(s.btcChange24h).toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'center', color: scoreColor, fontWeight: 700 }}>
                          {s.biasScore >= 0 ? `+${s.biasScore}` : s.biasScore}
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-slate-300)' }}>
                          {s.confidence}%
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <span className={`snap-conf-tag tag-${s.confirmationState}`}>
                            {s.confirmationLabel}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-slate-400)' }}>
                          {s.oldestSource}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Expandable Breakdown Drawer ───────────────────────────────── */}
      {expanded && (
        <div className="bias-breakdown-drawer">
          <div className="drawer-header-row font-mono">
            <div className="drawer-title">
              BẢNG CHI TIẾT 10+ TÍN HIỆU ĐỊNH LƯỢNG THÀNH PHẦN
            </div>
            {activePillarObj ? (
              <div className="drawer-filter-status">
                <Filter size={12} className="text-emerald-400" />
                <span>Đang lọc theo trụ cột: <strong>{activePillarObj.code} - {activePillarObj.title}</strong></span>
                <button
                  type="button"
                  className="btn-reset-filter"
                  onClick={() => setActivePillarFilter(null)}
                >
                  (Hiện tất cả)
                </button>
              </div>
            ) : (
              <div className="drawer-filter-hint">
                💡 Click vào 1 trong 4 trụ cột trên để làm nổi bật nhóm tín hiệu tương ứng
              </div>
            )}
          </div>

          <div className="signals-grid">
            {bias.signals.map((sig, idx) => {
              const isPos = sig.score >= 0;
              const scoreColor = isPos ? '#34d399' : '#f87171';
              const isDimmed = activePillarFilter !== null && sig.pillar !== activePillarFilter;
              const isHighlighted = activePillarFilter !== null && sig.pillar === activePillarFilter;
              const pillarMeta = pillarMetaMap[sig.pillar] || { code: '00', label: 'OTHER' };

              return (
                <div
                  key={idx}
                  className={`bias-signal-card font-mono ${isDimmed ? 'is-dimmed' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                >
                  {/* Top Row: Pillar Chip & Weight */}
                  <div className="bias-signal-header">
                    <span className={`bias-pillar-chip pillar-${sig.pillar}`}>
                      {pillarMeta.code} {pillarMeta.label}
                    </span>
                    <span className="bias-weight-badge">
                      Trọng số: {sig.weight}
                    </span>
                  </div>

                  {/* Main Row: Signal Title & Score */}
                  <div className="bias-signal-main">
                    <h4 className="bias-signal-name">{sig.name}</h4>
                    <div className="bias-signal-score" style={{ color: scoreColor, borderColor: scoreColor }}>
                      <span className="score-number">{isPos ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)}</span>
                      <span className="score-unit">pt</span>
                    </div>
                  </div>

                  {/* Footer Row: Status Details */}
                  <div className="bias-signal-footer">
                    <span className="status-dot" style={{ backgroundColor: scoreColor }} />
                    <span className="status-desc" title={sig.status}>{sig.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

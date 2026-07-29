/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Terminal */
import React, { useState } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import ModuleMenu from './ModuleMenu';
import { ChevronDown, ChevronUp, AlertTriangle, Activity, Gauge, Filter, X } from 'lucide-react';

export default function MarketBiasCard({ data, etfHistory, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const [activePillarFilter, setActivePillarFilter] = useState(null); // null | 'microstructure' | 'onChain' | 'institutional' | 'newsRisk'

  const bias = calculateMarketBias(data, etfHistory);

  const formatPillarScore = (val) => `${val >= 0 ? '+' : ''}${val}`;

  const getPillarStatus = (val) => {
    if (val >= 15) return { color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', label: 'MẠNH ▲' };
    if (val > 0) return { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', label: 'TÍCH CỰC' };
    if (val === 0) return { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', label: 'TRUNG LẬP' };
    if (val > -15) return { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', label: 'TIÊU CỰC' };
    return { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', label: 'YẾU ▼' };
  };

  // Convert score (-100 to +100) to percentage (0% to 100%)
  const scorePercent = Math.min(100, Math.max(0, ((bias.score + 100) / 200) * 100));

  const pillarsList = [
    {
      key: 'microstructure',
      code: '01',
      title: 'VI CẤU TRÚC PHÁI SINH',
      weight: '35%',
      subtext: 'CVD 24h, Funding Rate, Open Interest',
      score: bias.pillars.microstructure,
      maxPts: 35,
    },
    {
      key: 'onChain',
      code: '02',
      title: 'DỮ LIỆU ON-CHAIN',
      weight: '25%',
      subtext: 'MVRV Ratio, Active Addrs, Mining Cost',
      score: bias.pillars.onChain,
      maxPts: 25,
    },
    {
      key: 'institutional',
      code: '03',
      title: 'DÒNG TIỀN ĐỊNH CHẾ',
      weight: '20%',
      subtext: 'BTC Spot ETF Net Flow, Stablecoin Supply',
      score: bias.pillars.institutional,
      maxPts: 20,
    },
    {
      key: 'newsRisk',
      code: '04',
      title: 'VĨ MÔ & RỦI RO',
      weight: '20%',
      subtext: 'Macro Calendar, Fear & Greed, L/S Ratio',
      score: bias.pillars.newsRisk,
      maxPts: 20,
    },
  ];

  const handlePillarClick = (pillarKey) => {
    if (activePillarFilter === pillarKey) {
      setActivePillarFilter(null);
    } else {
      setActivePillarFilter(pillarKey);
      setExpanded(true); // Auto expand drawer when selecting a pillar
    }
  };

  const activePillarObj = pillarsList.find(p => p.key === activePillarFilter);

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

      {/* ── Main Score Display & Gauge Meter ───────────────────────────── */}
      <div className="bias-main-meter-box">
        <div className="bias-score-row">
          {/* Left: Overall Status & Score */}
          <div className="bias-score-meta">
            <div className="bias-score-label font-mono">
              CHỈ SỐ XU HƯỚNG TỔNG HỢP (TOTAL BIAS SCORE)
            </div>
            <div className="bias-score-values">
              <span className="bias-status-text font-mono" style={{ color: bias.color }}>
                {bias.label}
              </span>
              <div className="bias-score-num font-mono" style={{ color: bias.color }}>
                {bias.score >= 0 ? `+${bias.score}` : bias.score}
                <span className="bias-score-max font-mono">/ 100</span>
              </div>
            </div>
          </div>

          {/* Right: Technical Summary Description */}
          <div className="bias-description font-mono">
            Định lượng tổng hợp từ 4 trụ cột chính: Vi cấu trúc phái sinh, Dữ liệu On-chain, Dòng tiền định chế ETF &amp; Rủi ro tin tức vĩ mô. Click vào trụ cột để lọc tín hiệu.
          </div>
        </div>

        {/* ── Modern Spectrum Gauge Bar ──────────────────────────────── */}
        <div className="bias-gauge-wrapper">
          {/* Gauge Track */}
          <div className="bias-gauge-track">
            {/* Ticks */}
            <div className="bias-gauge-tick tick-0" />
            <div className="bias-gauge-tick tick-25" />
            <div className="bias-gauge-tick tick-50" />
            <div className="bias-gauge-tick tick-75" />
            <div className="bias-gauge-tick tick-100" />

            {/* Active Pointer Pin */}
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

          {/* Scale Labels */}
          <div className="bias-scale-labels font-mono">
            <span className="scale-bear text-rose-400">BEARISH (-100)</span>
            <span className="scale-neutral">NEUTRAL (0)</span>
            <span className="scale-bull text-emerald-400">BULLISH (+100)</span>
          </div>
        </div>
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
              const color = isPos ? '#34d399' : '#f87171';
              const isDimmed = activePillarFilter !== null && sig.pillar !== activePillarFilter;
              const isHighlighted = activePillarFilter !== null && sig.pillar === activePillarFilter;

              return (
                <div
                  key={idx}
                  className={`signal-card font-mono ${isDimmed ? 'is-dimmed' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                >
                  <div className="signal-card-top">
                    <span className="signal-name">{sig.name}</span>
                    <span className="signal-score-badge" style={{ color }}>
                      {isPos ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)} pt{' '}
                      <small className="signal-weight">({sig.weight})</small>
                    </span>
                  </div>
                  <div className="signal-status-text">
                    {sig.status}
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

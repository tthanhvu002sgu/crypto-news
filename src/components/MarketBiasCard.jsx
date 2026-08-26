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

      {/* ── 3-Layer Bias Regime Chips ─────────────────────────────────── */}
      <div className="bias-regime-bar font-mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 16px 0 16px', fontSize: '11px' }}>
        <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ color: 'var(--text-muted)' }}>TREND: </span>
          <strong style={{ color: regime.trend?.includes('UPTREND') ? '#34d399' : regime.trend?.includes('DOWNTREND') ? '#f87171' : 'var(--text-contrast)' }}>{regime.trend || 'UNKNOWN'}</strong>
        </div>
        <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ color: 'var(--text-muted)' }}>VALUATION: </span>
          <strong style={{ color: regime.valuation === 'DEEP_VALUE' || regime.valuation === 'UNDERVALUED' ? '#34d399' : regime.valuation === 'OVERHEATED' ? '#f87171' : 'var(--text-contrast)' }}>{regime.valuation || 'FAIR_VALUE'}</strong>
        </div>
        <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ color: 'var(--text-muted)' }}>LIQUIDITY: </span>
          <strong style={{ color: regime.liquidity === 'EXPANDING' ? '#34d399' : regime.liquidity === 'CONTRACTING' ? '#f87171' : 'var(--text-contrast)' }}>{regime.liquidity || 'NEUTRAL'}</strong>
        </div>
        <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ color: 'var(--text-muted)' }}>TACTICAL: </span>
          <strong style={{ color: regime.tactical?.includes('SHORT_SQUEEZE') || regime.tactical?.includes('ACCUMULATION') ? '#34d399' : regime.tactical?.includes('LONG_SQUEEZE') || regime.tactical?.includes('DISTRIBUTION') ? '#f87171' : 'var(--text-contrast)' }}>{regime.tactical || 'BALANCED'}</strong>
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
            Định lượng đa tầng từ 4 trụ cột: Định chế (40%), On-chain &amp; Mạng (25%), Vĩ mô &amp; Thanh khoản (20%), Vi cấu trúc &amp; Trend MA (15%). Click vào trụ cột để lọc tín hiệu.
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

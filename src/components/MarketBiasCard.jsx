import React, { useState } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import ModuleMenu from './ModuleMenu';

export default function MarketBiasCard({ data, etfHistory, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const bias = calculateMarketBias(data, etfHistory);

  const formatPillarScore = (val) => `${val >= 0 ? '+' : ''}${val}`;

  const getPillarStatus = (val) => {
    if (val >= 15) return { color: 'var(--color-emerald-400)', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', label: 'MẠNH' };
    if (val > 0) return { color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', label: 'TÍCH CỰC' };
    if (val === 0) return { color: 'var(--text-slate-400)', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', label: 'TRUNG LẬP' };
    if (val > -15) return { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', label: 'TIÊU CỰC' };
    return { color: 'var(--color-rose-400)', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', label: 'YẾU' };
  };

  // Convert score (-100 to +100) to percentage (0% to 100%)
  const scorePercent = Math.min(100, Math.max(0, ((bias.score + 100) / 200) * 100));

  const pillarsList = [
    {
      key: 'microstructure',
      code: '01',
      title: 'MICROSTRUCTURE',
      weight: '35%',
      subtext: 'CVD 24h, Funding Rate, Open Interest',
      score: bias.pillars.microstructure,
      maxPts: 35,
    },
    {
      key: 'onChain',
      code: '02',
      title: 'ON-CHAIN DATA',
      weight: '25%',
      subtext: 'MVRV Ratio, Active Addrs, Mining Cost',
      score: bias.pillars.onChain,
      maxPts: 25,
    },
    {
      key: 'institutional',
      code: '03',
      title: 'INSTITUTIONAL FLOW',
      weight: '20%',
      subtext: 'BTC Spot ETF Net Flow, Stablecoin Supply',
      score: bias.pillars.institutional,
      maxPts: 20,
    },
    {
      key: 'newsRisk',
      code: '04',
      title: 'MACRO & RISK',
      weight: '20%',
      subtext: 'Macro Calendar, Fear & Greed, L/S Ratio',
      score: bias.pillars.newsRisk,
      maxPts: 20,
    },
  ];

  return (
    <div
      className="glass-panel bias-card-container"
      style={{
        padding: '18px 20px',
        marginBottom: '20px',
        border: '1px solid var(--border-panel)',
        borderRadius: '12px',
        background: 'var(--bg-panel)',
      }}
    >
      {/* ── Top Header Toolbar ────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          borderBottom: '1px solid var(--border-panel)',
          paddingBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="dot dot-emerald" />
          <h3
            className="font-mono text-emerald"
            style={{
              margin: 0,
              fontSize: '0.95rem',
              letterSpacing: '0.04em',
              fontWeight: 800,
              textTransform: 'uppercase',
            }}
          >
            MARKET BIAS ENGINE
          </h3>
          <span
            className="font-mono"
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              color: 'var(--color-emerald-400)',
              letterSpacing: '0.04em',
            }}
          >
            CONFIDENCE: {bias.confidence}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="font-mono"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: expanded ? 'var(--color-emerald-500)' : 'var(--bg-slate-950)',
              border: expanded ? '1px solid var(--color-emerald-400)' : '1px solid var(--border-panel)',
              color: expanded ? '#ffffff' : 'var(--text-contrast)',
              borderRadius: '6px',
              padding: '5px 12px',
              fontSize: '0.72rem',
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: '0.04em',
              transition: 'all 0.2s ease',
            }}
          >
            {expanded ? 'THU GỌN' : 'XEM CHI TIẾT TÍN HIỆU'}
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* ── Main Score Display & Gauge Meter ───────────────────────────── */}
      <div
        style={{
          background: 'var(--bg-slate-950)',
          border: '1px solid var(--border-panel)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '16px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justify: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '14px',
          }}
        >
          {/* Left: Overall Status & Score */}
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: '0.68rem',
                color: 'var(--text-slate-400)',
                letterSpacing: '0.05em',
                marginBottom: '4px',
                fontWeight: 600,
              }}
            >
              CHỈ SỐ XU HƯỚNG TỔNG HỢP (TOTAL BIAS SCORE)
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              <span
                className="font-mono"
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 900,
                  color: bias.color,
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                }}
              >
                {bias.label}
              </span>
              <div
                className="font-mono"
                style={{
                  fontSize: '1.7rem',
                  fontWeight: 900,
                  color: bias.color,
                  lineHeight: 1,
                }}
              >
                {bias.score >= 0 ? `+${bias.score}` : bias.score}
                <span
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-slate-400)',
                    fontWeight: 500,
                    marginLeft: '4px',
                  }}
                >
                  / 100
                </span>
              </div>
            </div>
          </div>

          {/* Right: Description */}
          <div
            className="font-mono"
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-slate-400)',
              maxWidth: '380px',
              lineHeight: 1.45,
              textAlign: 'right',
            }}
          >
            Định lượng tổng hợp từ 4 trụ cột chính: Vi cấu trúc phái sinh, Dữ liệu On-chain, Dòng tiền định chế ETF &amp; Rủi ro tin tức vĩ mô.
          </div>
        </div>

        {/* ── Modern Spectrum Gauge Bar ──────────────────────────────── */}
        <div style={{ marginTop: '8px' }}>
          {/* Gauge Track */}
          <div
            style={{
              position: 'relative',
              height: '10px',
              background: 'linear-gradient(90deg, #f43f5e 0%, #f59e0b 50%, #10b981 100%)',
              borderRadius: '5px',
              opacity: 0.9,
            }}
          >
            {/* Center Zero Marker Notch */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '-2px',
                bottom: '-2px',
                width: '2px',
                background: 'var(--text-contrast)',
                opacity: 0.7,
                zIndex: 2,
              }}
            />

            {/* Active Pointer Marker */}
            <div
              style={{
                position: 'absolute',
                top: '-4px',
                left: `calc(${scorePercent}% - 7px)`,
                width: '14px',
                height: '18px',
                background: 'var(--bg-panel)',
                borderRadius: '3px',
                boxShadow: `0 2px 8px ${bias.color}60`,
                border: `2px solid ${bias.color}`,
                transition: 'left 0.4s ease-out',
                zIndex: 3,
              }}
            />
          </div>

          {/* Scale Labels */}
          <div
            className="font-mono"
            style={{
              display: 'flex',
              justify: 'space-between',
              fontSize: '0.62rem',
              color: 'var(--text-slate-400)',
              marginTop: '8px',
              fontWeight: 600,
            }}
          >
            <span style={{ color: 'var(--color-rose-400)' }}>BEARISH (-100)</span>
            <span>NEUTRAL (0)</span>
            <span style={{ color: 'var(--color-emerald-400)' }}>BULLISH (+100)</span>
          </div>
        </div>
      </div>

      {/* ── 4 Pillars Bento Grid ──────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '10px',
          marginBottom: '14px',
        }}
      >
        {pillarsList.map((pillar) => {
          const status = getPillarStatus(pillar.score);
          const fillRatio = Math.min(100, Math.max(0, ((pillar.score + pillar.maxPts) / (pillar.maxPts * 2)) * 100));

          return (
            <div
              key={pillar.key}
              style={{
                background: 'var(--bg-slate-950)',
                border: `1px solid ${status.border}`,
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                gap: '8px',
                transition: 'transform 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = status.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = status.border;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div>
                {/* Header: Code + Name + Score */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.6rem',
                        fontWeight: 800,
                        color: 'var(--text-slate-400)',
                        background: 'var(--border-panel)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                      }}
                    >
                      {pillar.code}
                    </span>
                    <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-contrast)' }}>
                      {pillar.title}
                    </span>
                  </div>

                  <span
                    className="font-mono"
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 800,
                      color: status.color,
                    }}
                  >
                    {formatPillarScore(pillar.score)}
                  </span>
                </div>

                {/* Subtext */}
                <div className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', lineHeight: 1.3 }}>
                  {pillar.subtext}
                </div>
              </div>

              {/* Progress Bar & Status Pill */}
              <div>
                <div style={{ height: '4px', background: 'rgba(128,128,128,0.15)', borderRadius: '2px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${fillRatio}%`,
                      background: status.color,
                      borderRadius: '2px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem' }}>
                  <span className="font-mono" style={{ color: 'var(--text-slate-400)' }}>
                    Trọng số: {pillar.weight}
                  </span>
                  <span
                    className="font-mono"
                    style={{
                      fontWeight: 700,
                      color: status.color,
                      background: status.bg,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      border: `1px solid ${status.border}`,
                    }}
                  >
                    {status.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Upcoming Macro Risk Alert Banner ─────────────────────────────── */}
      {bias.upcomingEvents.length > 0 && (
        <div
          className="font-mono"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderLeft: '4px solid var(--color-amber-400)',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: 'var(--color-amber-400)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <span style={{ fontWeight: 800 }}>CẢNH BÁO LỊCH SỰ KIỆN:</span>
          <span>
            Sự kiện High Impact <strong>{bias.upcomingEvents[0].title}</strong> diễn ra trong 24h tới. Thận trọng đòn bẩy!
          </span>
        </div>
      )}

      {/* ── Expandable Breakdown Drawer ───────────────────────────────── */}
      {expanded && (
        <div
          style={{
            marginTop: '14px',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-panel)',
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-emerald-400)',
              marginBottom: '10px',
              fontWeight: 800,
              letterSpacing: '0.04em',
            }}
          >
            BẢNG CHI TIẾT 10+ TÍN HIỆU ĐỊNH LƯỢNG THÀNH PHẦN
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '8px',
            }}
          >
            {bias.signals.map((sig, idx) => {
              const isPos = sig.score >= 0;
              const color = isPos ? 'var(--color-emerald-400)' : 'var(--color-rose-400)';

              return (
                <div
                  key={idx}
                  style={{
                    background: 'var(--bg-slate-950)',
                    border: '1px solid var(--border-panel)',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
                      {sig.name}
                    </span>
                    <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 800, color }}>
                      {isPos ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)} pt{' '}
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', fontWeight: 400 }}>({sig.weight})</span>
                    </span>
                  </div>

                  <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-slate-400)' }}>
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

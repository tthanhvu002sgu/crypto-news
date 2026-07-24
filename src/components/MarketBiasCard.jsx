import React, { useState } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import ModuleMenu from './ModuleMenu';

export default function MarketBiasCard({ data, etfHistory, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const bias = calculateMarketBias(data, etfHistory);

  // Position of gauge needle from 0% (at -100) to 100% (at +100)
  const pointerPct = Math.min(100, Math.max(0, ((bias.score + 100) / 200) * 100));

  const formatPillarScore = (val) => {
    return `${val >= 0 ? '+' : ''}${val}`;
  };

  const getPillarColor = (val) => {
    if (val >= 15) return 'var(--color-emerald-400)';
    if (val > 0) return '#34d399';
    if (val === 0) return 'var(--text-slate-400)';
    if (val > -15) return '#f87171';
    return 'var(--color-rose-400)';
  };

  return (
    <div className="bias-card-container" style={{ '--bias-accent-color': bias.color }}>
      {/* Header Bar */}
      <div className="bias-header">
        <div className="bias-title-group">
          <div className="bias-pulse-dot" />
          <span className="bias-title">MARKET BIAS ENGINE</span>
          <span className="bias-confidence-pill">CONFIDENCE: {bias.confidence}%</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            className="bias-toggle-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲ Thu gọn' : '▼ Chi tiết'}
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* Hero Section: Score Box + Spectrum Gauge */}
      <div className="bias-hero-grid">
        {/* Main Score Badge */}
        <div className="bias-score-box" style={{ borderColor: `${bias.color}40` }}>
          <div className="bias-score-label" style={{ color: bias.color }}>
            <span>{bias.label}</span>
          </div>
          <div className="bias-score-number" style={{ color: bias.color }}>
            {bias.score >= 0 ? `+${bias.score}` : bias.score}
            <span style={{ fontSize: '0.85rem', color: 'var(--text-slate-400)', fontWeight: 500, marginLeft: '4px' }}>/ 100</span>
          </div>
          <div className="bias-score-sub font-mono">
            Trạng thái thị trường BTC tổng hợp 4 trụ cột
          </div>
        </div>

        {/* Visual Spectrum Meter */}
        <div className="bias-spectrum-wrapper">
          <div className="bias-spectrum-bar">
            <div 
              className="bias-spectrum-pin" 
              style={{ left: `${pointerPct}%` }}
              title={`Score: ${bias.score}`}
            />
          </div>
          <div className="bias-spectrum-labels">
            <span style={{ color: 'var(--color-rose-400)' }}>-100 STRONG BEAR</span>
            <span>-50 BEAR</span>
            <span style={{ color: 'var(--text-contrast)' }}>0 NEUTRAL</span>
            <span>+50 BULL</span>
            <span style={{ color: 'var(--color-emerald-400)' }}>+100 STRONG BULL</span>
          </div>
        </div>
      </div>

      {/* 4 Pillars Cards Grid */}
      <div className="bias-pillars-grid">
        <div className="bias-pillar-card">
          <div className="bias-pillar-header">
            <span className="bias-pillar-name">⚡ Microstructure (35%)</span>
            <span className="bias-pillar-score" style={{ color: getPillarColor(bias.pillars.microstructure) }}>
              {formatPillarScore(bias.pillars.microstructure)}
            </span>
          </div>
          <div className="bias-pillar-desc">CVD 24h, Funding, OI</div>
        </div>

        <div className="bias-pillar-card">
          <div className="bias-pillar-header">
            <span className="bias-pillar-name">🔗 On-Chain (25%)</span>
            <span className="bias-pillar-score" style={{ color: getPillarColor(bias.pillars.onChain) }}>
              {formatPillarScore(bias.pillars.onChain)}
            </span>
          </div>
          <div className="bias-pillar-desc">MVRV, Active Addrs, Mining Cost</div>
        </div>

        <div className="bias-pillar-card">
          <div className="bias-pillar-header">
            <span className="bias-pillar-name">🏛️ Institutional (20%)</span>
            <span className="bias-pillar-score" style={{ color: getPillarColor(bias.pillars.institutional) }}>
              {formatPillarScore(bias.pillars.institutional)}
            </span>
          </div>
          <div className="bias-pillar-desc">ETF Net Flow, Stablecoins</div>
        </div>

        <div className="bias-pillar-card">
          <div className="bias-pillar-header">
            <span className="bias-pillar-name">📰 News & Risk (20%)</span>
            <span className="bias-pillar-score" style={{ color: getPillarColor(bias.pillars.newsRisk) }}>
              {formatPillarScore(bias.pillars.newsRisk)}
            </span>
          </div>
          <div className="bias-pillar-desc">Calendar Risk, FnG, L/S Ratio</div>
        </div>
      </div>

      {/* Upcoming Event Alert Banner */}
      {bias.upcomingEvents.length > 0 && (
        <div className="bias-alert-banner">
          <span>⚠️</span>
          <span><b>CẢNH BÁO LỊCH SỰ KIỆN:</b> Có sự kiện vĩ mô High Impact (<b>{bias.upcomingEvents[0].title}</b>) diễn ra trong 24h tới. Nên thận trọng tỷ lệ đòn bẩy!</span>
        </div>
      )}

      {/* Expandable Signal Breakdown Drawer */}
      {expanded && (
        <div className="bias-drawer">
          <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-slate-400)', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Chi tiết 10+ Tín Hiệu Thành Phần
          </div>
          <div className="bias-signals-list">
            {bias.signals.map((sig, idx) => (
              <div key={idx} className="bias-signal-item">
                <div className="bias-signal-top">
                  <span className="bias-signal-title">{sig.name}</span>
                  <span className="bias-signal-pts" style={{ color: sig.score >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)' }}>
                    {sig.score >= 0 ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)} pt <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', fontWeight: 400 }}>({sig.weight})</span>
                  </span>
                </div>
                <div className="bias-signal-status font-mono">
                  {sig.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import ModuleMenu from './ModuleMenu';

export default function MarketBiasCard({ data, etfHistory, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const bias = calculateMarketBias(data, etfHistory);

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

      {/* Main Score Box & Description */}
      <div className="bias-hero-box" style={{ borderColor: `${bias.color}35`, marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: bias.color, letterSpacing: '-0.02em' }}>
              {bias.label}
            </span>
            <div className="bias-score-number" style={{ color: bias.color }}>
              {bias.score >= 0 ? `+${bias.score}` : bias.score}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-slate-400)', fontWeight: 500, marginLeft: '4px' }}>/ 100</span>
            </div>
          </div>
          
          <div className="bias-score-sub font-mono" style={{ margin: 0 }}>
            Chỉ số xu hướng BTC tổng hợp 4 trụ cột (Microstructure, On-Chain, Flow & News)
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

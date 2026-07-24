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

  return (
    <div className="glass-panel bias-card" style={{ marginBottom: '16px', background: bias.bgGradient, border: `1px solid ${bias.color}33` }}>
      {/* Card Header */}
      <div className="bias-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-contrast)' }} className="font-mono">
            📊 MARKET BIAS ENGINE
          </span>
          <span className="font-mono" style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-slate-400)' }}>
            CONFIDENCE: {bias.confidence}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            className="font-mono"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-panel)',
              color: 'var(--text-slate-300)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '0.7rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {expanded ? '▲ Thu gọn' : '▼ Chi tiết'}
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* Main Score Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', margin: '12px 0 8px 0' }}>
        {/* Large Label & Score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ fontSize: '1.4rem', fontWeight: 800, color: bias.color, letterSpacing: '-0.02em' }}>
            {bias.label}
          </span>
          <span className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 700, color: bias.color }}>
            {bias.score >= 0 ? `+${bias.score}` : bias.score} / 100
          </span>
        </div>

        {/* Pillar Mini Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="font-mono" style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)' }}>
            <span style={{ color: 'var(--text-slate-400)' }}>Micro: </span>
            <span style={{ fontWeight: 700, color: bias.pillars.microstructure >= 0 ? '#34d399' : '#f87171' }}>
              {formatPillarScore(bias.pillars.microstructure)}
            </span>
          </div>

          <div className="font-mono" style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)' }}>
            <span style={{ color: 'var(--text-slate-400)' }}>On-Chain: </span>
            <span style={{ fontWeight: 700, color: bias.pillars.onChain >= 0 ? '#34d399' : '#f87171' }}>
              {formatPillarScore(bias.pillars.onChain)}
            </span>
          </div>

          <div className="font-mono" style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)' }}>
            <span style={{ color: 'var(--text-slate-400)' }}>Institutional: </span>
            <span style={{ fontWeight: 700, color: bias.pillars.institutional >= 0 ? '#34d399' : '#f87171' }}>
              {formatPillarScore(bias.pillars.institutional)}
            </span>
          </div>

          <div className="font-mono" style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)' }}>
            <span style={{ color: 'var(--text-slate-400)' }}>News/Risk: </span>
            <span style={{ fontWeight: 700, color: bias.pillars.newsRisk >= 0 ? '#34d399' : '#f87171' }}>
              {formatPillarScore(bias.pillars.newsRisk)}
            </span>
          </div>
        </div>
      </div>

      {/* Visual Gauge Bar */}
      <div style={{ position: 'relative', width: '100%', height: '8px', background: 'var(--bg-slate-950)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-panel)', margin: '8px 0' }}>
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, #f43f5e 0%, #f87171 25%, #94a3b8 50%, #34d399 75%, #10b981 100%)',
          opacity: 0.85
        }} />
        {/* Pointer indicator */}
        <div style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${pointerPct}%`,
          width: '4px',
          background: '#ffffff',
          boxShadow: '0 0 8px rgba(255,255,255,0.9)',
          transform: 'translateX(-50%)',
          borderRadius: '2px'
        }} />
      </div>

      {/* Scale markers */}
      <div className="font-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-slate-400)', marginBottom: expanded ? '12px' : '0' }}>
        <span>-100 STRONG BEAR</span>
        <span>0 NEUTRAL</span>
        <span>+100 STRONG BULL</span>
      </div>

      {/* Upcoming Event Risk Banner */}
      {bias.upcomingEvents.length > 0 && (
        <div style={{ marginTop: '8px', padding: '6px 10px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>⚠️</span>
          <span><b>CẢNH BÁO EVENT RISK:</b> Có sự kiện vĩ mô High Impact ({bias.upcomingEvents[0].title}) trong vòng 24h tới. Nên tiết chế đòn bẩy!</span>
        </div>
      )}

      {/* Detailed Signals Expand Table */}
      {expanded && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-panel)' }}>
          <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', marginBottom: '8px', fontWeight: 600 }}>
            CHI TIẾT 10+ TÍN HIỆU ĐÓNG GÓP BIAS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px' }}>
            {bias.signals.map((sig, idx) => (
              <div key={idx} style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '6px 10px', fontSize: '0.72rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-contrast)' }}>{sig.name}</span>
                  <span className="font-mono" style={{ color: sig.score >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                    {sig.score >= 0 ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)} pt ({sig.weight})
                  </span>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)' }}>
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

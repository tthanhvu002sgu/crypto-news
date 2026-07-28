import React, { useState } from 'react';
import { calculateMarketBias } from '../services/biasEngine';
import ModuleMenu from './ModuleMenu';

export default function MarketBiasCard({ data, etfHistory, moduleId = 'dash_bias' }) {
  const [expanded, setExpanded] = useState(false);
  const bias = calculateMarketBias(data, etfHistory);

  const formatPillarScore = (val) => `${val >= 0 ? '+' : ''}${val}`;

  const getPillarColor = (val) => {
    if (val >= 15) return '#10b981'; // Emerald
    if (val > 0) return '#34d399';
    if (val === 0) return 'var(--text-slate-400)';
    if (val > -15) return '#f87171';
    return '#f43f5e'; // Rose
  };

  const getPillarBg = (val) => {
    if (val > 0) return 'rgba(16,185,129,0.08)';
    if (val < 0) return 'rgba(244,63,94,0.08)';
    return 'rgba(255,255,255,0.03)';
  };

  // Convert score (-100 to +100) to percentage (0% to 100%) for spectrum position
  const scorePercent = Math.min(100, Math.max(0, ((bias.score + 100) / 200) * 100));

  return (
    <div
      className="glass-panel bias-card-container"
      style={{
        padding: '16px',
        marginBottom: '20px',
        border: '1px solid var(--border-panel)',
        borderRadius: '8px',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="dot dot-emerald" />
          <h3 className="font-mono text-emerald" style={{ margin: 0, fontSize: '0.9rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
            MARKET BIAS ENGINE
          </h3>
          <span
            className="font-mono"
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '3px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-slate-300)',
              letterSpacing: '0.03em',
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
              background: expanded ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-slate-300)',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '0.68rem',
              cursor: 'pointer',
              fontWeight: 600,
              letterSpacing: '0.03em',
              transition: 'all 0.15s ease',
            }}
          >
            {expanded ? '[ HIDE SIGNALS ]' : '[ BREAKDOWN ]'}
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* Main Score Hero Box & Spectrum Track */}
      <div
        style={{
          background: 'var(--bg-slate-950)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '6px',
          padding: '14px 16px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: bias.color, letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>
              {bias.label}
            </span>
            <div className="font-mono" style={{ fontSize: '1.4rem', fontWeight: 800, color: bias.color }}>
              {bias.score >= 0 ? `+${bias.score}` : bias.score}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-slate-500)', fontWeight: 500, marginLeft: '4px' }}>/ 100</span>
            </div>
          </div>

          <div className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', maxWidth: '420px', textAlign: 'right' }}>
            Weighted BTC trend index derived from 4 quantitative pillars (Microstructure, On-Chain, Flow &amp; News Risk)
          </div>
        </div>

        {/* Minimalist Spectrum Bar */}
        <div style={{ position: 'relative', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', marginTop: '6px' }}>
          {/* Fill Bar from Center (50%) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              height: '100%',
              left: scorePercent >= 50 ? '50%' : `${scorePercent}%`,
              width: `${Math.abs(scorePercent - 50)}%`,
              background: bias.color,
              borderRadius: '3px',
            }}
          />
          {/* Marker Dot */}
          <div
            style={{
              position: 'absolute',
              top: '-3px',
              left: `calc(${scorePercent}% - 6px)`,
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: bias.color,
              border: '2px solid var(--bg-slate-950)',
              transition: 'left 0.3s ease',
            }}
          />
        </div>

        {/* Spectrum Ticks */}
        <div className="font-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--text-slate-500)', marginTop: '6px' }}>
          <span>BEARISH (-100)</span>
          <span>NEUTRAL (0)</span>
          <span>BULLISH (+100)</span>
        </div>
      </div>

      {/* 4 Pillars Cards Grid (Minimalist Bento Boxes) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '8px',
          marginBottom: '10px',
        }}
      >
        <div
          style={{
            background: getPillarBg(bias.pillars.microstructure),
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
            padding: '8px 10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
              MICROSTRUCTURE (35%)
            </span>
            <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 800, color: getPillarColor(bias.pillars.microstructure) }}>
              {formatPillarScore(bias.pillars.microstructure)}
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
            CVD 24h, Funding Rate, OI
          </div>
        </div>

        <div
          style={{
            background: getPillarBg(bias.pillars.onChain),
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
            padding: '8px 10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
              ON-CHAIN (25%)
            </span>
            <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 800, color: getPillarColor(bias.pillars.onChain) }}>
              {formatPillarScore(bias.pillars.onChain)}
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
            MVRV, Active Addrs, Cost
          </div>
        </div>

        <div
          style={{
            background: getPillarBg(bias.pillars.institutional),
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
            padding: '8px 10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
              INSTITUTIONAL (20%)
            </span>
            <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 800, color: getPillarColor(bias.pillars.institutional) }}>
              {formatPillarScore(bias.pillars.institutional)}
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
            ETF Flow, Stablecoins
          </div>
        </div>

        <div
          style={{
            background: getPillarBg(bias.pillars.newsRisk),
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '6px',
            padding: '8px 10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-contrast)' }}>
              NEWS &amp; RISK (20%)
            </span>
            <span className="font-mono" style={{ fontSize: '0.75rem', fontWeight: 800, color: getPillarColor(bias.pillars.newsRisk) }}>
              {formatPillarScore(bias.pillars.newsRisk)}
            </span>
          </div>
          <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
            Calendar Risk, FnG, L/S Ratio
          </div>
        </div>
      </div>

      {/* Minimalist Event Alert Banner */}
      {bias.upcomingEvents.length > 0 && (
        <div
          className="font-mono"
          style={{
            background: 'rgba(245,158,11,0.08)',
            borderLeft: '3px solid var(--color-amber-400)',
            padding: '6px 10px',
            borderRadius: '0 4px 4px 0',
            fontSize: '0.68rem',
            color: 'var(--color-amber-300)',
            marginTop: '8px',
          }}
        >
          <strong>EVENT RISK ALERT:</strong> High Impact event (<strong>{bias.upcomingEvents[0].title}</strong>) within 24h. Manage leverage risk accordingly.
        </div>
      )}

      {/* Expandable Signal Breakdown Drawer */}
      {expanded && (
        <div
          style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-slate-400)', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.04em' }}>
            10+ CONSTITUENT SIGNALS BREAKDOWN
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '6px',
            }}
          >
            {bias.signals.map((sig, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                    {sig.name}
                  </span>
                  <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: sig.score >= 0 ? '#10b981' : '#f43f5e' }}>
                    {sig.score >= 0 ? `+${sig.score.toFixed(1)}` : sig.score.toFixed(1)} pt <span style={{ fontSize: '0.58rem', color: 'var(--text-slate-500)', fontWeight: 400 }}>({sig.weight})</span>
                  </span>
                </div>
                <div className="font-mono" style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
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

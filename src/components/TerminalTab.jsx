import React from 'react';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';

export default function TerminalTab({
  data,
  btcDisplay,
  wsStatus,
  fundInfo,
  fund,
  fmt,
  fngColor,
  theme,
}) {
  const { isModuleHidden } = useModuleVisibility();
  if (isModuleHidden('tab_terminal')) return null;

  return (
    <div className="glass-panel panel-section">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="panel-title font-mono text-emerald" style={{ margin: 0 }}>
          <span className="dot dot-emerald" /> SOVEREIGN CRAWLER — ACTIVITY LOG
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="panel-badge font-mono">{data.logs?.length || 0} entries</span>
          <ModuleMenu moduleId="tab_terminal" />
        </div>
      </div>
      <div className="terminal-log font-mono">
        {!data.logs || data.logs.length === 0
          ? <div className="text-slate-500">Nhấn SYNC để xem log hoạt động...</div>
          : data.logs.map((l, i) => (
              <div key={i} className={`log-line log-${l.type}`}>
                <span className="log-time">[{l.time}]</span>
                <span className="log-msg">{l.msg}</span>
              </div>
            ))
        }
      </div>
      <div className="terminal-summary font-mono">
        <div className="summary-row">
          <span className="text-slate-400">BTC:</span>
          <span>${btcDisplay ? fmt(btcDisplay.price, 0) : '---'} {wsStatus === 'connected' ? '⚡' : ''}</span>
          <span className="text-slate-400">Funding:</span>
          <span className={fundInfo?.cls || ''}>{fund != null ? `${(fund * 100).toFixed(4)}%` : '---'}</span>
          <span className="text-slate-400">OI:</span>
          <span>{data.openInterest ? `${(data.openInterest/1000).toFixed(1)}K BTC` : '---'}</span>
          <span className="text-slate-400">F&G:</span>
          <span style={{ color: fngColor(data.fngData?.value, theme === 'light') }}>{data.fngData?.value || '---'}</span>
          <span className="text-slate-400">HashRate:</span>
          <span>{data.onChain?.hashRate ? `${data.onChain.hashRate}EH/s` : '---'}</span>
          <span className="text-slate-400">WS:</span>
          <span className={wsStatus === 'connected' ? 'text-emerald' : 'text-rose'}>{wsStatus?.toUpperCase() || 'OFFLINE'}</span>
        </div>
      </div>
    </div>
  );
}

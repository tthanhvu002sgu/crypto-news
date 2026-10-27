import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Activity, Layers, ArrowUpRight, ArrowDownRight, Minus, Info } from 'lucide-react';
import ModuleMenu from './ModuleMenu';
import { getMultiAssetCorrelationHistory } from '../services/api';
import { calculateCorrelationMatrix, ASSET_KEYS } from '../services/correlationEngine';

const ASSET_INFO = {
  BTC: { label: 'Bitcoin', tag: 'CRYPTO', color: '#F7931A' },
  ETH: { label: 'Ethereum', tag: 'CRYPTO', color: '#627EEA' },
  SOL: { label: 'Solana', tag: 'CRYPTO', color: '#14F195' },
  SPX: { label: 'S&P 500', tag: 'EQUITY', color: '#38BDF8' },
  DXY: { label: 'US Dollar', tag: 'CURRENCY', color: '#A78BFA' },
  GOLD: { label: 'Gold Spot', tag: 'COMMODITY', color: '#FBBF24' },
  US10Y: { label: '10Y Yield', tag: 'RATES', color: '#F43F5E' },
};

const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL'];
const MACRO_ASSETS = ['SPX', 'DXY', 'GOLD', 'US10Y'];

function getCorrelationColor(r) {
  if (r == null || !Number.isFinite(r)) return { bg: 'transparent', text: 'var(--text-slate-500)', border: 'transparent' };
  if (r >= 0.7) return { bg: 'rgba(52, 211, 153, 0.25)', text: '#34D399', border: 'rgba(52, 211, 153, 0.4)' };
  if (r >= 0.4) return { bg: 'rgba(52, 211, 153, 0.15)', text: '#6EE7B7', border: 'rgba(52, 211, 153, 0.25)' };
  if (r >= 0.15) return { bg: 'rgba(52, 211, 153, 0.08)', text: '#A7F3D0', border: 'rgba(52, 211, 153, 0.15)' };
  if (r <= -0.7) return { bg: 'rgba(244, 63, 94, 0.25)', text: '#F43F5E', border: 'rgba(244, 63, 94, 0.4)' };
  if (r <= -0.4) return { bg: 'rgba(244, 63, 94, 0.15)', text: '#FB7185', border: 'rgba(244, 63, 94, 0.25)' };
  if (r <= -0.15) return { bg: 'rgba(244, 63, 94, 0.08)', text: '#FDA4AF', border: 'rgba(244, 63, 94, 0.15)' };
  return { bg: 'rgba(148, 163, 184, 0.05)', text: 'var(--text-slate-400)', border: 'rgba(148, 163, 184, 0.1)' };
}

function formatCorrelation(r) {
  if (r == null || !Number.isFinite(r)) return '---';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}`;
}

export default function CorrelationMatrixPanel({ moduleId = 'dash_correlation_matrix' }) {
  const [windowDays, setWindowDays] = useState(30);
  const [viewMode, setViewMode] = useState('focused'); // 'focused' (3x4) or 'full' (7x7)
  const [rawHistory, setRawHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getMultiAssetCorrelationHistory(force);
      const series = res?.seriesMap || res;
      if (series && series.BTC && series.BTC.length > 0) {
        setRawHistory(series);
        setLastUpdated(res?.timestamp || Date.now());
        setError(null);
      } else {
        setError('Không tải được chuỗi dữ liệu giá lịch sử liên tài sản');
      }
    } catch (err) {
      console.error('[CorrelationMatrixPanel] loadData error:', err);
      setError(err?.message || 'Lỗi khi tải ma trận tương quan');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute matrix whenever rawHistory or windowDays changes
  const matrixResult = useMemo(() => {
    if (!rawHistory) return null;
    const series = rawHistory.seriesMap || rawHistory;
    return calculateCorrelationMatrix(series, windowDays);
  }, [rawHistory, windowDays]);

  const btcMatrix = matrixResult?.matrix?.BTC || {};

  return (
    <div
      className="macro-card glass-panel"
      style={{
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
        border: '1px solid var(--border-panel)',
        background: 'var(--bg-card)',
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '14px',
          borderBottom: '1px solid var(--border-panel)',
          paddingBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h3
            className="font-mono"
            style={{
              margin: 0,
              fontSize: '0.85rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--text-contrast)',
            }}
          >
            <Activity size={16} className="text-cyan-400" />
            <span>MACRO CORRELATION MATRIX</span>
          </h3>
          <span
            className="font-mono text-slate-400"
            style={{
              fontSize: '0.62rem',
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--border-panel)',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            ROLLING {windowDays}D · INNER-JOIN SESSIONS
          </span>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Timeframe Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--bg-slate-900)',
              borderRadius: '4px',
              border: '1px solid var(--border-panel)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              className="font-mono"
              onClick={() => setWindowDays(30)}
              style={{
                fontSize: '0.65rem',
                padding: '3px 8px',
                border: 'none',
                cursor: 'pointer',
                background: windowDays === 30 ? 'var(--color-emerald-500, #10B981)' : 'transparent',
                color: windowDays === 30 ? '#FFFFFF' : 'var(--text-slate-400)',
                fontWeight: windowDays === 30 ? 700 : 500,
              }}
            >
              30D
            </button>
            <button
              type="button"
              className="font-mono"
              onClick={() => setWindowDays(90)}
              style={{
                fontSize: '0.65rem',
                padding: '3px 8px',
                border: 'none',
                cursor: 'pointer',
                background: windowDays === 90 ? 'var(--color-emerald-500, #10B981)' : 'transparent',
                color: windowDays === 90 ? '#FFFFFF' : 'var(--text-slate-400)',
                fontWeight: windowDays === 90 ? 700 : 500,
              }}
            >
              90D
            </button>
          </div>

          {/* View Mode Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--bg-slate-900)',
              borderRadius: '4px',
              border: '1px solid var(--border-panel)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              className="font-mono"
              onClick={() => setViewMode('focused')}
              style={{
                fontSize: '0.65rem',
                padding: '3px 8px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'focused' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: viewMode === 'focused' ? '#38BDF8' : 'var(--text-slate-400)',
                fontWeight: viewMode === 'focused' ? 700 : 500,
              }}
            >
              Crypto vs Macro (3×4)
            </button>
            <button
              type="button"
              className="font-mono"
              onClick={() => setViewMode('full')}
              style={{
                fontSize: '0.65rem',
                padding: '3px 8px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'full' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: viewMode === 'full' ? '#38BDF8' : 'var(--text-slate-400)',
                fontWeight: viewMode === 'full' ? 700 : 500,
              }}
            >
              Toàn bộ (7×7)
            </button>
          </div>

          {/* Sync Button */}
          <button
            type="button"
            title="Làm mới chuỗi dữ liệu liên tài sản"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            className="font-mono text-slate-400 hover:text-slate-200"
            style={{
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--border-panel)',
              borderRadius: '4px',
              padding: '4px 8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              fontSize: '0.65rem',
            }}
          >
            <RefreshCw size={12} className={refreshing ? 'spin-animation' : ''} />
            <span>Sync</span>
          </button>

          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* Loading & Error */}
      {loading && !matrixResult && (
        <div className="font-mono text-slate-400" style={{ padding: '24px 0', textAlign: 'center', fontSize: '0.75rem' }}>
          Đang tính ma trận tương quan Pearson liên tài sản (BTC, ETH, SOL vs SPX, DXY, Gold, US10Y)...
        </div>
      )}

      {error && !matrixResult && (
        <div className="font-mono text-rose-400" style={{ padding: '24px 0', textAlign: 'center', fontSize: '0.75rem' }}>
          {error}
        </div>
      )}

      {matrixResult && (
        <>
          {/* BTC Macro Regime Quick Badges */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '8px',
              marginBottom: '14px',
            }}
          >
            {MACRO_ASSETS.map((asset) => {
              const r = btcMatrix[asset];
              const colors = getCorrelationColor(r);
              const info = ASSET_INFO[asset];

              return (
                <div
                  key={asset}
                  style={{
                    background: 'var(--bg-slate-950)',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span className="font-mono text-slate-400" style={{ fontSize: '0.58rem', letterSpacing: '0.04em' }}>
                      BTC / {asset}
                    </span>
                    <span className="font-mono text-slate-500" style={{ fontSize: '0.52rem' }}>
                      {info.tag}
                    </span>
                  </div>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: colors.text,
                    }}
                  >
                    {formatCorrelation(r)}
                  </div>
                  <div className="font-mono text-slate-400" style={{ fontSize: '0.55rem', marginTop: '2px' }}>
                    {r >= 0.5 ? 'Tương quan dương cao' : r <= -0.5 ? 'Nghịch biến mạnh' : Math.abs(r || 0) < 0.2 ? 'Phi tương quan' : 'Tương quan vừa'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Matrix Table */}
          <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
            {viewMode === 'focused' ? (
              // 3x4 Focused Matrix: Crypto (rows) vs Macro (cols)
              <table
                className="font-mono"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.75rem',
                  textAlign: 'center',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-slate-900)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-panel)' }}>
                      Crypto Asset
                    </th>
                    {MACRO_ASSETS.map((macro) => (
                      <th
                        key={macro}
                        style={{
                          padding: '8px 10px',
                          borderBottom: '1px solid var(--border-panel)',
                          color: ASSET_INFO[macro]?.color || 'inherit',
                        }}
                      >
                        {macro}
                        <div style={{ fontSize: '0.55rem', fontWeight: 400, color: 'var(--text-slate-400)' }}>
                          {ASSET_INFO[macro]?.label}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CRYPTO_ASSETS.map((crypto) => (
                    <tr key={crypto} style={{ borderBottom: '1px solid var(--border-panel)' }}>
                      <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: ASSET_INFO[crypto]?.color || '#888',
                            }}
                          />
                          <span style={{ color: 'var(--text-contrast)' }}>{crypto}</span>
                          <span style={{ fontSize: '0.55rem', color: 'var(--text-slate-500)', fontWeight: 400 }}>
                            {ASSET_INFO[crypto]?.label}
                          </span>
                        </div>
                      </td>
                      {MACRO_ASSETS.map((macro) => {
                        const r = matrixResult.matrix[crypto]?.[macro];
                        const colors = getCorrelationColor(r);

                        return (
                          <td
                            key={macro}
                            style={{
                              padding: '8px 10px',
                              background: colors.bg,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                color: colors.text,
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {formatCorrelation(r)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              // 7x7 Full Matrix
              <table
                className="font-mono"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.72rem',
                  textAlign: 'center',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-slate-900)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-panel)' }}>
                      Asset
                    </th>
                    {ASSET_KEYS.map((col) => (
                      <th
                        key={col}
                        style={{
                          padding: '6px 8px',
                          borderBottom: '1px solid var(--border-panel)',
                          color: ASSET_INFO[col]?.color || 'inherit',
                          fontSize: '0.68rem',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ASSET_KEYS.map((row) => (
                    <tr key={row} style={{ borderBottom: '1px solid var(--border-panel)' }}>
                      <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>
                        <span style={{ color: ASSET_INFO[row]?.color || 'inherit' }}>{row}</span>
                      </td>
                      {ASSET_KEYS.map((col) => {
                        const r = matrixResult.matrix[row]?.[col];
                        const isDiagonal = row === col;
                        const colors = isDiagonal && r != null
                          ? { bg: 'rgba(100, 116, 139, 0.1)', text: 'var(--text-slate-400)', border: 'transparent' }
                          : getCorrelationColor(r);

                        return (
                          <td
                            key={col}
                            style={{
                              padding: '6px 8px',
                              background: colors.bg,
                              opacity: isDiagonal && r != null ? 0.6 : 1,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: isDiagonal ? 400 : 700,
                                color: colors.text,
                              }}
                            >
                              {isDiagonal && r != null ? '1.00' : formatCorrelation(r)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Institutional Macro Narrative */}
          {matrixResult.narrative && (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 14px',
                marginBottom: '10px',
              }}
            >
              <div
                className="font-mono text-slate-400"
                style={{
                  fontSize: '0.6rem',
                  letterSpacing: '0.08em',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🌐</span> NHẬN ĐỊNH BỐI CẢNH VĨ MÔ & CRYPTO REGIME
              </div>
              <p
                className="font-mono"
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  lineHeight: 1.5,
                  color: 'var(--text-slate-300)',
                }}
              >
                {matrixResult.narrative}
              </p>
            </div>
          )}

          {/* Alignment and Source Disclaimer */}
          <div
            className="font-mono text-slate-500"
            style={{
              fontSize: '0.58rem',
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
            }}
          >
            <span>
              Lọc theo {matrixResult.alignedDaysCount || windowDays} phiên giao dịch thực tế đồng thời (loại bỏ độ trễ và zero-variance ngày cuối tuần).
            </span>
            <span>
              Nguồn: Binance (BTC/ETH/SOL/PAXG) · Yahoo Finance (SPX, DXY, TNX)
            </span>
          </div>
        </>
      )}
    </div>
  );
}

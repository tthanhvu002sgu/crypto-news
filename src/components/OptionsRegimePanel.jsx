import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ModuleMenu from './ModuleMenu';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import { fetchCached } from '../utils/cache.js';
import { fetchDeribitOptionChain } from '../services/deribitOptionsService.js';
import { analyzeBtcOptions } from '../services/optionsCalculations.js';

const CACHE_KEY = 'deribit_options_btc_v2';
const CACHE_TTL = 15 * 60 * 1000; // 15 phút (WARM tier)

const DTE_OPTIONS = [
  { label: 'ALL', value: null },
  { label: '≤ 7D', value: 7 },
  { label: '≤ 30D', value: 30 },
];

const fmtStrike = (value) => {
  if (value == null || !Number.isFinite(value)) return '---';
  return `$${value.toLocaleString()}`;
};

export default function OptionsRegimePanel({ moduleId = 'dash_options_regime' }) {
  const { isModuleHidden } = useModuleVisibility();
  const [chain, setChain] = useState(null);
  const [dteFilter, setDteFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const hasDataRef = useRef(false);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const result = await fetchCached(
        CACHE_KEY,
        () => fetchDeribitOptionChain('BTC'),
        CACHE_TTL,
        null,
        null,
        force
      );
      if (result && Array.isArray(result.instruments) && result.instruments.length > 0) {
        hasDataRef.current = true;
        setChain(result);
        setLastUpdated(result.timestamp || Date.now());
        setError(null);
      } else if (!hasDataRef.current) {
        setError('Không thể tải dữ liệu Options từ Deribit (API không phản hồi hoặc không có dữ liệu)');
      }
    } catch (e) {
      console.error('[OptionsRegimePanel]', e.message);
      if (!hasDataRef.current) {
        setError(e.message || 'Lỗi kết nối Deribit API');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    loadData(false);
    const interval = setInterval(() => {
      if (!ignore) loadData(false);
    }, CACHE_TTL);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [loadData]);

  // Re-analyze with current DTE filter whenever chain or filter changes
  const filtered = useMemo(() => {
    if (!chain || !chain.instruments) return null;
    return analyzeBtcOptions(chain.instruments, chain.underlyingPrice, dteFilter);
  }, [chain, dteFilter]);

  const strikeDistribution = filtered?.strikeDistribution;

  // Closest strike to spot price (LOGIC-007)
  const closestStrikeToSpot = useMemo(() => {
    if (!strikeDistribution || strikeDistribution.length === 0 || !filtered?.meta?.underlyingPrice) {
      return null;
    }
    const spot = filtered.meta.underlyingPrice;
    let closest = strikeDistribution[0].strike;
    let minDiff = Math.abs(closest - spot);
    for (let i = 1; i < strikeDistribution.length; i++) {
      const diff = Math.abs(strikeDistribution[i].strike - spot);
      if (diff < minDiff) {
        minDiff = diff;
        closest = strikeDistribution[i].strike;
      }
    }
    return closest;
  }, [strikeDistribution, filtered?.meta?.underlyingPrice]);

  // Find max OI for bar scaling
  const maxOI = useMemo(() => {
    if (!strikeDistribution || strikeDistribution.length === 0) return 1;
    let max = 0;
    for (const s of strikeDistribution) {
      max = Math.max(max, s.callOI, s.putOI);
    }
    return max || 1;
  }, [strikeDistribution]);

  if (isModuleHidden(moduleId)) return null;

  const regime = filtered?.gammaRegime;
  const regimeColor = regime?.regime === 'POSITIVE_GAMMA'
    ? 'var(--color-emerald-400)'
    : regime?.regime === 'NEGATIVE_GAMMA'
      ? 'var(--color-rose-400)'
      : 'var(--text-slate-400)';

  const regimeLabelVi = regime?.regime === 'POSITIVE_GAMMA'
    ? 'Sticky / Mean-Reverting'
    : regime?.regime === 'NEGATIVE_GAMMA'
      ? 'Volatile / Momentum'
      : 'Trung tính';

  return (
    <div className="glass-panel" style={{ padding: '16px 20px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 className="chart-title font-mono text-emerald" style={{ margin: 0, fontSize: '0.95rem' }}>
          <span className="dot dot-emerald" /> OPTIONS REGIME — BTC (DERIBIT)
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="etf-chart-toggle font-mono">
            {DTE_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => setDteFilter(opt.value)}
                className={`toggle-btn ${dteFilter === opt.value ? 'active' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* ── Loading / Error States ── */}
      {loading && !chain && (
        <div className="chart-empty font-mono" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-slate-400)', fontSize: '0.7rem' }}>
          Đang tải dữ liệu Options từ Deribit...
        </div>
      )}

      {error && !chain && (
        <div className="chart-empty font-mono" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-rose-400)', fontSize: '0.7rem' }}>
          <div style={{ marginBottom: '8px' }}>
            {error.startsWith('Không') || error.startsWith('Lỗi') ? error : `Lỗi kết nối Deribit: ${error}`}
          </div>
          <button
            type="button"
            onClick={() => loadData(true)}
            style={{
              padding: '4px 12px',
              fontSize: '0.65rem',
              background: 'transparent',
              border: '1px solid var(--border-panel)',
              borderRadius: '4px',
              color: 'var(--text-slate-300)',
              cursor: 'pointer'
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && !chain && (
        <div className="chart-empty font-mono" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-rose-400)', fontSize: '0.7rem' }}>
          <div style={{ marginBottom: '8px' }}>Không có dữ liệu Options từ Deribit</div>
          <button
            type="button"
            onClick={() => loadData(true)}
            style={{
              padding: '4px 12px',
              fontSize: '0.65rem',
              background: 'transparent',
              border: '1px solid var(--border-panel)',
              borderRadius: '4px',
              color: 'var(--text-slate-300)',
              cursor: 'pointer'
            }}
          >
            Thử lại
          </button>
        </div>
      )}

      {filtered && (
        <>
          {/* ── Bento Summary: 4 Key Metrics + Regime Badge ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
            gap: '10px',
            marginBottom: '14px'
          }}>
            {/* Call Wall */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>CALL WALL (Khang cu)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-rose-400)' }}>
                {filtered.callWall?.strike != null ? fmtStrike(filtered.callWall.strike) : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                {filtered.callWall?.oi != null ? `OI: ${filtered.callWall.oi.toLocaleString()} BTC` : 'N/A'}
              </div>
            </div>

            {/* Put Wall */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>PUT WALL (Ho tro)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-emerald-400)' }}>
                {filtered.putWall?.strike != null ? fmtStrike(filtered.putWall.strike) : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                {filtered.putWall?.oi != null ? `OI: ${filtered.putWall.oi.toLocaleString()} BTC` : 'N/A'}
              </div>
            </div>

            {/* Max Pain */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>MAX PAIN (Luc hut dao han)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-amber-400)' }}>
                {filtered.maxPain?.maxPainPrice != null ? fmtStrike(filtered.maxPain.maxPainPrice) : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                {filtered.meta?.underlyingPrice
                  ? `Spot: ${fmtStrike(filtered.meta.underlyingPrice)}`
                  : ''}
              </div>
            </div>

            {/* GEX Flip */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>GEX FLIP (Ranh gioi bien dong)</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-cyan-400)' }}>
                {filtered.gexFlipPrice != null ? fmtStrike(Math.round(filtered.gexFlipPrice)) : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                Zero Gamma Level
              </div>
            </div>

            {/* PCR */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>PUT/CALL RATIO</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: filtered?.pcr?.pcr > 1.0 ? 'var(--color-rose-400)' : filtered?.pcr?.pcr < 0.7 ? 'var(--color-emerald-400)' : 'var(--text-contrast)' }}>
                {filtered?.pcr?.pcr != null ? filtered.pcr.pcr.toFixed(2) : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                {filtered?.pcr?.pcr > 1.2 ? 'Hedging cao' : filtered?.pcr?.pcr < 0.6 ? 'Bullish skew' : 'Can bang'}
              </div>
            </div>

            {/* Gamma Regime Badge */}
            <div style={{
              background: 'var(--bg-slate-950)',
              border: `1px solid ${regimeColor}`,
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>GAMMA REGIME</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: regimeColor, letterSpacing: '0.04em' }}>
                {regime?.regime === 'POSITIVE_GAMMA' ? '+GEX STICKY' : regime?.regime === 'NEGATIVE_GAMMA' ? '-GEX VOLATILE' : 'NEUTRAL'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: regimeColor, opacity: 0.8 }}>
                {regimeLabelVi}
              </div>
            </div>
          </div>

          {/* ── ASP-100 Options Desk Brief ── */}
          {filtered.narrative && (
            <div style={{
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              borderRadius: '6px',
              padding: '12px 14px',
              marginBottom: '14px',
              position: 'relative'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.8rem' }}>🧠</span>
                  <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-amber-400)', letterSpacing: '0.04em' }}>
                    DIỄN GIẢI OPTIONS DESK (ASP-100)
                  </span>
                  <span className="font-mono" style={{
                    fontSize: '0.55rem',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    fontWeight: 600,
                    background: filtered.narrative.badgeType === 'positive'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : filtered.narrative.badgeType === 'negative'
                        ? 'rgba(244, 63, 94, 0.15)'
                        : 'rgba(148, 163, 184, 0.15)',
                    color: filtered.narrative.badgeType === 'positive'
                      ? 'var(--color-emerald-400)'
                      : filtered.narrative.badgeType === 'negative'
                        ? 'var(--color-rose-400)'
                        : 'var(--text-slate-400)',
                    border: `1px solid ${
                      filtered.narrative.badgeType === 'positive'
                        ? 'rgba(16, 185, 129, 0.3)'
                        : filtered.narrative.badgeType === 'negative'
                          ? 'rgba(244, 63, 94, 0.3)'
                          : 'rgba(148, 163, 184, 0.3)'
                    }`
                  }}>
                    {filtered.narrative.badge}
                  </span>
                </div>
                <span className="font-mono text-slate-500" style={{ fontSize: '0.55rem' }}>
                  ~{filtered.narrative.wordCount} từ • Deribit BTC
                </span>
              </div>

              {/* Executive 1-Liner Callout */}
              <div style={{
                background: 'rgba(245, 158, 11, 0.06)',
                borderLeft: '3px solid var(--color-amber-400)',
                padding: '7px 10px',
                borderRadius: '0 4px 4px 0',
                fontSize: '0.7rem',
                lineHeight: 1.5,
                color: 'var(--text-contrast)',
                marginBottom: '10px'
              }}>
                <strong style={{ color: 'var(--color-amber-400)' }}>Tổng quan:</strong> {filtered.narrative.executive}
              </div>

              {/* 3 Trụ Cột ASP Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '8px'
              }}>
                {/* [P] Positioning */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  fontSize: '0.67rem',
                  lineHeight: 1.55
                }}>
                  <div className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-cyan-400)', marginBottom: '3px' }}>
                    📍 [P] POSITIONING (VỊ THẾ MM)
                  </div>
                  <div style={{ color: 'var(--text-slate-300)' }}>
                    {filtered.narrative.positioning}
                  </div>
                </div>

                {/* [S] Sentiment */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  fontSize: '0.67rem',
                  lineHeight: 1.55
                }}>
                  <div className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-amber-400)', marginBottom: '3px' }}>
                    🎯 [S] SENTIMENT (TÂM LÝ & SKEW)
                  </div>
                  <div style={{ color: 'var(--text-slate-300)' }}>
                    {filtered.narrative.sentiment}
                  </div>
                </div>

                {/* [A] Action */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  fontSize: '0.67rem',
                  lineHeight: 1.55
                }}>
                  <div className="font-mono" style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-emerald-400)', marginBottom: '3px' }}>
                    ⚡ [A] ACTION (KỊCH BẢN THỰC CHIẾN)
                  </div>
                  <div style={{ color: 'var(--text-slate-300)' }}>
                    {filtered.narrative.action}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Strike Distribution Bar Chart ── */}
          <div style={{
            background: 'var(--bg-slate-950)',
            border: '1px solid var(--border-panel)',
            borderRadius: '6px',
            padding: '12px 14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-slate-400)', letterSpacing: '0.04em' }} className="font-mono">
                STRIKE DISTRIBUTION — CALL vs PUT OI
              </div>
              <div style={{ fontSize: '0.55rem', color: 'var(--text-slate-500)' }} className="font-mono">
                {filtered.meta?.instrumentCount || 0} instruments
                {lastUpdated && ` | ${new Date(lastUpdated).toLocaleTimeString('vi-VN')}`}
              </div>
            </div>

            <div style={{ maxHeight: '320px', overflowY: 'auto', overflowX: 'hidden' }}>
              {filtered.strikeDistribution && filtered.strikeDistribution.length > 0 ? (
                filtered.strikeDistribution.map((row) => {
                  const callPct = (row.callOI / maxOI) * 100;
                  const putPct = (row.putOI / maxOI) * 100;
                  const isCurrentPrice = row.strike === closestStrikeToSpot;
                  const isCallWall = filtered.callWall?.strike === row.strike;
                  const isPutWall = filtered.putWall?.strike === row.strike;

                  return (
                    <div key={row.strike} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 1fr',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 0',
                      borderBottom: isCurrentPrice ? '1px solid var(--color-amber-400)' : 'none',
                      background: isCurrentPrice ? 'rgba(245, 158, 11, 0.06)' : 'transparent'
                    }}>
                      {/* Call OI bar (right-aligned, grows left) */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                        <span className="font-mono" style={{
                          fontSize: '0.5rem',
                          color: isCallWall ? 'var(--color-rose-400)' : 'var(--text-slate-500)',
                          fontWeight: isCallWall ? 700 : 400,
                          minWidth: '35px',
                          textAlign: 'right'
                        }}>
                          {row.callOI > 0 ? row.callOI.toLocaleString() : ''}
                        </span>
                        <div style={{
                          height: '10px',
                          width: `${callPct}%`,
                          minWidth: row.callOI > 0 ? '2px' : '0',
                          background: isCallWall
                            ? 'var(--color-rose-400)'
                            : 'rgba(244, 63, 94, 0.35)',
                          borderRadius: '2px 0 0 2px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>

                      {/* Strike Price Label */}
                      <div className="font-mono" style={{
                        fontSize: '0.55rem',
                        fontWeight: isCurrentPrice ? 800 : isCallWall || isPutWall ? 700 : 400,
                        color: isCurrentPrice
                          ? 'var(--color-amber-400)'
                          : isCallWall ? 'var(--color-rose-400)'
                            : isPutWall ? 'var(--color-emerald-400)'
                              : 'var(--text-slate-400)',
                        textAlign: 'center',
                        whiteSpace: 'nowrap'
                      }}>
                        {row.strike % 1000 === 0 ? `${row.strike / 1000}K` : `${(row.strike / 1000).toFixed(1)}K`}
                        {isCurrentPrice && ' <'}
                      </div>

                      {/* Put OI bar (left-aligned, grows right) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{
                          height: '10px',
                          width: `${putPct}%`,
                          minWidth: row.putOI > 0 ? '2px' : '0',
                          background: isPutWall
                            ? 'var(--color-emerald-400)'
                            : 'rgba(16, 185, 129, 0.35)',
                          borderRadius: '0 2px 2px 0',
                          transition: 'width 0.3s ease'
                        }} />
                        <span className="font-mono" style={{
                          fontSize: '0.5rem',
                          color: isPutWall ? 'var(--color-emerald-400)' : 'var(--text-slate-500)',
                          fontWeight: isPutWall ? 700 : 400,
                          minWidth: '35px'
                        }}>
                          {row.putOI > 0 ? row.putOI.toLocaleString() : ''}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="chart-empty font-mono" style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-slate-400)', fontSize: '0.65rem' }}>
                  Khong co du lieu phan bo Strike
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="font-mono" style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '8px', fontSize: '0.55rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'rgba(244, 63, 94, 0.5)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-slate-400)' }}>CALL OI (Khang cu)</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'rgba(16, 185, 129, 0.5)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-slate-400)' }}>PUT OI (Ho tro)</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--color-amber-400)', display: 'inline-block' }} />
                <span style={{ color: 'var(--text-slate-400)' }}>Gia hien tai</span>
              </span>
            </div>
          </div>

          {/* ── Disclaimer ── */}
          <div className="font-mono" style={{
            fontSize: '0.5rem',
            color: 'var(--text-slate-500)',
            marginTop: '8px',
            lineHeight: 1.5,
            padding: '0 2px'
          }}>
            Gia dinh: MM Net Long Calls / Net Short Puts (Standard Dealer Positioning).
            Max Pain chi la luc hut thu cap gan dao han, khong phai target gia tuyet doi.
            Nguon: Deribit Public API — Cap nhat moi 15 phut.
          </div>
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, Scale, ExternalLink } from 'lucide-react';
import ModuleMenu from './ModuleMenu';
import { getMultiExchangeFunding } from '../services/api';

const VENUE_META = {
  BINANCE: { name: 'Binance', tag: 'BIN', color: '#F3BA2F' },
  BYBIT: { name: 'Bybit', tag: 'BYB', color: '#F7A600' },
  OKX: { name: 'OKX', tag: 'OKX', color: '#FFFFFF' },
  BITGET: { name: 'Bitget', tag: 'BGT', color: '#00F0FF' },
};

function formatRatePct(rate) {
  if (rate == null || !Number.isFinite(rate)) return '---';
  const pct = rate * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(4)}%`;
}

function formatApr(apr) {
  if (apr == null || !Number.isFinite(apr)) return '---';
  const sign = apr > 0 ? '+' : '';
  return `${sign}${apr.toFixed(2)}%`;
}

function formatPrice(val) {
  if (val == null || !Number.isFinite(val)) return '---';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function formatCountdown(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return '---';
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return '00:00:00';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function MultiExchangeFundingPanel({ moduleId = 'hft_multi_funding', symbol = 'BTCUSDT' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Update countdown clock every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadFunding = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getMultiExchangeFunding(symbol, force);
      if (res && res.venues && res.venues.length > 0) {
        setData(res);
        setLastUpdated(res.timestamp || Date.now());
        setError(null);
      } else {
        setError('Không nhận được dữ liệu funding từ các sàn');
      }
    } catch (err) {
      console.error('[MultiExchangeFundingPanel] fetch error:', err);
      setError(err?.message || 'Lỗi kết nối khi tải funding');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [symbol]);

  // Initial fetch and auto-refresh every 60 seconds
  useEffect(() => {
    loadFunding();
    const interval = setInterval(() => loadFunding(true), 60000);
    return () => clearInterval(interval);
  }, [loadFunding]);

  const analysis = data?.analysis || data;
  const venues = data?.venues || [];

  const badgeToneStyle = useMemo(() => {
    const tone = analysis?.crowdingTone;
    if (tone === 'danger' || tone === 'bear') {
      return {
        bg: 'rgba(251, 113, 133, 0.12)',
        text: 'var(--color-rose-400)',
        border: '1px solid rgba(251, 113, 133, 0.35)',
      };
    }
    if (tone === 'bull') {
      return {
        bg: 'rgba(52, 211, 153, 0.12)',
        text: 'var(--color-emerald-400)',
        border: '1px solid rgba(52, 211, 153, 0.35)',
      };
    }
    if (tone === 'warning') {
      return {
        bg: 'rgba(253, 224, 71, 0.12)',
        text: '#FDE047',
        border: '1px solid rgba(253, 224, 71, 0.35)',
      };
    }
    return {
      bg: 'rgba(100, 116, 139, 0.15)',
      text: 'var(--text-slate-300)',
      border: '1px solid rgba(100, 116, 139, 0.3)',
    };
  }, [analysis?.crowdingTone]);

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      {/* Panel Header */}
      <div className="hft-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h3 className="hft-panel-title font-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span className="hft-icon">🌐</span> MULTI-EXCHANGE FUNDING & BASIS
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
            {symbol} · 4 VENUES
          </span>
          {analysis?.crowdingLabel && (
            <span
              className="font-mono"
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '4px',
                letterSpacing: '0.04em',
                background: badgeToneStyle.bg,
                color: badgeToneStyle.text,
                border: badgeToneStyle.border,
              }}
            >
              {analysis.crowdingLabel}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {lastUpdated && (
            <span className="font-mono text-slate-500" style={{ fontSize: '0.6rem' }}>
              {new Date(lastUpdated).toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            type="button"
            title="Làm mới dữ liệu funding liên sàn"
            onClick={() => loadFunding(true)}
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

      {/* Loading & Error States */}
      {loading && !data && (
        <div className="hft-empty font-mono" style={{ padding: '24px 0' }}>
          Đang quét Funding & Basis từ Binance, Bybit, OKX, Bitget...
        </div>
      )}

      {error && !data && (
        <div className="hft-empty font-mono" style={{ color: 'var(--color-rose-400)', padding: '24px 0' }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* 4 Summary Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '10px',
              marginBottom: '12px',
            }}
          >
            {/* Card 1: Average Funding */}
            <div
              style={{
                background: 'var(--bg-slate-950)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <div className="font-mono text-slate-500" style={{ fontSize: '0.58rem', letterSpacing: '0.06em', marginBottom: '4px' }}>
                AVG FUNDING (8H / APR)
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: (analysis?.avgFundingRate || 0) > 0.0003
                    ? 'var(--color-rose-400)'
                    : (analysis?.avgFundingRate || 0) < -0.0001
                    ? 'var(--color-emerald-400)'
                    : 'var(--text-slate-200)',
                }}
              >
                {formatRatePct(analysis?.avgFundingRate)}
              </div>
              <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '2px' }}>
                APR: {formatApr(analysis?.avgAnnualizedPct ?? analysis?.avgFundingApr)}
              </div>
            </div>

            {/* Card 2: Funding Spread */}
            <div
              style={{
                background: 'var(--bg-slate-950)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <div className="font-mono text-slate-500" style={{ fontSize: '0.58rem', letterSpacing: '0.06em', marginBottom: '4px' }}>
                CROSS-VENUE SPREAD
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: (analysis?.fundingSpreadPct || 0) > 0.015 ? '#FDE047' : 'var(--text-slate-200)',
                }}
              >
                {analysis?.fundingSpreadPct != null
                  ? `${analysis.fundingSpreadPct.toFixed(4)}%`
                  : analysis?.fundingSpread != null
                  ? `${(analysis.fundingSpread * 100).toFixed(4)}%`
                  : '---'}
              </div>
              <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '2px' }}>
                {analysis?.fundingSpreadPct != null
                  ? `${(analysis.fundingSpreadPct * 100).toFixed(1)} bps chênh lệch`
                  : analysis?.fundingSpread != null
                  ? `${(analysis.fundingSpread * 10000).toFixed(1)} bps chênh lệch`
                  : '---'}
              </div>
            </div>

            {/* Card 3: Average Basis (Annualized) */}
            <div
              style={{
                background: 'var(--bg-slate-950)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <div className="font-mono text-slate-500" style={{ fontSize: '0.58rem', letterSpacing: '0.06em', marginBottom: '4px' }}>
                AVG BASIS (ANNUALIZED)
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: (analysis?.avgBasisPct || 0) > 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)',
                }}
              >
                {analysis?.avgBasisPct != null ? `${analysis.avgBasisPct > 0 ? '+' : ''}${analysis.avgBasisPct.toFixed(2)}%` : '---'}
              </div>
              <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '2px' }}>
                Mark vs Spot Index Premium
              </div>
            </div>

            {/* Card 4: Squeeze Risk */}
            <div
              style={{
                background: 'var(--bg-slate-950)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 12px',
              }}
            >
              <div className="font-mono text-slate-500" style={{ fontSize: '0.58rem', letterSpacing: '0.06em', marginBottom: '4px' }}>
                SQUEEZE DYNAMICS
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: badgeToneStyle.text,
                  lineHeight: 1.3,
                }}
              >
                {analysis?.crowdingLabel || analysis?.squeezeLabel || 'CÂN BẰNG'}
              </div>
              <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '4px' }}>
                {venues.filter(v => v.fundingRate != null).length}/{venues.length} sàn hoạt động
              </div>
            </div>
          </div>

          {/* Venues Table */}
          <div className="whale-table-wrap" style={{ overflowX: 'auto', marginBottom: '12px' }}>
            <table className="liq-table font-mono" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
              <thead style={{ background: 'var(--bg-slate-900)' }}>
                <tr>
                  <th style={{ padding: '8px 10px' }}>Sàn</th>
                  <th style={{ padding: '8px 10px' }}>Funding Rate (8h)</th>
                  <th style={{ padding: '8px 10px' }}>APR (%)</th>
                  <th style={{ padding: '8px 10px' }}>Mark Price</th>
                  <th style={{ padding: '8px 10px' }}>Index Price</th>
                  <th style={{ padding: '8px 10px' }}>Basis % (Ann.)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Đếm ngược</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((v, i) => {
                  const venueCode = v.code || v.venue || v.exchange;
                  const meta = VENUE_META[venueCode] || { name: v.exchange || venueCode, tag: (venueCode || '').slice(0, 3), color: '#94A3B8' };
                  const minRate = analysis?.lowestVenue?.fundingRate ?? analysis?.minFundingRate;
                  const maxRate = analysis?.highestVenue?.fundingRate ?? analysis?.maxFundingRate;
                  const validCount = analysis?.validCount ?? analysis?.validVenuesCount ?? 0;
                  const isMin = v.fundingRate === minRate && validCount > 1;
                  const isMax = v.fundingRate === maxRate && validCount > 1;
                  const spread = analysis?.fundingSpreadPct != null ? analysis.fundingSpreadPct / 100 : (analysis?.fundingSpread || 0);

                  return (
                    <tr
                      key={venueCode || i}
                      style={{
                        borderBottom: '1px solid var(--border-panel)',
                        background: isMax && spread > 0.00015
                          ? 'rgba(251, 113, 133, 0.04)'
                          : isMin && spread > 0.00015
                          ? 'rgba(52, 211, 153, 0.04)'
                          : 'transparent',
                      }}
                    >
                      {/* Venue Column */}
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: meta.color,
                            }}
                          />
                          <span style={{ fontWeight: 600, color: 'var(--text-contrast)' }}>{meta.name}</span>
                          <span
                            style={{
                              fontSize: '0.52rem',
                              padding: '1px 3px',
                              borderRadius: '2px',
                              background: 'var(--bg-slate-900)',
                              border: '1px solid var(--border-panel)',
                              color: 'var(--text-slate-400)',
                            }}
                          >
                            {v.symbol || symbol}
                          </span>
                        </div>
                      </td>

                      {/* Funding Rate 8h */}
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: (v.fundingRate || 0) > 0 ? 'var(--color-rose-400)' : (v.fundingRate || 0) < 0 ? 'var(--color-emerald-400)' : 'var(--text-slate-300)',
                          }}
                        >
                          {formatRatePct(v.fundingRate)}
                        </span>
                        {isMax && (
                          <span className="font-mono text-rose" style={{ fontSize: '0.52rem', marginLeft: '4px', opacity: 0.85 }}>
                            [MAX]
                          </span>
                        )}
                        {isMin && (
                          <span className="font-mono text-emerald" style={{ fontSize: '0.52rem', marginLeft: '4px', opacity: 0.85 }}>
                            [MIN]
                          </span>
                        )}
                      </td>

                      {/* Funding APR */}
                      <td style={{ padding: '8px 10px', color: 'var(--text-slate-300)' }}>
                        {formatApr(v.annualizedPct ?? v.fundingApr)}
                      </td>

                      {/* Mark Price */}
                      <td style={{ padding: '8px 10px', color: 'var(--text-slate-300)' }}>
                        {formatPrice(v.markPrice)}
                      </td>

                      {/* Index Price */}
                      <td style={{ padding: '8px 10px', color: 'var(--text-slate-400)' }}>
                        {formatPrice(v.indexPrice)}
                      </td>

                      {/* Basis % */}
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            color: (v.basisPct || 0) > 0 ? 'var(--color-emerald-400)' : (v.basisPct || 0) < 0 ? 'var(--color-rose-400)' : 'var(--text-slate-400)',
                          }}
                        >
                          {v.basisPct != null ? `${v.basisPct > 0 ? '+' : ''}${v.basisPct.toFixed(2)}%` : '---'}
                        </span>
                      </td>

                      {/* Countdown */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-slate-400)' }}>
                        {v.nextFundingTime ? formatCountdown(v.nextFundingTime) : '---'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Narrative Callout */}
          {analysis?.narrative && (
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid var(--border-panel)',
                borderRadius: '6px',
                padding: '10px 14px',
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
                <span>💡</span> BỐI CẢNH CROWDING & ARBITRAGE LIÊN SÀN
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
                {analysis.narrative}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

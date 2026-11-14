import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import ModuleMenu from './ModuleMenu';
import Tooltip, { METRIC_METADATA } from './Tooltip';
import { getCoinbasePremium, getMultiExchangeTakerFlow } from '../services/api';
import {
  createMultiExchangeSessionStore,
  mergeTradesIntoSessionStore,
  buildMultiExchangeCvdComparison,
} from '../services/spotFlowEngine';

const VENUE_LABELS = {
  BINANCE: { name: 'Binance', tag: 'BIN', color: '#F3BA2F' },
  BYBIT: { name: 'Bybit', tag: 'BYB', color: '#F7A600' },
  OKX: { name: 'OKX', tag: 'OKX', color: '#E2E8F0' },
  COINBASE: { name: 'Coinbase', tag: 'COIN', color: '#0052FF' },
};

const TONE_COLORS = {
  bullish: {
    bg: 'rgba(16, 185, 129, 0.14)',
    text: 'var(--color-emerald-400)',
    border: '1px solid rgba(16, 185, 129, 0.35)',
  },
  bearish: {
    bg: 'rgba(244, 63, 94, 0.14)',
    text: 'var(--color-rose-400)',
    border: '1px solid rgba(244, 63, 94, 0.35)',
  },
  constructive: {
    bg: 'rgba(56, 189, 248, 0.14)',
    text: '#38bdf8',
    border: '1px solid rgba(56, 189, 248, 0.35)',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.14)',
    text: 'var(--color-amber-400)',
    border: '1px solid rgba(245, 158, 11, 0.35)',
  },
  neutral: {
    bg: 'rgba(148, 163, 184, 0.12)',
    text: 'var(--text-slate-300)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
  },
};

function fmtSignedUsd(val, digits = 0) {
  if (val == null || !Number.isFinite(val)) return '---';
  const sign = val > 0 ? '+' : val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(digits)}`;
}

function fmtSignedPct(val, digits = 3) {
  if (val == null || !Number.isFinite(val)) return '---';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(digits)}%`;
}

function fmtPrice(val) {
  if (val == null || !Number.isFinite(val)) return '---';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

function renderVenueCell(stat, emptyText = 'N/A') {
  if (!stat || stat.status !== 'OK') {
    return <span className="text-slate-500">{emptyText}</span>;
  }
  const cls = stat.netDeltaUsd > 0 ? 'text-emerald' : stat.netDeltaUsd < 0 ? 'text-rose' : 'text-slate-300';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
      <span className={cls} style={{ fontWeight: 700 }}>{fmtSignedUsd(stat.netDeltaUsd)}</span>
      <span className="text-slate-400" style={{ fontSize: '0.52rem' }}>
        {fmtSignedPct(stat.deltaRatioPct, 1)} · {fmtDuration(stat.spanSec)}
      </span>
    </div>
  );
}

function compareRowFlow(spot, futures, code) {
  if (code === 'COINBASE') {
    if (!spot || spot.status !== 'OK') return { text: 'Đang chờ USD Spot', cls: 'text-slate-500' };
    if ((spot.deltaRatioPct ?? 0) > 2) return { text: 'Spot USD mua ròng', cls: 'text-emerald' };
    if ((spot.deltaRatioPct ?? 0) < -2) return { text: 'Spot USD bán ròng', cls: 'text-rose' };
    return { text: 'Spot USD cân bằng', cls: 'text-slate-400' };
  }
  if (!spot || spot.status !== 'OK' || !futures || futures.status !== 'OK') {
    return { text: 'Thiếu 1 vế đối chiếu', cls: 'text-slate-500' };
  }
  const s = spot.deltaRatioPct ?? 0;
  const f = futures.deltaRatioPct ?? 0;
  if (s > 2 && f > 2) return { text: 'Đồng thuận mua', cls: 'text-emerald' };
  if (s < -2 && f < -2) return { text: 'Đồng thuận bán', cls: 'text-rose' };
  if (s > 2 && f < -2) return { text: 'Spot hấp thụ Fut', cls: 'text-sky-400' };
  if (s < -2 && f > 2) return { text: 'Fut kéo / Spot xả', cls: 'text-amber' };
  return { text: 'Cân bằng', cls: 'text-slate-400' };
}

export default function SpotPressurePanel({ moduleId = 'hft_spot_pressure', symbol = 'BTCUSDT' }) {
  const [premium, setPremium] = useState(null);
  const [snapshotCmp, setSnapshotCmp] = useState(null);
  const [sessionCmp, setSessionCmp] = useState(null);
  const [flowMode, setFlowMode] = useState(() => localStorage.getItem('hft_multi_cvd_mode') || 'session');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sessionStartedAt, setSessionStartedAt] = useState(() => Date.now());

  const sessionStoreRef = useRef(createMultiExchangeSessionStore());
  const requestGenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('hft_multi_cvd_mode', flowMode);
    } catch {
      // Ignore storage quota / private-mode errors so UI state still works
    }
  }, [flowMode]);

  const fetchAndApply = useCallback(async (force = false) => {
    const gen = ++requestGenRef.current;
    const targetStore = sessionStoreRef.current;
    try {
      const [premRes, flowRes] = await Promise.allSettled([
        getCoinbasePremium(symbol, force),
        getMultiExchangeTakerFlow(symbol),
      ]);

      if (!mountedRef.current || gen !== requestGenRef.current) return;

      if (premRes.status === 'fulfilled' && premRes.value) {
        setPremium(premRes.value);
      }

      if (flowRes.status === 'fulfilled' && flowRes.value) {
        const flow = flowRes.value;
        setSnapshotCmp(flow.snapshotComparison);

        if (targetStore === sessionStoreRef.current) {
          const spotVenues = {};
          for (const [venue, trades] of Object.entries(flow.spotTradesByVenue || {})) {
            spotVenues[venue] = mergeTradesIntoSessionStore(targetStore, `spot:${venue}`, trades);
          }
          const futuresVenues = {};
          for (const [venue, trades] of Object.entries(flow.futuresTradesByVenue || {})) {
            futuresVenues[venue] = mergeTradesIntoSessionStore(targetStore, `futures:${venue}`, trades);
          }
          setSessionCmp(buildMultiExchangeCvdComparison({ spotVenues, futuresVenues }));
        }
      }
      setLastUpdated(Date.now());
    } catch (e) {
      console.error('[SpotPressurePanel] fetch error:', e);
    } finally {
      if (mountedRef.current && gen === requestGenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [symbol]);

  const handleManualSync = useCallback(() => {
    setRefreshing(true);
    fetchAndApply(true);
  }, [fetchAndApply]);

  const handleResetSession = () => {
    requestGenRef.current += 1;
    sessionStoreRef.current = createMultiExchangeSessionStore();
    setSessionStartedAt(Date.now());
    setSessionCmp(null);
    setRefreshing(true);
    fetchAndApply(true);
  };

  useEffect(() => {
    requestGenRef.current += 1;
    sessionStoreRef.current = createMultiExchangeSessionStore();
    let cancelled = false;
    const initTimer = setTimeout(() => {
      if (!cancelled) {
        setSessionCmp(null);
        setSessionStartedAt(Date.now());
        fetchAndApply(false);
      }
    }, 0);
    const interval = setInterval(() => fetchAndApply(true), 15000);
    return () => {
      cancelled = true;
      requestGenRef.current += 1;
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [fetchAndApply]);

  const activeComparison = flowMode === 'session' ? (sessionCmp || snapshotCmp) : snapshotCmp;
  const premTone = TONE_COLORS[premium?.tone || 'neutral'] || TONE_COLORS.neutral;
  const flowTone = TONE_COLORS[activeComparison?.alignment?.tone || 'neutral'] || TONE_COLORS.neutral;

  const maxAbsHistPct = useMemo(() => {
    const pts = premium?.history24h || [];
    if (!pts.length) return 0.1;
    return Math.max(0.03, ...pts.map((p) => Math.abs(p.premiumPct || 0)));
  }, [premium]);

  const sessionElapsedMin = useMemo(() => {
    if (!sessionStartedAt || !lastUpdated) return 0;
    return Math.max(0, Math.round((lastUpdated - sessionStartedAt) / 60000));
  }, [sessionStartedAt, lastUpdated]);

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: '1 / -1' }}>
      <div className="hft-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h3 className="hft-panel-title font-mono">
            <span className="hft-icon">🇺🇸</span> SPOT BUYING PRESSURE — COINBASE PREMIUM &amp; MULTI-EXCHANGE CVD
          </h3>
          {premium?.regime && premium.regime !== 'UNAVAILABLE' && (
            <span
              className="font-mono"
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '4px',
                background: premTone.bg,
                color: premTone.text,
                border: premTone.border,
              }}
            >
              CB: {premium.label}
            </span>
          )}
          {activeComparison?.alignment?.state && activeComparison.alignment.state !== 'INSUFFICIENT' && (
            <span
              className="font-mono"
              style={{
                fontSize: '0.6rem',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '4px',
                background: flowTone.bg,
                color: flowTone.text,
                border: flowTone.border,
              }}
              title={activeComparison.alignment.detail}
            >
              {activeComparison.alignment.label}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {lastUpdated && (
            <span className="font-mono text-slate-500" style={{ fontSize: '0.58rem' }}>
              {new Date(lastUpdated).toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            type="button"
            onClick={handleManualSync}
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
              fontSize: '0.62rem',
            }}
            title="Cập nhật Coinbase Premium & Multi-Exchange Taker Flow"
          >
            <RefreshCw size={11} className={refreshing ? 'spin-animation' : ''} />
            <span>Sync</span>
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      <div className="spot-pressure-grid">
        {/* Left: Coinbase Premium Index */}
        <div className="spot-pressure-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <Tooltip content={METRIC_METADATA.coinbasePremium}>
              <span className="font-mono text-slate-300" style={{ fontSize: '0.64rem', fontWeight: 700, cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)' }}>
                COINBASE PREMIUM INDEX
              </span>
            </Tooltip>
            <span className="font-mono text-slate-500" style={{ fontSize: '0.55rem' }}>
              BTC-USD vs BTCUSDT
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <div className="font-mono" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span
                style={{
                  fontSize: '1.35rem',
                  fontWeight: 700,
                  color: (premium?.premiumPct ?? 0) > 0
                    ? 'var(--color-emerald-400)'
                    : (premium?.premiumPct ?? 0) < 0
                      ? 'var(--color-rose-400)'
                      : 'var(--text-slate-300)',
                }}
              >
                {fmtSignedUsd(premium?.premiumUsd, 2)}
              </span>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: (premium?.premiumPct ?? 0) > 0
                    ? 'var(--color-emerald-400)'
                    : (premium?.premiumPct ?? 0) < 0
                      ? 'var(--color-rose-400)'
                      : 'var(--text-slate-400)',
                }}
              >
                ({fmtSignedPct(premium?.premiumPct, 3)})
              </span>
            </div>

            {premium?.avgPremiumPct24h != null && (
              <span className="font-mono text-slate-400" style={{ fontSize: '0.56rem' }}>
                24H Avg: <strong className={premium.avgPremiumPct24h >= 0 ? 'text-emerald' : 'text-rose'}>
                  {fmtSignedUsd(premium.avgPremiumUsd24h, 1)} ({fmtSignedPct(premium.avgPremiumPct24h, 3)})
                </strong>
              </span>
            )}
          </div>

          {/* Spot Prices Comparison */}
          <div
            className="font-mono"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '6px',
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--border-panel)',
              borderRadius: '4px',
              padding: '8px',
              fontSize: '0.58rem',
            }}
          >
            <div>
              <div className="text-slate-500" style={{ fontSize: '0.5rem' }}>COINBASE SPOT</div>
              <div className="text-slate-200" style={{ fontWeight: 700 }}>{fmtPrice(premium?.coinbasePrice)}</div>
            </div>
            <div>
              <div className="text-slate-500" style={{ fontSize: '0.5rem' }}>BINANCE SPOT</div>
              <div className="text-slate-200" style={{ fontWeight: 700 }}>{fmtPrice(premium?.binanceSpotPrice)}</div>
            </div>
            <div>
              <div className="text-slate-500" style={{ fontSize: '0.5rem' }}>CB vs BN FUT</div>
              <div className={(premium?.cbVsFuturesPct ?? 0) >= 0 ? 'text-emerald' : 'text-rose'} style={{ fontWeight: 700 }}>
                {fmtSignedPct(premium?.cbVsFuturesPct, 3)}
              </div>
            </div>
          </div>

          {/* 24H Hourly Sparkline Bars */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }} className="font-mono">
              <span className="text-slate-500" style={{ fontSize: '0.5rem' }}>24H HOURLY PREMIUM TREND</span>
              <span className="text-slate-500" style={{ fontSize: '0.5rem' }}>{premium?.history24h?.length || 0}h</span>
            </div>
            <div className="cb-premium-bars" title="Biểu đồ Coinbase Premium theo từng giờ trong 24 giờ gần nhất">
              {premium?.history24h?.length > 0 ? (
                premium.history24h.map((pt) => {
                  const pct = pt.premiumPct || 0;
                  const heightPct = Math.max(8, Math.min(48, (Math.abs(pct) / maxAbsHistPct) * 48));
                  const isPos = pct >= 0;
                  const timeStr = new Date(pt.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div
                      key={pt.time}
                      className="cb-premium-bar-col"
                      title={`${timeStr}: ${fmtSignedUsd(pt.premiumUsd, 1)} (${fmtSignedPct(pct, 3)})`}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: `${heightPct}%`,
                          background: isPos ? 'var(--color-emerald-400)' : 'var(--color-rose-400)',
                          opacity: 0.85,
                          borderRadius: '2px',
                          transform: isPos ? 'translateY(-50%)' : 'translateY(50%)',
                        }}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="font-mono text-slate-500" style={{ margin: 'auto', fontSize: '0.56rem' }}>
                  {loading ? 'Đang tải 24H Coinbase Premium...' : 'Chưa có lịch sử Coinbase'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Multi-Exchange Spot vs Futures Taker Flow / CVD */}
        <div className="spot-pressure-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Tooltip content={METRIC_METADATA.multiExchangeCvd}>
                <span className="font-mono text-slate-300" style={{ fontSize: '0.64rem', fontWeight: 700, cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)' }}>
                  MULTI-EXCHANGE SPOT vs FUTURES CVD
                </span>
              </Tooltip>
              <span className="font-mono text-slate-500" style={{ fontSize: '0.52rem' }}>
                {flowMode === 'session'
                  ? `Tích lũy phiên (${sessionElapsedMin}m · chống trùng ID)`
                  : 'Batch khớp lệnh gần nhất'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div className="etf-timeframe-toggle font-mono">
                <button
                  type="button"
                  onClick={() => setFlowMode('session')}
                  className={`toggle-btn ${flowMode === 'session' ? 'active' : ''}`}
                  title="Cộng dồn trade thực tế từ lúc mở tab (cùng khung thời gian cho mọi sàn)"
                >
                  SESSION LIVE
                </button>
                <button
                  type="button"
                  onClick={() => setFlowMode('snapshot')}
                  className={`toggle-btn ${flowMode === 'snapshot' ? 'active' : ''}`}
                  title="Ảnh chụp lô lệnh gần nhất mỗi sàn"
                >
                  RECENT FLOW
                </button>
              </div>
              {flowMode === 'session' && (
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="font-mono text-slate-400 hover:text-slate-200"
                  style={{
                    background: 'var(--bg-slate-900)',
                    border: '1px solid var(--border-panel)',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    cursor: 'pointer',
                    fontSize: '0.55rem',
                  }}
                  title="Đặt lại bộ đếm Session CVD đa sàn"
                >
                  <RotateCcw size={10} />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>

          <div className="multi-cvd-table-wrap">
            <table className="multi-cvd-table font-mono">
              <thead>
                <tr>
                  <th>SÀN</th>
                  <th>SPOT CVD (DELTA / %)</th>
                  <th>FUTURES CVD (DELTA / %)</th>
                  <th>ĐỐI CHIẾU SPOT vs FUT</th>
                </tr>
              </thead>
              <tbody>
                {(activeComparison?.rows || []).map(({ code, spot, futures }) => {
                  const meta = VENUE_LABELS[code] || { name: code, tag: code, color: '#94a3b8' };
                  const verdict = compareRowFlow(spot, futures, code);
                  return (
                    <tr key={code}>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
                          <strong className="text-slate-200">{meta.name}</strong>
                        </div>
                      </td>
                      <td>{renderVenueCell(spot, 'Lỗi API')}</td>
                      <td>
                        {code === 'COINBASE'
                          ? <span className="text-slate-500" style={{ fontSize: '0.55rem' }}>Spot USD Only</span>
                          : renderVenueCell(futures, 'Lỗi API')}
                      </td>
                      <td>
                        <span className={verdict.cls} style={{ fontSize: '0.58rem', fontWeight: 600 }}>
                          {verdict.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {activeComparison && (
                <tfoot>
                  <tr>
                    <td className="text-slate-300">
                      TỔNG ĐA SÀN ({activeComparison.spotTotal.activeVenues}S/{activeComparison.futuresTotal.activeVenues}F)
                    </td>
                    <td>{renderVenueCell(activeComparison.spotTotal)}</td>
                    <td>{renderVenueCell(activeComparison.futuresTotal)}</td>
                    <td>
                      <span style={{ color: flowTone.text, fontSize: '0.6rem', fontWeight: 700 }}>
                        {activeComparison.alignment.label}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="font-mono text-slate-500" style={{ fontSize: '0.52rem', lineHeight: 1.4 }}>
            * Bybit/OKX/Coinbase không có dữ liệu taker-buy lịch sử trong REST Klines, nên bảng đa sàn tổng hợp trực tiếp từ stream khớp lệnh thực tế (Binance 24H/7D/30D lịch sử xem ở panel CVD phía trên).
          </div>
        </div>
      </div>
    </div>
  );
}

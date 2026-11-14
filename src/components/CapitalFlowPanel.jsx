import { useEffect, useMemo, useState } from 'react';
import ModuleMenu from './ModuleMenu';
import DataOriginBadge from './DataOriginBadge';
import { classifyCapitalFlow } from '../services/capitalFlowEngine';
import { getBTCFuturesKlines, getOIHistory } from '../services/api';
import {
  calculateSpotFuturesVolumeRatio,
  selectAlignedSpotFuturesVolumes,
} from '../services/spotFlowEngine';

const finite = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const signedPct = (value, digits = 2) => {
  const parsed = finite(value);
  return parsed == null ? '---' : `${parsed > 0 ? '+' : ''}${parsed.toFixed(digits)}%`;
};

const compactUsd = (value) => {
  const parsed = finite(value);
  if (parsed == null) return '---';
  const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : '';
  const absolute = Math.abs(parsed);
  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
};

function normalizeCvdHistory(payload) {
  if (Array.isArray(payload)) return { points: payload, windowNetDelta: null, asOf: payload.at(-1)?.time ?? null };
  if (Array.isArray(payload?.points)) {
    return {
      points: payload.points,
      windowNetDelta: finite(payload.windowNetDelta),
      asOf: payload.asOf ?? payload.points.at(-1)?.time ?? null,
    };
  }
  return { points: [], windowNetDelta: null, asOf: null };
}

function sumVolume(points, field) {
  return points.reduce((sum, point) => sum + (finite(point?.[field]) ?? 0), 0);
}

function useCapitalFlowInputs({
  cvdHistory,
  futuresStream,
  cvdHistorySpot,
  spotStream,
  oiHistory,
  openInterest,
  allowStreamFallback = true,
  expectedOiPoints = 24,
}) {
  const normalized = useMemo(() => normalizeCvdHistory(cvdHistory), [cvdHistory]);
  const historyBuy = sumVolume(normalized.points, 'buyVol');
  const historySell = sumVolume(normalized.points, 'sellVol');
  const liveSessionCvd = allowStreamFallback ? (finite(futuresStream?.sessionCvd) ?? 0) : null;
  const liveSessionBuy = allowStreamFallback ? (finite(futuresStream?.sessionBuyVolume) ?? finite(futuresStream?.buyVolume) ?? 0) : 0;
  const liveSessionSell = allowStreamFallback ? (finite(futuresStream?.sessionSellVolume) ?? finite(futuresStream?.sellVolume) ?? 0) : 0;
  const historyNet = normalized.windowNetDelta
    ?? (normalized.points.at(-1)?.cumulativeWithinWindow)
    ?? (historyBuy - historySell);
  const hasHistory = normalized.points.length > 0;
  // The immutable horizon payload is authoritative. Session stream is a fallback only for 24h;
  // adding it blindly would double-count trades already included by the latest refresh.
  const netDelta = hasHistory ? (finite(historyNet) ?? 0) : liveSessionCvd;
  const buyVolume = hasHistory ? historyBuy : liveSessionBuy;
  const sellVolume = hasHistory ? historySell : liveSessionSell;
  const totalVolume = buyVolume + sellVolume;
  const cvdRatioPct = totalVolume > 0 && netDelta != null ? (netDelta / totalVolume) * 100 : null;

  // Spot volume & delta
  const normalizedSpot = useMemo(() => normalizeCvdHistory(cvdHistorySpot), [cvdHistorySpot]);
  const historyBuySpot = sumVolume(normalizedSpot.points, 'buyVol');
  const historySellSpot = sumVolume(normalizedSpot.points, 'sellVol');
  const liveSessionCvdSpot = allowStreamFallback ? (finite(spotStream?.sessionCvd) ?? 0) : null;
  const liveSessionBuySpot = allowStreamFallback ? (finite(spotStream?.sessionBuyVolume) ?? finite(spotStream?.buyVolume) ?? 0) : 0;
  const liveSessionSellSpot = allowStreamFallback ? (finite(spotStream?.sessionSellVolume) ?? finite(spotStream?.sellVolume) ?? 0) : 0;
  const historyNetSpot = normalizedSpot.windowNetDelta
    ?? (normalizedSpot.points.at(-1)?.cumulativeWithinWindow)
    ?? (historyBuySpot - historySellSpot);
  const hasHistorySpot = normalizedSpot.points.length > 0;
  const spotNetDelta = hasHistorySpot ? (finite(historyNetSpot) ?? 0) : (allowStreamFallback && spotStream ? liveSessionCvdSpot : null);
  const buyVolumeSpot = hasHistorySpot ? historyBuySpot : liveSessionBuySpot;
  const sellVolumeSpot = hasHistorySpot ? historySellSpot : liveSessionSellSpot;
  const totalVolumeSpot = buyVolumeSpot + sellVolumeSpot;
  const spotCvdRatioPct = totalVolumeSpot > 0 && spotNetDelta != null ? (spotNetDelta / totalVolumeSpot) * 100 : null;

  const validOi = (Array.isArray(oiHistory) ? oiHistory : [])
    .map((point) => ({ value: finite(point?.sumOpenInterest), time: finite(point?.timestamp) }))
    .filter((point) => point.value > 0);
  const firstOi = validOi[0]?.value ?? null;
  const lastOi = finite(openInterest) ?? validOi.at(-1)?.value ?? null;
  const oiChangePct = firstOi > 0 && lastOi > 0 ? ((lastOi - firstOi) / firstOi) * 100 : null;
  const cvdCoverage = hasHistory ? Math.min(100, (normalized.points.length / Math.max(1, normalized.points.length)) * 100) : 0;
  const oiCoverage = Math.min(100, (validOi.length / Math.max(1, expectedOiPoints)) * 100);
  const alignedVolumes = selectAlignedSpotFuturesVolumes({
    hasFuturesHistory: hasHistory,
    futuresHistoryVol: historyBuy + historySell,
    futuresSessionVol: liveSessionBuy + liveSessionSell,
    hasSpotHistory: hasHistorySpot,
    spotHistoryVol: historyBuySpot + historySellSpot,
    spotSessionVol: liveSessionBuySpot + liveSessionSellSpot,
  });
  const spotVolumeRatio = calculateSpotFuturesVolumeRatio({
    spotQuoteVol: alignedVolumes.spotQuoteVol,
    futuresQuoteVol: alignedVolumes.futuresQuoteVol,
  });

  return {
    netDelta,
    cvdRatioPct,
    spotNetDelta,
    spotCvdRatioPct,
    totalVolume,
    totalVolumeSpot,
    spotVolumeRatio,
    oiChangePct,
    coveragePct: Math.min(cvdCoverage, oiCoverage),
    cvdAsOf: normalized.asOf,
    oiAsOf: validOi.at(-1)?.time ?? null,
    hasHistory,
    hasHistorySpot,
  };
}

const toneLabel = {
  bullish: 'flow-in',
  bearish: 'flow-out',
  constructive: 'flow-rotation',
  warning: 'flow-warning',
  neutral: 'flow-neutral',
};

const HORIZON_CONFIG = {
  '24h': { label: '24H', expectedOiPoints: 24 },
  '7d': { label: '7D', period: '4h', limit: 42, expectedOiPoints: 42 },
  '30d': { label: '30D', period: '1d', limit: 30, expectedOiPoints: 30 },
};

export default function CapitalFlowPanel({
  priceChangePct,
  cvdHistory24h,
  cvdHistory7d,
  cvdHistory30d,
  futuresStream,
  cvdHistory24hSpot,
  cvdHistory7dSpot,
  cvdHistory30dSpot,
  spotStream,
  oiHistory,
  openInterest,
  fundingRate,
  basisPct,
}) {
  const [timeframe, setTimeframe] = useState('24h');
  const [horizonExtras, setHorizonExtras] = useState({});

  useEffect(() => {
    if (timeframe === '24h') return;
    if (horizonExtras[timeframe]?.loaded) return;

    let cancelled = false;
    const cfg = HORIZON_CONFIG[timeframe];
    Promise.all([
      getOIHistory('BTCUSDT', cfg.period, cfg.limit).catch(() => []),
      getBTCFuturesKlines('BTCUSDT', cfg.period, cfg.limit).catch(() => []),
    ]).then(([oiList, klines]) => {
      if (cancelled) return;
      const firstOpen = finite(klines?.[0]?.open);
      const lastClose = finite(klines?.at(-1)?.close);
      const computedPricePct = firstOpen > 0 && lastClose > 0
        ? ((lastClose - firstOpen) / firstOpen) * 100
        : null;
      setHorizonExtras((prev) => ({
        ...prev,
        [timeframe]: {
          oiHistory: Array.isArray(oiList) ? oiList : [],
          priceChangePct: computedPricePct,
          loaded: true,
        },
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [timeframe, horizonExtras]);

  const activeCvdHistory = timeframe === '7d'
    ? cvdHistory7d
    : timeframe === '30d'
      ? cvdHistory30d
      : cvdHistory24h;
  const activeCvdHistorySpot = timeframe === '7d'
    ? cvdHistory7dSpot
    : timeframe === '30d'
      ? cvdHistory30dSpot
      : cvdHistory24hSpot;
  const activeOiHistory = timeframe === '24h'
    ? oiHistory
    : horizonExtras[timeframe]?.oiHistory;
  const activePriceChangePct = timeframe === '24h'
    ? priceChangePct
    : horizonExtras[timeframe]?.priceChangePct;
  const horizonLabel = HORIZON_CONFIG[timeframe].label;

  const inputs = useCapitalFlowInputs({
    cvdHistory: activeCvdHistory,
    futuresStream,
    cvdHistorySpot: activeCvdHistorySpot,
    spotStream,
    oiHistory: activeOiHistory,
    openInterest,
    allowStreamFallback: timeframe === '24h',
    expectedOiPoints: HORIZON_CONFIG[timeframe].expectedOiPoints,
  });
  const verdict = useMemo(() => classifyCapitalFlow({
    priceChangePct: activePriceChangePct,
    cvdRatioPct: inputs.cvdRatioPct,
    oiChangePct: inputs.oiChangePct,
    fundingRate,
    basisPct,
    coveragePct: inputs.coveragePct,
    spotCvdRatioPct: inputs.spotCvdRatioPct,
    spotNetDelta: inputs.spotNetDelta,
  }), [
    activePriceChangePct,
    inputs.cvdRatioPct,
    inputs.oiChangePct,
    inputs.coveragePct,
    fundingRate,
    basisPct,
    inputs.spotCvdRatioPct,
    inputs.spotNetDelta,
  ]);

  const showAlertSpot = verdict.spotAlignment?.state === 'SPOT_DIVERGENCE';
  const showAlertCrowding = verdict.crowding?.state === 'CROWDED_LONGS' || verdict.crowding?.state === 'CROWDED_SHORTS';
  const showAlertQuality = verdict.quality?.level === 'INSUFFICIENT' || verdict.quality?.level === 'DEGRADED';

  const oiTooltip = [
    inputs.oiChangePct != null ? `ΔOI ${horizonLabel}: ${signedPct(inputs.oiChangePct)}` : null,
    openInterest ? `OI: ${(Number(openInterest) / 1000).toFixed(1)}K BTC` : null,
    fundingRate != null ? `Funding: ${(Number(fundingRate) * 100).toFixed(4)}%` : null,
    basisPct != null ? `Basis: ${signedPct(basisPct, 2)}` : null,
  ].filter(Boolean).join(' | ');

  return (
    <section
      className={`hft-panel glass-panel capital-flow-panel ${toneLabel[verdict.tone] || 'flow-neutral'}`}
      aria-label={`Market Flow Regime ${horizonLabel}`}
    >
      <div className="capital-flow-bar">
        {/* Left: Identity, Regime & Dynamic Alerts */}
        <div className="capital-flow-identity">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span className="capital-flow-kicker font-mono">FLOW REGIME</span>
            <div className="capital-flow-tf-switch font-mono" role="group" aria-label="Khung thời gian Flow Regime">
              {Object.entries(HORIZON_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  className={`capital-flow-tf-btn ${timeframe === key ? 'active' : ''}`}
                  onClick={() => setTimeframe(key)}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
            <DataOriginBadge
              origin={inputs.hasHistory ? 'history' : 'session'}
              label={inputs.hasHistory ? `LỊCH SỬ ${horizonLabel}` : 'MỞ TAB (FALLBACK)'}
              title={inputs.hasHistory
                ? `Tính từ chuỗi dữ liệu ${horizonLabel} lịch sử của Binance (CVD Futures/Spot & OI History).`
                : 'Đang fallback sang stream từ lúc mở tab do chưa tải xong lịch sử 24H.'}
              compact
            />
          </div>
          <div className="capital-flow-status-group">
            <span
              className={`capital-flow-state-badge font-mono tone-${verdict.tone || 'neutral'}`}
              title={verdict.actionBadge ? `${verdict.actionBadge} — ${verdict.detail}` : verdict.detail}
            >
              {verdict.label}
            </span>
            {(showAlertSpot || showAlertCrowding || showAlertQuality) && (
              <div className="capital-flow-alerts font-mono">
                {showAlertSpot && (
                  <span className={`capital-flow-alert-pill tone-${verdict.spotAlignment.tone}`} title={verdict.spotAlignment.detail}>
                    {verdict.spotAlignment.label}
                  </span>
                )}
                {showAlertCrowding && (
                  <span className={`capital-flow-alert-pill tone-${verdict.crowding.tone}`} title={verdict.crowding.detail}>
                    {verdict.crowding.label}
                  </span>
                )}
                {showAlertQuality && (
                  <span className="capital-flow-alert-pill tone-warning" title={verdict.quality.detail}>
                    {verdict.quality.label}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center/Right: Core 4 Metrics Strip */}
        <div className="capital-flow-metrics-strip font-mono">
          <div className="capital-flow-metric-item">
            <span className="metric-label">GIÁ</span>
            <div className="metric-val-group">
              <span className={`metric-val ${(activePriceChangePct || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                {signedPct(activePriceChangePct)}
              </span>
            </div>
          </div>

          <div className="capital-flow-metric-item">
            <span className="metric-label">FUT CVD</span>
            <div className="metric-val-group">
              <span className={`metric-val ${(inputs.netDelta || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                {compactUsd(inputs.netDelta)}
              </span>
              <span className="metric-sub-pct text-slate-400">
                {signedPct(inputs.cvdRatioPct)} vol
              </span>
            </div>
          </div>

          <div className="capital-flow-metric-item">
            <span className="metric-label">SPOT CVD</span>
            <div className="metric-val-group">
              <span className={`metric-val ${(inputs.spotNetDelta || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                {compactUsd(inputs.spotNetDelta)}
              </span>
              <span className="metric-sub-pct text-slate-400">
                {signedPct(inputs.spotCvdRatioPct)} vol
              </span>
            </div>
          </div>

          <div className="capital-flow-metric-item" title={oiTooltip}>
            <span className="metric-label">OPEN INTEREST</span>
            <div className="metric-val-group">
              <span className={`metric-val ${(inputs.oiChangePct || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
                {signedPct(inputs.oiChangePct)}
              </span>
              {openInterest && (
                <span className="metric-sub-pct text-slate-400">
                  ({(Number(openInterest) / 1000).toFixed(1)}K BTC)
                </span>
              )}
            </div>
          </div>

          <div
            className="capital-flow-metric-item"
            title={inputs.spotVolumeRatio?.spotSharePct != null
              ? `${inputs.spotVolumeRatio.label} | Spot Vol: ${compactUsd(inputs.spotVolumeRatio.spotQuoteVol).replace('+', '')} vs Fut Vol: ${compactUsd(inputs.spotVolumeRatio.futuresQuoteVol).replace('+', '')}`
              : 'Đang chờ dữ liệu Volume Spot vs Futures 24H'}
          >
            <span className="metric-label">SPOT / FUT VOL</span>
            <div className="metric-val-group">
              <span className={`metric-val ${
                inputs.spotVolumeRatio?.tone === 'bullish'
                  ? 'text-emerald'
                  : inputs.spotVolumeRatio?.tone === 'warning'
                    ? 'text-amber'
                    : 'text-slate-200'
              }`}>
                {inputs.spotVolumeRatio?.spotSharePct != null
                  ? `${inputs.spotVolumeRatio.spotSharePct.toFixed(1)}%`
                  : '---'}
              </span>
              {inputs.spotVolumeRatio?.spotToFuturesRatio != null && (
                <span className="metric-sub-pct text-slate-400">
                  ({inputs.spotVolumeRatio.spotToFuturesRatio.toFixed(2)}x)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Far Right: Actions Menu */}
        <div className="capital-flow-actions">
          <ModuleMenu moduleId="hft_capital_flow" />
        </div>
      </div>
    </section>
  );
}


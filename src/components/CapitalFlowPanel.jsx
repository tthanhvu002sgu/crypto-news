import { useMemo } from 'react';
import ModuleMenu from './ModuleMenu';
import { classifyCapitalFlow } from '../services/capitalFlowEngine';

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
  cvdHistory24h,
  futuresStream,
  cvdHistory24hSpot,
  spotStream,
  oiHistory,
  openInterest,
}) {
  const normalized = useMemo(() => normalizeCvdHistory(cvdHistory24h), [cvdHistory24h]);
  const historyBuy = sumVolume(normalized.points, 'buyVol');
  const historySell = sumVolume(normalized.points, 'sellVol');
  const liveSessionCvd = finite(futuresStream?.sessionCvd) ?? 0;
  const liveSessionBuy = finite(futuresStream?.sessionBuyVolume) ?? finite(futuresStream?.buyVolume) ?? 0;
  const liveSessionSell = finite(futuresStream?.sessionSellVolume) ?? finite(futuresStream?.sellVolume) ?? 0;
  const historyNet = normalized.windowNetDelta
    ?? (normalized.points.at(-1)?.cumulativeWithinWindow)
    ?? (historyBuy - historySell);
  const hasHistory = normalized.points.length > 0;
  // The immutable 24H payload is authoritative. Session stream is a fallback only;
  // adding it blindly would double-count trades already included by the latest refresh.
  const netDelta = hasHistory ? (finite(historyNet) ?? 0) : liveSessionCvd;
  const buyVolume = hasHistory ? historyBuy : liveSessionBuy;
  const sellVolume = hasHistory ? historySell : liveSessionSell;
  const totalVolume = buyVolume + sellVolume;
  const cvdRatioPct = totalVolume > 0 ? (netDelta / totalVolume) * 100 : null;

  // Spot 24H volume & delta
  const normalizedSpot = useMemo(() => normalizeCvdHistory(cvdHistory24hSpot), [cvdHistory24hSpot]);
  const historyBuySpot = sumVolume(normalizedSpot.points, 'buyVol');
  const historySellSpot = sumVolume(normalizedSpot.points, 'sellVol');
  const liveSessionCvdSpot = finite(spotStream?.sessionCvd) ?? 0;
  const liveSessionBuySpot = finite(spotStream?.sessionBuyVolume) ?? finite(spotStream?.buyVolume) ?? 0;
  const liveSessionSellSpot = finite(spotStream?.sessionSellVolume) ?? finite(spotStream?.sellVolume) ?? 0;
  const historyNetSpot = normalizedSpot.windowNetDelta
    ?? (normalizedSpot.points.at(-1)?.cumulativeWithinWindow)
    ?? (historyBuySpot - historySellSpot);
  const hasHistorySpot = normalizedSpot.points.length > 0;
  const spotNetDelta = hasHistorySpot ? (finite(historyNetSpot) ?? 0) : (spotStream ? liveSessionCvdSpot : null);
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
  const cvdCoverage = Math.min(100, (normalized.points.length / 24) * 100);
  const oiCoverage = Math.min(100, (validOi.length / 24) * 100);

  return {
    netDelta,
    cvdRatioPct,
    spotNetDelta,
    spotCvdRatioPct,
    oiChangePct,
    coveragePct: Math.min(cvdCoverage, oiCoverage),
    cvdAsOf: normalized.asOf,
    oiAsOf: validOi.at(-1)?.time ?? null,
  };
}

const toneLabel = {
  bullish: 'flow-in',
  bearish: 'flow-out',
  constructive: 'flow-rotation',
  warning: 'flow-warning',
  neutral: 'flow-neutral',
};

export default function CapitalFlowPanel({
  priceChangePct,
  cvdHistory24h,
  futuresStream,
  cvdHistory24hSpot,
  spotStream,
  oiHistory,
  openInterest,
  fundingRate,
  basisPct,
}) {
  const inputs = useCapitalFlowInputs({
    cvdHistory24h,
    futuresStream,
    cvdHistory24hSpot,
    spotStream,
    oiHistory,
    openInterest,
  });
  const verdict = useMemo(() => classifyCapitalFlow({
    priceChangePct,
    cvdRatioPct: inputs.cvdRatioPct,
    oiChangePct: inputs.oiChangePct,
    fundingRate,
    basisPct,
    coveragePct: inputs.coveragePct,
    spotCvdRatioPct: inputs.spotCvdRatioPct,
    spotNetDelta: inputs.spotNetDelta,
  }), [
    priceChangePct,
    inputs.cvdRatioPct,
    inputs.oiChangePct,
    inputs.coveragePct,
    fundingRate,
    basisPct,
    inputs.spotCvdRatioPct,
    inputs.spotNetDelta,
  ]);

  const qualityClass = verdict.quality.level === 'HIGH'
    ? 'is-high'
    : verdict.quality.level === 'INSUFFICIENT' ? 'is-low' : 'is-medium';

  return (
    <section className={`hft-panel glass-panel capital-flow-panel ${toneLabel[verdict.tone] || 'flow-neutral'}`} aria-label="Capital Flow In Out 24 giờ">
      <header className="hft-panel-header capital-flow-header">
        <div>
          <span className="capital-flow-eyebrow font-mono">MARKET FLOW REGIME · 24H</span>
          <h3 className="hft-panel-title font-mono">CAPITAL FLOW — IN / OUT</h3>
        </div>
        <div className="capital-flow-header-actions">
          <span className={`capital-flow-quality font-mono ${qualityClass}`}>{verdict.quality.label}</span>
          <ModuleMenu moduleId="hft_capital_flow" />
        </div>
      </header>

      <div className="capital-flow-hero">
        <div className="capital-flow-status">
          <div className="capital-flow-headline">
            <span className={`capital-flow-state-badge font-mono state-${(verdict.flow || 'neutral').toLowerCase()}`}>
              {verdict.flow}
            </span>
            <strong className="capital-flow-title">{verdict.label}</strong>
          </div>
          <p className="capital-flow-desc">{verdict.detail}</p>
        </div>

        <div className="capital-flow-pills font-mono">
          <div className="capital-flow-pill">
            <span className="pill-label">BIAS</span>
            <strong className={`pill-val tone-${(verdict.bias || '').toLowerCase()}`}>{verdict.bias}</strong>
          </div>
          <div className="capital-flow-pill">
            <span className="pill-label">SPOT</span>
            <strong className={`pill-val tone-${verdict.spotAlignment?.tone || 'neutral'}`}>
              {verdict.spotAlignment?.label ?? '---'}
            </strong>
          </div>
          <div className="capital-flow-pill">
            <span className="pill-label">CROWDING</span>
            <strong className={`pill-val tone-${verdict.crowding?.tone || 'neutral'}`}>
              {verdict.crowding?.label ?? '---'}
            </strong>
          </div>
        </div>
      </div>

      <div className="capital-flow-metrics-grid font-mono">
        <div className="capital-metric-card">
          <span className="metric-label">GIÁ 24H</span>
          <span className={`metric-main ${(priceChangePct || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {signedPct(priceChangePct)}
          </span>
        </div>

        <div className="capital-metric-card">
          <span className="metric-label">FUTURES CVD 24H</span>
          <span className={`metric-main ${(inputs.netDelta || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {compactUsd(inputs.netDelta)}
          </span>
          <span className="metric-sub text-slate-400">
            {signedPct(inputs.cvdRatioPct)} vol
          </span>
        </div>

        <div className="capital-metric-card">
          <span className="metric-label">SPOT CVD 24H</span>
          <span className={`metric-main ${(inputs.spotNetDelta || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {compactUsd(inputs.spotNetDelta)}
          </span>
          <span className="metric-sub text-slate-400">
            {signedPct(inputs.spotCvdRatioPct)} vol
          </span>
        </div>

        <div className="capital-metric-card">
          <span className="metric-label">OPEN INTEREST &amp; FUNDING</span>
          <div className="metric-main-group">
            <span className={`metric-main ${(inputs.oiChangePct || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
              {signedPct(inputs.oiChangePct)}
            </span>
            {openInterest && (
              <span className="metric-sub-val text-slate-400">
                ({`${(Number(openInterest) / 1000).toFixed(1)}K BTC`})
              </span>
            )}
          </div>
          <span className="metric-sub text-slate-400">
            Funding: {fundingRate == null ? '---' : `${(Number(fundingRate) * 100).toFixed(4)}%`}{basisPct != null ? ` · Basis: ${signedPct(basisPct, 2)}` : ''}
          </span>
        </div>
      </div>

      <div className="capital-flow-footer font-mono">
        <span className="text-slate-400">
          {verdict.quality.detail}{verdict.spotAlignment?.detail ? ` · ${verdict.spotAlignment.detail}` : ''}
        </span>
      </div>
    </section>
  );
}

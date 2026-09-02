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

function useCapitalFlowInputs({ cvdHistory24h, futuresStream, oiHistory, openInterest }) {
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
  oiHistory,
  openInterest,
  fundingRate,
  basisPct,
}) {
  const inputs = useCapitalFlowInputs({ cvdHistory24h, futuresStream, oiHistory, openInterest });
  const verdict = useMemo(() => classifyCapitalFlow({
    priceChangePct,
    cvdRatioPct: inputs.cvdRatioPct,
    oiChangePct: inputs.oiChangePct,
    fundingRate,
    basisPct,
    coveragePct: inputs.coveragePct,
  }), [priceChangePct, inputs.cvdRatioPct, inputs.oiChangePct, inputs.coveragePct, fundingRate, basisPct]);

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
        <div className="capital-flow-verdict">
          <span className="capital-flow-state font-mono">{verdict.flow}</span>
          <div>
            <strong>{verdict.label}</strong>
            <p>{verdict.detail}</p>
          </div>
        </div>
        <div className="capital-flow-taxonomy font-mono">
          <div><span>DIRECTIONAL BIAS</span><strong>{verdict.bias}</strong></div>
          <div><span>MECHANISM</span><strong>{verdict.mechanism.replaceAll('_', ' ')}</strong></div>
          <div><span>HORIZON</span><strong>{verdict.horizon}</strong></div>
        </div>
      </div>

      <dl className="capital-flow-metrics font-mono">
        <div><dt>PRICE 24H</dt><dd>{signedPct(priceChangePct)}</dd></div>
        <div><dt>FUTURES CVD</dt><dd>{compactUsd(inputs.netDelta)}</dd><small>{signedPct(inputs.cvdRatioPct)} / volume</small></div>
        <div><dt>OPEN INTEREST</dt><dd>{signedPct(inputs.oiChangePct)}</dd><small>{openInterest ? `${(Number(openInterest) / 1000).toFixed(1)}K BTC` : '---'}</small></div>
        <div><dt>FUNDING</dt><dd>{fundingRate == null ? '---' : `${(Number(fundingRate) * 100).toFixed(4)}%`}</dd></div>
        <div><dt>BASIS</dt><dd>{signedPct(basisPct, 4)}</dd></div>
        <div><dt>CROWDING</dt><dd>{verdict.crowding.label}</dd></div>
      </dl>

      <div className="capital-flow-notes font-mono">
        <span>{verdict.quality.detail}</span>
        <span>OI quyết định exposure mở rộng/co lại; CVD chỉ xác định phía giao dịch chủ động.</span>
      </div>
    </section>
  );
}

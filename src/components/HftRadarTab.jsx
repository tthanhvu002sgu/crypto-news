import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Line } from 'react-chartjs-2';

import { getCompletedHourCVD, getOrderBookDepth, getWhaleWalls, getFootprintNodesForTimeframe } from '../services/api';
import Tooltip, { METRIC_METADATA } from './Tooltip';
import AdvancedChart from './AdvancedChart';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import {
  downloadMoveResearch,
  subscribeMoveTracker,
  updateMoveTrackerContext,
  updateMoveTrackerSettings,
  MOVE_CONFIG,
} from '../services/moveTracker';
import { describeMoveEvent } from '../services/moveTrackerCore';
import { subscribeCrosshair } from '../services/crosshairSync';
import { classifyFuturesPositioning, classifySpotFutures, computeFlowMetrics } from '../services/orderFlowMetrics';
import { withWindowCumulative } from '../services/cvdService';

// Plugin vẽ đường dọc highlight trên chart CVD theo crosshair của AdvancedChart
const cvdSyncPlugin = {
  id: 'cvdSync',
  afterDatasetsDraw(chart, args, opts) {
    if (opts == null || opts.index == null || opts.index < 0) return;
    const { ctx, chartArea, scales } = chart;
    if (!ctx || !scales || !scales.x || !chartArea) return;
    try {
      const x = typeof scales.x.getPixelForValue === 'function' ? scales.x.getPixelForValue(opts.index) : null;
      if (x == null || !Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    } catch {}
  }
};

// Plugin vẽ mốc 0 (Zero Baseline) đậm nét, nổi bật trên biểu đồ CVD & ORDER FLOW
const cvdZeroLinePlugin = {
  id: 'cvdZeroLine',
  beforeDatasetsDraw(chart, args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!ctx || !scales || !chartArea) return;
    const isLight = opts?.isLight ?? false;

    try {
      const yFutures = scales.y?.display && typeof scales.y.getPixelForValue === 'function'
        ? scales.y.getPixelForValue(0)
        : null;
      const ySpot = scales.y1?.display && typeof scales.y1.getPixelForValue === 'function'
        ? scales.y1.getPixelForValue(0)
        : null;

      ctx.save();

      if (yFutures != null && Number.isFinite(yFutures) && yFutures >= chartArea.top && yFutures <= chartArea.bottom) {
        ctx.strokeStyle = isLight ? 'rgba(30, 41, 59, 0.65)' : 'rgba(241, 245, 249, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yFutures);
        ctx.lineTo(chartArea.right, yFutures);
        ctx.stroke();

        // Nhãn mốc 0 của Futures tại mép trái
        ctx.fillStyle = isLight ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.85)';
        ctx.font = '600 9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('0 F', chartArea.left + 4, yFutures - 2);
      }

      if (ySpot != null && Number.isFinite(ySpot) && ySpot >= chartArea.top && ySpot <= chartArea.bottom) {
        const isCoincident = yFutures != null && Math.abs(yFutures - ySpot) <= 4;
        if (!isCoincident) {
          ctx.strokeStyle = isLight ? 'rgba(16, 185, 129, 0.6)' : 'rgba(52, 211, 153, 0.5)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, ySpot);
          ctx.lineTo(chartArea.right, ySpot);
          ctx.stroke();

          ctx.fillStyle = isLight ? 'rgba(16, 185, 129, 0.9)' : 'rgba(52, 211, 153, 0.85)';
          ctx.textAlign = 'right';
          ctx.fillText('0 S', chartArea.right - 4, ySpot - 2);
        }
      }

      ctx.restore();
    } catch {}
  }
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtUsd = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtCvdUsd = (n) => {
  if (n == null) return '---';
  const sign = n < 0 ? '-' : (n > 0 ? '+' : '');
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const getLastCompletedHourStart = () => {
  const currentHour = new Date();
  currentHour.setMinutes(0, 0, 0);
  return currentHour.getTime() - (60 * 60 * 1000);
};

const formatHourRange = (startTime) => {
  const start = new Date(startTime);
  const end = new Date(startTime + (60 * 60 * 1000));
  const hour = (date) => String(date.getHours()).padStart(2, '0');
  return `${hour(start)}:00–${hour(end)}:00`;
};

const fmtPrice = (n) => n ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '---';
const fmtSignedPct = (n, digits = 2) => Number.isFinite(Number(n))
  ? `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(digits)}%`
  : '---';
const fmtAge = (timestamp) => {
  if (!Number.isFinite(Number(timestamp))) return 'chưa rõ';
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 1000));
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m trước`;
  return `${Math.floor(seconds / 3600)}h trước`;
};

// Helper to get Chart Options based on current Theme
const getChartOptsBase = (theme) => {
  const isLight = theme === 'light';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
  const tickColor = isLight ? '#555555' : '#888888';
  const tooltipBg = isLight ? '#ffffff' : '#121214';
  const tooltipBorder = isLight ? '#eaeaea' : 'rgba(255, 255, 255, 0.1)';
  const tooltipTitle = isLight ? '#111111' : '#f3f4f6';
  const tooltipBody = isLight ? '#333333' : '#d1d5db';

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        padding: 10,
        caretPadding: 16,
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: tickColor, maxTicksLimit: 12, font: { family: 'Be Vietnam Pro, Roboto Mono', size: 10 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: 'Be Vietnam Pro, Roboto Mono', size: 10 } },
      },
    },
  };
};

// Shared hook: tracks the session-CVD baseline each time a history list refreshes,
// so the realtime delta appended to the last candle stays correct per market.
function useSessionDelta(sessionCvd, list) {
  const ref = useRef({ list, base: sessionCvd || 0 });
  if (ref.current.list !== list) {
    ref.current = { list, base: sessionCvd || 0 };
  }
  return (sessionCvd || 0) - ref.current.base;
}

function normalizeHistoryPayload(payload) {
  if (!payload) return { points: [], windowNetDelta: 0, asOf: null };
  if (Array.isArray(payload)) {
    const points = withWindowCumulative(payload);
    const windowNetDelta = points.at(-1)?.cumulativeWithinWindow ?? 0;
    return { points, windowNetDelta, asOf: points.at(-1)?.time ?? null };
  }
  if (Array.isArray(payload.points)) {
    const points = withWindowCumulative(payload.points);
    const netDelta = typeof payload.windowNetDelta === 'number'
      ? payload.windowNetDelta
      : (points.at(-1)?.cumulativeWithinWindow ?? 0);
    return { points, windowNetDelta: netDelta, asOf: payload.asOf ?? points.at(-1)?.time ?? null };
  }
  return { points: [], windowNetDelta: 0, asOf: null };
}

// Per-market CVD series (chart points + cumulative buy/sell volume + windowNetDelta).
function useMarketCvdSeries({
  tf, completedHourStart, completedHourCvd, stream,
  fallbackSessionCvd, fallbackBuyVolume, fallbackSellVolume,
  hist24, hist7, hist30, livePrice
}) {
  const sessionCvd = stream?.sessionCvd ?? fallbackSessionCvd;
  const buyVolume = stream?.buyVolume ?? fallbackBuyVolume;
  const sellVolume = stream?.sellVolume ?? fallbackSellVolume;
  const sessionBuyVolume = stream?.sessionBuyVolume ?? buyVolume;
  const sessionSellVolume = stream?.sessionSellVolume ?? sellVolume;

  const rawHistory = tf === '24H' ? hist24 : tf === '7D' ? hist7 : tf === '30D' ? hist30 : null;
  const normHistory = useMemo(() => normalizeHistoryPayload(rawHistory), [rawHistory]);
  const historyPoints = normHistory.points;

  const delta24 = useSessionDelta(sessionCvd, hist24?.points || hist24);
  const delta7 = useSessionDelta(sessionCvd, hist7?.points || hist7);
  const delta30 = useSessionDelta(sessionCvd, hist30?.points || hist30);
  const buyDelta24 = useSessionDelta(sessionBuyVolume, hist24?.points || hist24);
  const buyDelta7 = useSessionDelta(sessionBuyVolume, hist7?.points || hist7);
  const buyDelta30 = useSessionDelta(sessionBuyVolume, hist30?.points || hist30);
  const sellDelta24 = useSessionDelta(sessionSellVolume, hist24?.points || hist24);
  const sellDelta7 = useSessionDelta(sessionSellVolume, hist7?.points || hist7);
  const sellDelta30 = useSessionDelta(sessionSellVolume, hist30?.points || hist30);

  const activeCompleted = completedHourCvd?.startTime === completedHourStart
    ? completedHourCvd
    : null;
  const list1h = useMemo(() => activeCompleted?.points ?? [], [activeCompleted]);

  const delta = tf === '24H' ? delta24 : tf === '7D' ? delta7 : tf === '30D' ? delta30 : 0;
  const buyIncrement = tf === '24H' ? buyDelta24 : tf === '7D' ? buyDelta7 : tf === '30D' ? buyDelta30 : 0;
  const sellIncrement = tf === '24H' ? sellDelta24 : tf === '7D' ? sellDelta7 : tf === '30D' ? sellDelta30 : 0;

  const chartList = useMemo(() => {
    if (tf === '1H') return list1h || [];
    if (!historyPoints || historyPoints.length === 0) return [];
    const list = [...historyPoints];
    const last = list[list.length - 1];
    if (!last) return list;
    const lastAnchorCum = last.cumulativeFromAnchor ?? last.cvd ?? 0;
    const lastWindowCum = last.cumulativeWithinWindow ?? 0;
    list[list.length - 1] = {
      ...last,
      cumulativeFromAnchor: lastAnchorCum + delta,
      cumulativeWithinWindow: lastWindowCum + delta,
      cvd: lastAnchorCum + delta,
      delta: (last.delta || 0) + delta,
      buyVol: (last.buyVol || 0) + buyIncrement,
      sellVol: (last.sellVol || 0) + sellIncrement,
      price: livePrice || last.price
    };
    return list;
  }, [tf, list1h, historyPoints, delta, buyIncrement, sellIncrement, livePrice]);

  const netDelta = useMemo(() => {
    if (tf === '1H') {
      if (activeCompleted) {
        return activeCompleted.windowNetDelta ?? activeCompleted.cvd ?? 0;
      }
      const lastCandle = (hist24?.points || hist24 || []).at?.(-1);
      return (lastCandle?.delta ?? 0) + delta24;
    }
    return (Number(normHistory?.windowNetDelta) || 0) + (Number(delta) || 0);
  }, [tf, activeCompleted, normHistory?.windowNetDelta, delta, hist24, delta24]);

  const displayVol = useMemo(() => {
    if (tf === '1H') {
      return activeCompleted
        ? { buy: activeCompleted.buyVol, sell: activeCompleted.sellVol }
        : { buy: 0, sell: 0 };
    }
    if (!historyPoints || historyPoints.length === 0) {
      return { buy: buyVolume || 0, sell: sellVolume || 0 };
    }
    let buySum = 0;
    let sellSum = 0;
    for (let i = 0; i < historyPoints.length; i++) {
      buySum += (historyPoints[i].buyVol || 0);
      sellSum += (historyPoints[i].sellVol || 0);
    }
    // Only append volume observed after this history payload was refreshed.
    // The previous implementation added the full daily stream baseline and
    // double-counted candles already present in historyPoints.
    buySum += buyIncrement;
    sellSum += sellIncrement;
    return { buy: buySum, sell: sellSum };
  }, [tf, activeCompleted, buyVolume, sellVolume, historyPoints, buyIncrement, sellIncrement]);

  const expectedBuckets = tf === '1H' ? 60 : tf === '24H' ? 24 : tf === '7D' ? 42 : 30;
  const receivedBuckets = tf === '1H'
    ? Math.max(0, (activeCompleted?.points?.length ?? 1) - 1)
    : historyPoints.length;
  return {
    chartList,
    displayVol,
    netDelta,
    asOf: tf === '1H' ? activeCompleted?.endTime ?? null : normHistory.asOf,
    coverage: expectedBuckets > 0 ? Math.min(100, (receivedBuckets / expectedBuckets) * 100) : 0,
    isComplete: receivedBuckets >= expectedBuckets,
  };
}

const clusterVolNodes = (nodes, gap) => {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return [];
  if (!gap || gap <= 1) return nodes;

  const map = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || n.price == null) continue;
    const priceNum = Number(n.price);
    if (!Number.isFinite(priceNum)) continue;
    const binPrice = Math.floor(priceNum / gap) * gap;
    let entry = map.get(binPrice);
    if (!entry) {
      entry = { price: binPrice, priceHigh: binPrice + gap - 1, buy: 0, sell: 0 };
      map.set(binPrice, entry);
    }
    entry.buy += Number(n.buy) || 0;
    entry.sell += Number(n.sell) || 0;
  }

  return Array.from(map.values()).sort((a, b) => b.price - a.price);
};

function FootprintSection({ marketLabel, accentColor, nodes, nodeGap, cvdTf, coverage, raw = false }) {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return (
      <div className="hft-empty font-mono" style={{ padding: '16px', textOverflow: 'ellipsis', overflow: 'hidden', textAlign: 'center', color: 'var(--text-slate-400)', fontSize: '0.65rem', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
        ⚡ Đang tích lũy dữ liệu Footprint Nodes realtime cho thị trường {marketLabel}...
      </div>
    );
  }

  const totalClusterVol = nodes.reduce((acc, n) => acc + (Number(n?.buy) || 0) + (Number(n?.sell) || 0), 0);
  const maxSingleVol = Math.max(1, ...nodes.map(cn => Math.max(Number(cn?.buy) || 0, Number(cn?.sell) || 0)));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 6px', fontSize: '0.58rem' }} className="font-mono text-slate-400">
        <span>{raw ? 'RAW-TRADE FOOTPRINT' : 'EST. VOLUME-BY-PRICE'} ({marketLabel} · {cvdTf})</span>
        <span style={{ color: accentColor, fontWeight: 600 }}>
          {coverage ? `${coverage.receivedBuckets ?? 0}/${coverage.expectedBuckets ?? 0} bucket · ` : ''}{fmtUsd(totalClusterVol)}
        </span>
      </div>
      <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', padding: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.65rem' }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-slate-950)', zIndex: 10 }}>
            <tr>
              <th title={`Vùng giá gộp theo GAP $${nodeGap}. ${raw ? 'Tổng hợp từ raw trades đa sàn.' : `Ước lượng từ Binance ${marketLabel}.`}`} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>VÙNG GIÁ ({marketLabel})</th>
              <th title={`Volume mua chủ động ${raw ? 'đa sàn' : `trên Binance ${marketLabel}`} tích lũy realtime.`} style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>BUY VOL</th>
              <th title={`Volume bán chủ động ${raw ? 'đa sàn' : `trên Binance ${marketLabel}`} tích lũy realtime.`} style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>SELL VOL</th>
              <th title="Buy Vol - Sell Vol. Dương là mất cân bằng lệnh mua chủ động; âm là mất cân bằng lệnh bán chủ động, không tự động đồng nghĩa support/resistance." style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>DELTA</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n, idx) => {
              const buy = Number(n?.buy) || 0;
              const sell = Number(n?.sell) || 0;
              const delta = buy - sell;
              const total = buy + sell;
              if (total === 0) return null;

              const buyWidth = Math.min(100, (buy / maxSingleVol) * 100);
              const sellWidth = Math.min(100, (sell / maxSingleVol) * 100);

              return (
                <tr key={`${marketLabel}-${n?.price ?? 'node'}-${idx}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <td className="font-mono" style={{ padding: '8px', textAlign: 'left', color: 'var(--text-slate-200)' }}>
                    {n?.price} <span style={{ color: 'var(--text-slate-500)', margin: '0 4px' }}>~</span> {n?.priceHigh}
                  </td>
                  <td className="font-mono" style={{ padding: '8px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '4px', bottom: '4px', right: '8px', width: `${buyWidth}%`, background: 'rgba(16, 185, 129, 0.15)', borderRadius: '2px', zIndex: 1 }} />
                    <span style={{ position: 'relative', zIndex: 2, color: 'var(--color-emerald-400)' }}>{fmtUsd(buy)}</span>
                  </td>
                  <td className="font-mono" style={{ padding: '8px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '4px', bottom: '4px', right: '8px', width: `${sellWidth}%`, background: 'rgba(244, 63, 94, 0.15)', borderRadius: '2px', zIndex: 1 }} />
                    <span style={{ position: 'relative', zIndex: 2, color: 'var(--color-rose-400)' }}>{fmtUsd(sell)}</span>
                  </td>
                  <td className={`font-mono ${delta > 0 ? 'text-emerald' : 'text-rose'}`} style={{ padding: '8px', fontWeight: 600 }}>
                    <div style={{ background: delta > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)', display: 'inline-block', padding: '2px 6px', borderRadius: '4px' }}>
                      {delta > 0 ? '+' : ''}{fmtUsd(delta)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── PANEL 1: CVD & Order Flow ────────────────────────────────────────────────

function CVDPanel({
  sessionCvd, buyVolume, sellVolume,
  futuresStream, spotStream,
  cvdHistory24h, cvdHistory7d, cvdHistory30d,
  cvdHistory24hSpot, cvdHistory7dSpot, cvdHistory30dSpot,
  cvdStatus, livePrice, theme, volNodes = [], openInterest, oiHistory = [], fundingRate
}) {
  const [cvdTf, setCvdTf] = useState('1H');
  const [completedHourStart, setCompletedHourStart] = useState(getLastCompletedHourStart);
  const [completedHourCvdMap, setCompletedHourCvdMap] = useState({ FUTURES: null, SPOT: null });
  const [nodeGap, setNodeGap] = useState(() => {
    const saved = localStorage.getItem('hft_cvd_gap');
    return saved ? Number(saved) : 100;
  });

  // 1H means the previous fully closed clock hour, never a rolling window.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCompletedHourStart((previous) => {
        const next = getLastCompletedHourStart();
        return previous === next ? previous : next;
      });
    }, 15 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      getCompletedHourCVD('BTCUSDT', 'futures', completedHourStart),
      getCompletedHourCVD('BTCUSDT', 'spot', completedHourStart),
    ]).then(([futuresResult, spotResult]) => {
      if (!isCancelled) {
        setCompletedHourCvdMap({
          FUTURES: (futuresResult?.points?.length > 0) ? futuresResult : null,
          SPOT: (spotResult?.points?.length > 0) ? spotResult : null,
        });
      }
    });
    return () => { isCancelled = true; };
  }, [completedHourStart]);

  const futuresSeries = useMarketCvdSeries({
    tf: cvdTf,
    completedHourStart,
    completedHourCvd: completedHourCvdMap.FUTURES,
    stream: futuresStream,
    fallbackSessionCvd: sessionCvd,
    fallbackBuyVolume: buyVolume,
    fallbackSellVolume: sellVolume,
    hist24: cvdHistory24h,
    hist7: cvdHistory7d,
    hist30: cvdHistory30d,
    livePrice,
  });

  const spotSeries = useMarketCvdSeries({
    tf: cvdTf,
    completedHourStart,
    completedHourCvd: completedHourCvdMap.SPOT,
    stream: spotStream,
    fallbackSessionCvd: sessionCvd,
    fallbackBuyVolume: buyVolume,
    fallbackSellVolume: sellVolume,
    hist24: cvdHistory24hSpot,
    hist7: cvdHistory7dSpot,
    hist30: cvdHistory30dSpot,
    livePrice,
  });

  const [tfNodeMap, setTfNodeMap] = useState(null);

  useEffect(() => {
    let isCancelled = false;
    const fetchTfNodes = async () => {
      const [futuresResult, spotResult] = await Promise.all([
        getFootprintNodesForTimeframe('BTCUSDT', 'futures', cvdTf),
        getFootprintNodesForTimeframe('BTCUSDT', 'spot', cvdTf),
      ]);
      if (!isCancelled) {
        setTfNodeMap({ FUTURES: futuresResult, SPOT: spotResult });
      }
    };
    fetchTfNodes();
    return () => { isCancelled = true; };
  }, [cvdTf]);

  const futuresVolNodes = (tfNodeMap?.FUTURES?.nodes?.length > 0)
    ? tfNodeMap.FUTURES.nodes
    : (futuresStream?.volNodes ?? volNodes);
  const spotVolNodes = (tfNodeMap?.SPOT?.nodes?.length > 0)
    ? tfNodeMap.SPOT.nodes
    : (spotStream?.volNodes ?? volNodes);

  const clusteredFuturesNodes = useMemo(() => clusterVolNodes(futuresVolNodes, nodeGap), [futuresVolNodes, nodeGap]);
  const clusteredSpotNodes = useMemo(() => clusterVolNodes(spotVolNodes, nodeGap), [spotVolNodes, nodeGap]);

  const futuresList = futuresSeries.chartList;
  const spotList = spotSeries.chartList;

  const latestCvdF = futuresSeries.netDelta;
  const latestCvdS = spotSeries.netDelta;

  const futuresMetrics = useMemo(() => computeFlowMetrics({
    points: futuresList,
    buyVolume: futuresSeries.displayVol.buy,
    sellVolume: futuresSeries.displayVol.sell,
    netDelta: latestCvdF,
  }), [futuresList, futuresSeries.displayVol.buy, futuresSeries.displayVol.sell, latestCvdF]);
  const spotMetrics = useMemo(() => computeFlowMetrics({
    points: spotList,
    buyVolume: spotSeries.displayVol.buy,
    sellVolume: spotSeries.displayVol.sell,
    netDelta: latestCvdS,
  }), [spotList, spotSeries.displayVol.buy, spotSeries.displayVol.sell, latestCvdS]);
  const flowVerdict = useMemo(() => classifySpotFutures(spotMetrics, futuresMetrics), [spotMetrics, futuresMetrics]);

  const futuresPriceChangePct = useMemo(() => {
    const first = Number(futuresList.find((point) => Number(point?.price) > 0)?.price);
    const last = Number([...futuresList].reverse().find((point) => Number(point?.price) > 0)?.price);
    return first > 0 && last > 0 ? ((last - first) / first) * 100 : null;
  }, [futuresList]);
  const oiChangePct = useMemo(() => {
    if (!Array.isArray(oiHistory) || oiHistory.length < 2) return null;
    const first = Number(oiHistory[0]?.sumOpenInterest);
    const last = Number(oiHistory.at(-1)?.sumOpenInterest);
    return first > 0 && last > 0 ? ((last - first) / first) * 100 : null;
  }, [oiHistory]);
  const futuresPositioning = useMemo(() => classifyFuturesPositioning({
    priceChangePct: futuresPriceChangePct,
    oiChangePct,
    flowDirection: futuresMetrics.direction,
    fundingRate,
  }), [futuresPriceChangePct, oiChangePct, futuresMetrics.direction, fundingRate]);

  // ── Crosshair sync từ AdvancedChart ──
  const [syncIdx, setSyncIdx] = useState(null);
  const syncSourceRef = useRef(futuresList.length > 0 ? futuresList : spotList);
  syncSourceRef.current = futuresList.length > 0 ? futuresList : spotList;

  useEffect(() => {
    return subscribeCrosshair((payload) => {
      if (!payload || !payload.timeMs) {
        setSyncIdx(null);
        return;
      }
      const src = syncSourceRef.current;
      if (!src || src.length === 0) {
        setSyncIdx(null);
        return;
      }
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < src.length; i++) {
        const t = src[i].time;
        if (t == null) continue;
        const d = Math.abs(t - payload.timeMs);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      // Bỏ qua nếu lệch quá xa (>3h) — crosshair không tương ứng dữ liệu hiện tại
      setSyncIdx(best != null && bestDist <= 3 * 3600 * 1000 ? best : null);
    });
  }, []);

  // Fixed 1H data comes from the prior completed hourly bucket.
  const chartOpts = useMemo(() => {
    const base = getChartOptsBase(theme);
    const isLight = theme === 'light';
    return {
      ...base,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...base.plugins,
        cvdSync: { index: syncIdx },
        cvdZeroLine: { isLight },
        tooltip: {
          ...base.plugins.tooltip,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => {
              const source = ctx.dataset?.label === 'FUTURES' ? futuresList : spotList;
              const item = source?.[ctx.dataIndex];
              const btcStr = item?.price ? ` · BTC: $${Number(item.price).toLocaleString()}` : '';
              const deltaStr = item?.delta != null ? ` (Delta: ${fmtCvdUsd(item.delta)})` : '';
              const statusStr = item?.isClosed === false ? ' [Live]' : ' [Closed]';
              return ` ${ctx.dataset?.label || ''}: ${fmtCvdUsd(ctx.parsed?.y ?? 0)}${deltaStr}${statusStr}${btcStr}`;
            }
          }
        }
      },
      scales: {
        ...base.scales,
        y: {
          ...base.scales.y,
          display: true,
          beginAtZero: true,
          grid: {
            ...base.scales.y.grid,
            color: (context) => {
              if (context.tick && context.tick.value === 0) {
                return isLight ? 'rgba(30, 41, 59, 0.65)' : 'rgba(241, 245, 249, 0.45)';
              }
              return isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
            },
            lineWidth: (context) => {
              if (context.tick && context.tick.value === 0) {
                return 1.5;
              }
              return 1;
            }
          },
          ticks: {
            ...base.scales.y.ticks,
            color: (context) => {
              if (context.tick && context.tick.value === 0) {
                return isLight ? '#0f172a' : '#f8fafc';
              }
              return '#a78bfa';
            },
            font: (context) => {
              if (context.tick && context.tick.value === 0) {
                return { family: 'Be Vietnam Pro, Roboto Mono', size: 10, weight: '700' };
              }
              return { family: 'Be Vietnam Pro, Roboto Mono', size: 10 };
            },
            callback: (val) => fmtCvdUsd(val)
          },
          title: {
            display: true,
            text: 'CVD RÒNG FUTURES',
            color: '#a78bfa',
            font: { family: 'Be Vietnam Pro, Roboto Mono', size: 9, weight: '600' }
          }
        },
        y1: {
          ...base.scales.y,
          position: 'right',
          display: true,
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            ...base.scales.y.ticks,
            color: (context) => context.tick?.value === 0
              ? (isLight ? '#0f172a' : '#f8fafc')
              : '#34d399',
            font: (context) => context.tick?.value === 0
              ? { family: 'Be Vietnam Pro, Roboto Mono', size: 10, weight: '700' }
              : { family: 'Be Vietnam Pro, Roboto Mono', size: 10 },
            callback: (val) => fmtCvdUsd(val)
          },
          title: {
            display: true,
            text: 'CVD RÒNG SPOT',
            color: '#34d399',
            font: { family: 'Be Vietnam Pro, Roboto Mono', size: 9, weight: '600' }
          }
        }
      }
    };
  }, [theme, futuresList, spotList, syncIdx]);

  const chartData = useMemo(() => {
    const labelSource = futuresList.length > 0 ? futuresList : spotList;
    const labels = labelSource.map(item => {
      if (item.time == null) return '';
      const d = new Date(item.time);
      if (isNaN(d.getTime())) return String(item.time);

      if (cvdTf === '1H') {
        const hrs = d.getHours();
        const mins = d.getMinutes();
        return `${hrs}h${mins > 0 ? String(mins).padStart(2, '0') : ''}`;
      }
      if (cvdTf === '24H') {
        return `${String(d.getHours()).padStart(2, '0')}:00`;
      }
      if (cvdTf === '7D') {
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      }
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const isLight = theme === 'light';
    const mkDataset = (label, list, borderColor, backgroundColor, yAxisID) => ({
      label,
      data: list.map(item => cvdTf === '1H'
        ? (item.cvd ?? 0)
        : (item.cumulativeWithinWindow ?? 0)),
      borderColor,
      backgroundColor,
      yAxisID,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: true,
      tension: 0.25,
    });

    return {
      labels,
      datasets: [
        {
          ...mkDataset('FUTURES', futuresList, '#a78bfa', isLight ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.12)', 'y'),
          fill: false,
        },
        {
          ...mkDataset('SPOT', spotList, '#34d399', isLight ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.12)', 'y1'),
          fill: false,
        },
      ].filter(ds => ds.data.length > 0)
    };
  }, [futuresList, spotList, cvdTf, theme]);

  const rangeLabel = cvdTf === '1H'
    ? formatHourRange(completedHourStart)
    : cvdTf === '24H' ? '24 GIỜ QUA' : cvdTf === '7D' ? '7 NGÀY QUA' : '30 NGÀY QUA';

  const gaugeMarkets = [
    { key: 'FUTURES', accent: '#a78bfa', venueLabel: 'Futures (Phái sinh)', series: futuresSeries },
    { key: 'SPOT', accent: '#34d399', venueLabel: 'Spot (Cơ sở)', series: spotSeries },
  ];

  const flowCards = [
    { key: 'SPOT', accent: '#34d399', series: spotSeries, metrics: spotMetrics, netDelta: latestCvdS },
    { key: 'FUTURES', accent: '#a78bfa', series: futuresSeries, metrics: futuresMetrics, netDelta: latestCvdF },
  ];

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Tooltip content={METRIC_METADATA.cvd}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, margin: 0 }}>
              <span className="hft-icon">📊</span> CVD &amp; ORDER FLOW
            </h3>
          </Tooltip>
          <div className="hft-panel-badges" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span
              className="hft-badge badge-api font-mono"
              style={{
                cursor: 'help',
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                color: '#a78bfa',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                fontWeight: 600
              }}
              title="Binance Futures aggTrade — Thị trường Phái sinh (Benchmark Proxy)"
            >
              BIN-F PROXY
            </span>
            <span
              className="hft-badge badge-api font-mono"
              style={{
                cursor: 'help',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontWeight: 600
              }}
              title="Binance Spot aggTrade — Thị trường Cơ sở (Spot Direct)"
            >
              BIN-S PROXY
            </span>
            <span
              className="hft-badge badge-api font-mono"
              style={{
                cursor: 'help',
                backgroundColor: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontWeight: 600
              }}
              title="Neo mốc cố định UTC Anchor (2020-01-01) · Snapshot ngày đóng bất biến v1 · Net Delta độc lập"
            >
              UTC ANCHOR 2020
            </span>
            <span className={`hft-badge font-mono ${cvdStatus === 'connected' ? 'badge-live' : 'badge-off'}`}>
              {cvdStatus === 'connected' ? '⚡ LIVE' : 'WS OFF'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Timeframe Selector */}
          <div className="etf-timeframe-toggle font-mono">
            {['1H', '24H', '7D', '30D'].map(t => (
              <button
                key={t}
                onClick={() => setCvdTf(t)}
                className={`toggle-btn ${cvdTf === t ? 'active' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>
          <ModuleMenu moduleId="hft_cvd" />
        </div>
      </div>
      <section className={`flow-verdict flow-tone-${flowVerdict?.tone || 'neutral'}`} aria-label="Kết luận dòng lệnh Spot và Futures">
        <div className="flow-verdict-main">
          <span className="flow-kicker font-mono">MARKET FLOW VERDICT · BINANCE BTCUSDT</span>
          <strong>{flowVerdict?.title || 'Dòng lệnh cân bằng'}</strong>
          <span>{flowVerdict?.detail || 'Chưa có bên nào kiểm soát rõ ràng.'}</span>
        </div>
        <div className="flow-verdict-confidence font-mono">
          <span>CONFIDENCE</span>
          <strong>{flowVerdict?.confidence ?? 50}%</strong>
        </div>
      </section>

      <div className="flow-pressure-grid">
        {flowCards.map(({ key, accent, series, metrics, netDelta }) => (
          <article className={`flow-pressure-card is-${metrics?.direction || 'neutral'}`} key={key} style={{ '--flow-accent': accent }}>
            <div className="flow-pressure-head font-mono">
              <span>{key} AGGRESSIVE FLOW</span>
              <span className={`flow-direction is-${metrics?.direction || 'neutral'}`}>{(metrics?.direction || 'neutral').toUpperCase()}</span>
            </div>
            <div className="flow-pressure-score font-mono">
              <strong>{metrics?.strengthScore ?? '—'}</strong><span>/100</span>
              <small>{fmtCvdUsd(netDelta)}</small>
            </div>
            <dl className="flow-pressure-metrics font-mono">
              <div><dt>DELTA / VOL</dt><dd>{fmtSignedPct(metrics?.deltaRatioPct)}</dd></div>
              <div><dt>Z-SCORE</dt><dd>{metrics?.zScore == null ? 'đang tích lũy' : `${metrics.zScore > 0 ? '+' : ''}${metrics.zScore.toFixed(2)}σ`}</dd></div>
              <div><dt>MOMENTUM</dt><dd>{(metrics?.momentum || 'stable').toUpperCase()}</dd></div>
            </dl>
            <div className="flow-data-health font-mono">
              <span className={series?.isComplete ? 'is-complete' : 'is-incomplete'}>{(Number(series?.coverage) || 0).toFixed(0)}% COVERAGE</span>
              <span>{fmtAge(series?.asOf)}</span>
            </div>
          </article>
        ))}
      </div>

      <section className={`futures-positioning flow-tone-${futuresPositioning?.tone || 'neutral'}`}>
        <div>
          <span className="flow-kicker font-mono">FUTURES POSITIONING · OI CONTEXT 24H</span>
          <strong>{futuresPositioning?.label || 'Chưa đủ dữ liệu định vị'}</strong>
          <p>{futuresPositioning?.detail || 'Cần Price, CVD và lịch sử OI đồng thời.'}</p>
        </div>
        <dl className="futures-positioning-stats font-mono">
          <div><dt>PRICE</dt><dd>{fmtSignedPct(futuresPriceChangePct)}</dd></div>
          <div><dt>ΔOI</dt><dd>{fmtSignedPct(oiChangePct)}</dd></div>
          <div><dt>OI</dt><dd>{openInterest ? `${(Number(openInterest) / 1000).toFixed(1)}K BTC` : '---'}</dd></div>
          <div><dt>FUNDING</dt><dd>{Number.isFinite(Number(fundingRate)) ? `${(Number(fundingRate) * 100).toFixed(4)}%` : '---'}</dd></div>
        </dl>
      </section>

      <div className="cvd-hero" style={{ paddingBottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
        <div className="cvd-value-wrap">
          <span className="cvd-label font-mono" title="CVD ròng Futures từ Binance">
            {`CVD RÒNG FUTURES (${rangeLabel})`}
          </span>
          <span className={`cvd-value font-mono ${(latestCvdF ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {fmtCvdUsd(latestCvdF)}
          </span>
        </div>
        <div className="cvd-value-wrap">
          <span className="cvd-label font-mono" title="CVD ròng Spot từ Binance">
            {`CVD RÒNG SPOT (${rangeLabel})`}
          </span>
          <span className={`cvd-value font-mono ${(latestCvdS ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {fmtCvdUsd(latestCvdS)}
          </span>
        </div>
      </div>

      {/* CVD Line Chart (FUTURES vs SPOT) */}
      <div className="cvd-chart-container" style={{ height: '180px', width: '100%', marginBottom: '16px', position: 'relative' }}>
        {(futuresList.length > 1 || spotList.length > 1) ? (
          <Line data={chartData} options={chartOpts} plugins={[cvdSyncPlugin, cvdZeroLinePlugin]} />
        ) : (
          <div className="hft-empty font-mono" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-slate-400)', fontSize: '0.75rem' }}>
            {cvdTf === '1H' ? 'Đang tải dữ liệu CVD của giờ đã chốt...' : 'Đang tải dữ liệu biểu đồ CVD...'}
          </div>
        )}

        {/* Chip hiển thị CVD 2 thị trường tại điểm crosshair của AdvancedChart */}
        {syncIdx != null && syncSourceRef.current?.[syncIdx] ? (() => {
          const item = syncSourceRef.current[syncIdx];
          const d = item?.time != null ? new Date(item.time) : null;
          const timeLabel = d && !isNaN(d.getTime())
            ? (cvdTf === '24H'
              ? `${String(d.getHours()).padStart(2, '0')}:00`
              : cvdTf === '1H'
                ? `${d.getHours()}h${d.getMinutes() > 0 ? String(d.getMinutes()).padStart(2, '0') : ''}`
                : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`)
            : '';
          return (
            <div className="font-mono" style={{
              position: 'absolute', top: 4, right: 8, zIndex: 10,
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: 'rgba(10, 12, 18, 0.9)', border: '1px solid rgba(253, 224, 71, 0.5)',
              borderRadius: '6px', padding: '3px 8px', fontSize: '0.58rem',
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              <span style={{ color: '#facc15' }}>⌖ {timeLabel}</span>
              <span style={{ color: '#a78bfa' }}>F {fmtCvdUsd(futuresList[syncIdx]?.cvd)}</span>
              <span style={{ color: '#34d399' }}>S {fmtCvdUsd(spotList[syncIdx]?.cvd)}</span>
            </div>
          );
        })() : null}
      </div>

      {/* Volume Gauges (song song 2 thị trường để đối chiếu) */}
      {gaugeMarkets.map(({ key, accent, venueLabel, series }) => {
        const buy = Number(series?.displayVol?.buy) || 0;
        const sell = Number(series?.displayVol?.sell) || 0;
        const totalVol = buy + sell;
        const bpct = totalVol > 0 ? (buy / totalVol * 100) : 50;
        const spct = 100 - bpct;
        return (
          <div className="vol-gauge-container" key={key} style={{ marginBottom: '10px' }} title={`Tỷ lệ Buy/Sell Volume trong khung ${cvdTf} từ BINANCE ${venueLabel}`}>
            <div className="vol-gauge-labels font-mono">
              <span className="text-emerald" title="Tỷ lệ Volume Mua Chủ Động (Market Buy)">BUY {bpct.toFixed(1)}%</span>
              <span className="font-mono" style={{ cursor: 'help', color: accent, fontWeight: 600 }} title={`Volume Ratio đo tỷ lệ Mua/Bán trong khung ${cvdTf} của BINANCE ${key}`}>VOLUME RATIO ({key} - {cvdTf})</span>
              <span className="text-rose" title="Tỷ lệ Volume Bán Chủ Động (Market Sell)">SELL {spct.toFixed(1)}%</span>
            </div>
            <div className="vol-gauge-bar">
              <div className="vol-gauge-buy" style={{ width: `${bpct}%` }} />
              <div className="vol-gauge-sell" style={{ width: `${spct}%` }} />
            </div>
            <div className="vol-gauge-values font-mono">
              <span>{fmtUsd(buy)}</span>
              <span>{fmtUsd(sell)}</span>
            </div>
          </div>
        );
      })}

      {/* Node Gap Config */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.55rem', fontWeight: 600, cursor: 'help' }} title="Khoảng giá gộp footprint ước lượng từ Binance klines, mặc định $100.">EST. VOLUME-BY-PRICE GAP ({cvdTf})</span>
          <span className="font-mono text-emerald" style={{ fontSize: '0.62rem', fontWeight: 700 }}>${nodeGap}</span>
        </div>
        <input
          type="range"
          min="0"
          max="5"
          value={[10, 50, 100, 250, 500, 1000].indexOf(nodeGap) >= 0 ? [10, 50, 100, 250, 500, 1000].indexOf(nodeGap) : 2}
          onChange={(e) => {
            const val = [10, 50, 100, 250, 500, 1000][Number(e.target.value)];
            setNodeGap(val);
            localStorage.setItem('hft_cvd_gap', String(val));
          }}
          style={{ width: '100%', accentColor: 'var(--color-emerald-500)', cursor: 'pointer', height: '4px', background: 'var(--bg-slate-800)', borderRadius: '2px', outline: 'none', border: 'none', margin: '4px 0' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.45rem', color: 'var(--text-slate-500)' }} className="font-mono">
          <span>10</span><span>50</span><span>100</span><span>250</span><span>500</span><span>1000</span>
        </div>
      </div>

      {/* Nodes Tables — song song FUTURES & SPOT để so sánh dòng tiền hai thị trường */}
      <FootprintSection marketLabel="FUTURES" accentColor="#a78bfa" nodes={clusteredFuturesNodes} nodeGap={nodeGap} cvdTf={cvdTf} coverage={tfNodeMap?.FUTURES?.coverage} raw={false} />
      <div style={{ height: '12px' }} />
      <FootprintSection marketLabel="SPOT" accentColor="#34d399" nodes={clusteredSpotNodes} nodeGap={nodeGap} cvdTf={cvdTf} coverage={tfNodeMap?.SPOT?.coverage} raw={false} />

    </div>
  );
}

// ─── PANEL 2: Target Liquidity (Whale Walls) ──────────────────────────────────

const clusterOrders = (orders, gap) => {
  if (!orders || !orders.length) return [];
  if (!gap || gap <= 1) {
    return orders.map(o => ({
      ...o,
      minPrice: o.price,
      maxPrice: o.price,
      subLevels: [{ price: o.price, usdValue: o.usdValue, qty: o.qty }]
    }));
  }

  const map = new Map();
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const binPrice = Math.floor(o.price / gap) * gap;
    let entry = map.get(binPrice);
    if (!entry) {
      entry = {
        price: binPrice,
        priceHigh: binPrice + gap - 1,
        minPrice: o.price,
        maxPrice: o.price,
        weightedPriceSum: 0,
        qty: 0,
        usdValue: 0,
        side: o.side,
        count: 0,
        sources: {},
        subLevels: []
      };
      map.set(binPrice, entry);
    }
    if (o.price < entry.minPrice) entry.minPrice = o.price;
    if (o.price > entry.maxPrice) entry.maxPrice = o.price;
    entry.subLevels.push({ price: o.price, usdValue: o.usdValue, qty: o.qty });

    entry.qty += o.qty;
    entry.usdValue += o.usdValue;
    entry.weightedPriceSum += o.price * o.usdValue;
    entry.count += (o.count || 1);
    if (o.sources) {
      const keys = Object.keys(o.sources);
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        entry.sources[k] = (entry.sources[k] || 0) + o.sources[k];
      }
    }
  }
  const result = Array.from(map.values());
  for (let i = 0; i < result.length; i++) {
    const e = result[i];
    if (e.usdValue > 0) {
      e.avgPrice = Math.round(e.weightedPriceSum / e.usdValue);
    } else {
      e.avgPrice = e.price;
    }
  }
  return result.sort((a, b) => b.usdValue - a.usdValue);
};

// Linear gap slider removed non-linear mapping functions

function TargetLiquidityPanel({
  clusteredBids, clusteredAsks, bidWallTotal, askWallTotal, bidRatio, signal, signalCls, gap, setGap, isNested
}) {
  const [expandedRows, setExpandedRows] = useState({});

  const toggleRow = (key) => {
    setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const containerStyle = isNested ? { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' } : undefined;
  const containerClass = isNested ? "" : "hft-panel glass-panel";

  const handleGapChange = (e) => {
    const val = Number(e.target.value);
    setGap(val);
    localStorage.setItem('hft_whale_gap', String(val));
  };

  const sortedAsks = useMemo(() => clusteredAsks.slice(0, 10), [clusteredAsks]);
  const sortedBids = useMemo(() => clusteredBids.slice(0, 10), [clusteredBids]);

  const maxUsdVol = useMemo(() => {
    let max = 0;
    sortedAsks.forEach(w => max = Math.max(max, w.usdValue));
    sortedBids.forEach(w => max = Math.max(max, w.usdValue));
    return max || 1;
  }, [sortedAsks, sortedBids]);

  const getAskColor = (val) => `rgba(244, 63, 94, ${0.35 + 0.65 * (val / maxUsdVol)})`;
  const getBidColor = (val) => `rgba(16, 185, 129, ${0.35 + 0.65 * (val / maxUsdVol)})`;

  if (!clusteredBids.length && !clusteredAsks.length && !bidRatio) {
    return (
      <div className={containerClass} style={containerStyle}>
        <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip content={METRIC_METADATA.whaleWalls}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
              <span className="hft-icon">🎯</span> TARGET LIQUIDITY (WHALE WALLS)
            </h3>
          </Tooltip>
          <ModuleMenu moduleId="hft_whale_walls" />
        </div>
        <div className="hft-empty font-mono">Nhấn SYNC để quét các vùng thanh khoản...</div>
      </div>
    );
  }

  return (
    <div className={containerClass} style={containerStyle}>
      <div className="hft-panel-header">
        <Tooltip content={METRIC_METADATA.whaleWalls}>
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
            <span className="hft-icon">🎯</span> TARGET LIQUIDITY (≥$500K)
          </h3>
        </Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`hft-signal font-mono ${signalCls}`}>{signal}</span>
          <ModuleMenu moduleId="hft_whale_walls" />
        </div>
      </div>

      {/* Gap Cluster Control */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.55rem', fontWeight: 600 }}>GOM CỤM LỆNH LIMIT (CLUSTER GAP)</span>
          <span className="font-mono text-emerald" style={{ fontSize: '0.62rem', fontWeight: 700 }}>${gap} USD</span>
        </div>
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={gap}
          onChange={handleGapChange}
          style={{
            width: '100%',
            accentColor: 'var(--color-emerald-500)',
            cursor: 'pointer',
            height: '4px',
            background: 'var(--bg-slate-800)',
            borderRadius: '2px',
            outline: 'none',
            border: 'none',
            margin: '4px 0'
          }}
        />
        <div style={{ position: 'relative', height: '14px', fontSize: '0.45rem', color: 'var(--text-slate-500)', cursor: 'pointer', marginTop: '4px' }} className="font-mono">
          {[10, 250, 500, 750, 1000].map((g, idx, arr) => {
            const pct = ((g - 10) / 990) * 100;
            let transform = 'translateX(-50%)';
            if (idx === 0) transform = 'translateX(0)';
            if (idx === arr.length - 1) transform = 'translateX(-100%)';
            return (
              <span
                key={g}
                onClick={() => { setGap(g); localStorage.setItem('hft_whale_gap', String(g)); }}
                style={{ 
                  position: 'absolute', 
                  left: `${pct}%`, 
                  transform,
                  color: gap === g ? 'var(--color-emerald-400)' : 'inherit', 
                  fontWeight: gap === g ? 700 : 400 
                }}
              >
                ${g}
              </span>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="whale-summary">
        <div className="whale-sum-card whale-bid-card">
          <span className="whale-sum-label font-mono">SUPPORT WALLS ({clusteredBids.length} cụm)</span>
          <span className="whale-sum-value font-mono text-emerald">{fmtUsd(bidWallTotal)}</span>
        </div>
        <div className="whale-sum-card whale-ask-card">
          <span className="whale-sum-label font-mono">RESISTANCE WALLS ({clusteredAsks.length} cụm)</span>
          <span className="whale-sum-value font-mono text-rose">{fmtUsd(askWallTotal)}</span>
        </div>
        <div className="whale-sum-card whale-ratio-card">
          <span className="whale-sum-label font-mono">BID RATIO</span>
          <span className={`whale-sum-value font-mono ${bidRatio > 0.6 ? 'text-emerald' : bidRatio < 0.4 ? 'text-rose' : 'text-slate-400'}`}>
            {(bidRatio * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Table */}
      {(sortedAsks.length > 0 || sortedBids.length > 0) && (
        <div className="whale-table-wrap">
          <table className="liq-table font-mono">
            <thead>
              <tr>
                <th>Loại</th>
                <th>Vùng Giá</th>
                <th>BTC</th>
                <th>USD Value</th>
              </tr>
            </thead>
            <tbody>
              {/* Resistance first */}
              {sortedAsks.map((w, i) => {
                const rowKey = `ask-${i}`;
                const isExpanded = expandedRows[rowKey];
                return (
                  <React.Fragment key={rowKey}>
                    <tr className="whale-row-ask" onClick={w.count > 1 ? () => toggleRow(rowKey) : undefined} style={{ cursor: w.count > 1 ? 'pointer' : 'default' }}>
                      <td>
                        <span className="liq-side-tag liq-tag-long">
                          RESISTANCE
                        </span>
                      </td>
                      <td>
                        {w.minPrice && w.maxPrice && w.minPrice !== w.maxPrice && w.count > 1 ? `${fmtPrice(w.minPrice)} ~ ${fmtPrice(w.maxPrice)}` : (w.count > 1 ? `${fmtPrice(w.price)} ~ ${fmtPrice(w.priceHigh)}` : fmtPrice(w.avgPrice || w.price))}
                        {w.count > 1 && (
                          <span
                            style={{
                              fontSize: '0.5rem',
                              color: '#f59e0b',
                              marginLeft: '5px',
                              background: 'rgba(245, 158, 11, 0.15)',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              display: 'inline-block'
                            }}
                            title={`Gộp từ ${w.count} lệnh limit. Bấm để xem chi tiết`}
                          >
                            ⚡{w.count} {isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      <td style={{ color: getAskColor(w.usdValue), fontWeight: 600 }}>{w.qty.toFixed(3)}</td>
                      <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''} style={{ color: getAskColor(w.usdValue) }}>
                        <div style={{ fontWeight: w.usdValue >= 1e6 ? 'bold' : 'normal' }}>{fmtUsd(w.usdValue)}</div>
                        {w.sources && (
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '3px' }}>
                            {Object.keys(w.sources).map(src => {
                              const shortName = src.replace(' Futures', '-F').replace(' Spot', '-S').replace('Binance', 'BIN').replace('Bybit', 'BYB').replace('OKX', 'OKX').replace('Bitget', 'BGT');
                              return (
                                <span
                                  key={src}
                                  title={`${src}: ${fmtUsd(w.sources[src])}`}
                                  style={{
                                    fontSize: '0.45rem',
                                    color: 'var(--text-slate-400)',
                                    border: '1px solid var(--border-panel)',
                                    borderRadius: '2px',
                                    padding: '1px 3px',
                                    background: 'rgba(15, 23, 42, 0.4)',
                                    fontWeight: 'normal'
                                  }}
                                >
                                  {shortName}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && w.subLevels && w.subLevels.map((sub, j) => (
                      <tr key={`${rowKey}-sub-${j}`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ paddingLeft: '24px', color: 'var(--text-slate-500)', fontSize: '0.65rem' }}>↳ Lệnh đơn</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{fmtPrice(sub.price)}</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{sub.qty.toFixed(3)}</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{fmtUsd(sub.usdValue)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {/* Support second */}
              {sortedBids.map((w, i) => {
                const rowKey = `bid-${i}`;
                const isExpanded = expandedRows[rowKey];
                return (
                  <React.Fragment key={rowKey}>
                    <tr className="whale-row-bid" onClick={w.count > 1 ? () => toggleRow(rowKey) : undefined} style={{ cursor: w.count > 1 ? 'pointer' : 'default' }}>
                      <td>
                        <span className="liq-side-tag liq-tag-short">
                          SUPPORT
                        </span>
                      </td>
                      <td>
                        {w.minPrice && w.maxPrice && w.minPrice !== w.maxPrice && w.count > 1 ? `${fmtPrice(w.minPrice)} ~ ${fmtPrice(w.maxPrice)}` : (w.count > 1 ? `${fmtPrice(w.price)} ~ ${fmtPrice(w.priceHigh)}` : fmtPrice(w.avgPrice || w.price))}
                        {w.count > 1 && (
                          <span
                            style={{
                              fontSize: '0.5rem',
                              color: '#f59e0b',
                              marginLeft: '5px',
                              background: 'rgba(245, 158, 11, 0.15)',
                              padding: '2px 5px',
                              borderRadius: '3px',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              display: 'inline-block'
                            }}
                            title={`Gộp từ ${w.count} lệnh limit. Bấm để xem chi tiết`}
                          >
                            ⚡{w.count} {isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      <td style={{ color: getBidColor(w.usdValue), fontWeight: 600 }}>{w.qty.toFixed(3)}</td>
                      <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''} style={{ color: getBidColor(w.usdValue) }}>
                        <div style={{ fontWeight: w.usdValue >= 1e6 ? 'bold' : 'normal' }}>{fmtUsd(w.usdValue)}</div>
                        {w.sources && (
                          <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '3px' }}>
                            {Object.keys(w.sources).map(src => {
                              const shortName = src.replace(' Futures', '-F').replace(' Spot', '-S').replace('Binance', 'BIN').replace('Bybit', 'BYB').replace('OKX', 'OKX').replace('Bitget', 'BGT');
                              return (
                                <span
                                  key={src}
                                  title={`${src}: ${fmtUsd(w.sources[src])}`}
                                  style={{
                                    fontSize: '0.45rem',
                                    color: 'var(--text-slate-400)',
                                    border: '1px solid var(--border-panel)',
                                    borderRadius: '2px',
                                    padding: '1px 3px',
                                    background: 'rgba(15, 23, 42, 0.4)',
                                    fontWeight: 'normal'
                                  }}
                                >
                                  {shortName}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && w.subLevels && w.subLevels.map((sub, j) => (
                      <tr key={`${rowKey}-sub-${j}`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ paddingLeft: '24px', color: 'var(--text-slate-500)', fontSize: '0.65rem' }}>↳ Lệnh đơn</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{fmtPrice(sub.price)}</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{sub.qty.toFixed(3)}</td>
                        <td style={{ color: 'var(--text-slate-300)', fontSize: '0.65rem' }}>{fmtUsd(sub.usdValue)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PANEL 3: Order Book Depth ────────────────────────────────────────────────

function OrderBookPanel({ orderBook, depthLimit, setDepthLimit }) {
  const steps = [5, 10, 20, 50, 100, 500, 1000];

  const renderDepthSlider = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.55rem', fontWeight: 600 }}>SỔ LỆNH DEPTH (OBI LEVEL)</span>
          {orderBook?.minBid > 0 && orderBook?.maxAsk > 0 && (
            <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem', marginTop: '2px' }}>
              Vùng giá: {orderBook.minBid.toLocaleString()} ~ {orderBook.maxAsk.toLocaleString()}
            </span>
          )}
        </div>
        <span className="font-mono text-emerald" style={{ fontSize: '0.62rem', fontWeight: 700 }}>{depthLimit} Levels</span>
      </div>
      <input
        type="range"
        min="0"
        max="6"
        value={steps.indexOf(depthLimit)}
        onChange={(e) => setDepthLimit(steps[Number(e.target.value)])}
        style={{
          width: '100%',
          accentColor: 'var(--color-emerald-500)',
          cursor: 'pointer',
          height: '4px',
          background: 'var(--bg-slate-800)',
          borderRadius: '2px',
          outline: 'none',
          border: 'none',
          margin: '4px 0'
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.45rem', color: 'var(--text-slate-500)' }} className="font-mono">
        <span>5</span>
        <span>10</span>
        <span>20</span>
        <span>50</span>
        <span>100</span>
        <span>500</span>
        <span>1000</span>
      </div>
    </div>
  );

  if (!orderBook) {
    return (
      <div className="hft-panel glass-panel">
        <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip content={METRIC_METADATA.obi}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
              <span className="hft-icon">📖</span> ORDER BOOK IMBALANCE
            </h3>
          </Tooltip>
          <ModuleMenu moduleId="hft_orderbook" />
        </div>
        {renderDepthSlider()}
        <div className="hft-empty font-mono">Nhấn SYNC để tải Order Book...</div>
      </div>
    );
  }

  const { obiPercent, spread, bidVolBtc, askVolBtc, bidVolUsd, askVolUsd, signal, signalCls, bestBid, bestAsk } = orderBook;
  const bidWidth = bidVolBtc / (bidVolBtc + askVolBtc) * 100;
  const askWidth = 100 - bidWidth;

  return (
    <div className="hft-panel glass-panel">
      <div className="hft-panel-header">
        <Tooltip content={METRIC_METADATA.obi}>
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
            <span className="hft-icon">📖</span> ORDER BOOK IMBALANCE
          </h3>
        </Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`hft-signal font-mono ${signalCls}`}>{signal}</span>
          <ModuleMenu moduleId="hft_orderbook" />
        </div>
      </div>

      {renderDepthSlider()}

      {/* OBI Gauge */}
      <div className="obi-section" style={{ paddingTop: 0 }}>
        <div className="obi-label font-mono">ORDER BOOK IMBALANCE (OBI - {depthLimit} levels)</div>
        <div className="obi-gauge">
          <span className="obi-end font-mono text-rose">-100</span>
          <div className="obi-track">
            <div
              className="obi-thumb"
              style={{ left: `${(obiPercent + 100) / 2}%` }}
            />
            <div className="obi-center" />
          </div>
          <span className="obi-end font-mono text-emerald">+100</span>
        </div>
        <div className="obi-value font-mono" style={{ color: obiPercent > 0 ? '#10b981' : obiPercent < 0 ? '#f43f5e' : '#94a3b8' }}>
          {obiPercent > 0 ? '+' : ''}{obiPercent}%
        </div>
        {orderBook.exchanges && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
            {orderBook.exchanges.map(ex => {
              const color = ex.obi > 15 ? 'var(--color-emerald-400)' : ex.obi < -15 ? 'var(--color-rose-400)' : 'var(--text-slate-400)';
              return (
                <div key={ex.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '55px', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '3px 4px', background: 'rgba(15, 23, 42, 0.3)' }} title={`Order Book Imbalance tại sàn ${ex.name}`}>
                  <span style={{ fontSize: '0.48rem', color: 'var(--text-slate-500)', fontWeight: 600 }}>{ex.name}</span>
                  <span style={{ fontSize: '0.55rem', color: color, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {ex.obi > 0 ? '+' : ''}{ex.obi}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Depth bars */}
      <div className="depth-visual">
        <div className="depth-bar-container">
          <div className="depth-bar depth-bid" style={{ width: `${bidWidth}%` }}>
            <span className="font-mono">{bidVolBtc} BTC</span>
          </div>
          <div className="depth-bar depth-ask" style={{ width: `${askWidth}%` }}>
            <span className="font-mono">{askVolBtc} BTC</span>
          </div>
        </div>
        <div className="depth-usd font-mono">
          <span className="text-emerald">{fmtUsd(bidVolUsd)} BID</span>
          <span className="text-rose">{fmtUsd(askVolUsd)} ASK</span>
        </div>
      </div>

      {/* Spread & prices */}
      <div className="ob-meta font-mono">
        <div className="ob-meta-row">
          <span className="text-slate-400">Best Bid</span>
          <span className="text-emerald">{fmtPrice(bestBid)}</span>
        </div>
        <div className="ob-meta-row">
          <span className="text-slate-400">Best Ask</span>
          <span className="text-rose">{fmtPrice(bestAsk)}</span>
        </div>
        <div className="ob-meta-row">
          <span className="text-slate-400">Spread</span>
          <span>{spread.toFixed(4)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── PANEL 4: Whale Trades ───────────────────────────────────────────────────

function WhaleTradesPanel({ whaleTrades, volume24h }) {
  const [minVolume, setMinVolume] = useState(() => {
    const saved = localStorage.getItem('hft_whale_min_vol');
    return saved ? Number(saved) : 100000;
  });

  const handleVolumeChange = (e) => {
    const val = Number(e.target.value);
    setMinVolume(val);
    localStorage.setItem('hft_whale_min_vol', String(val));
  };

  const filteredTrades = useMemo(() => {
    return (whaleTrades || []).filter(t => t.usdtVol >= minVolume);
  }, [whaleTrades, minVolume]);

  const whaleStats = useMemo(() => {
    let bVol = 0, bUsd = 0, sVol = 0, sUsd = 0;
    let bCount = 0, sCount = 0;
    let bMax = 0, sMax = 0;
    filteredTrades.forEach(t => {
      if (t.side === 'BUY') {
        bVol += t.qty; bUsd += t.usdtVol; bCount++;
        if (t.usdtVol > bMax) bMax = t.usdtVol;
      } else {
        sVol += t.qty; sUsd += t.usdtVol; sCount++;
        if (t.usdtVol > sMax) sMax = t.usdtVol;
      }
    });
    const total = bUsd + sUsd;
    const buyPct = total > 0 ? (bUsd / total) * 100 : 50;
    const sellPct = 100 - buyPct;
    const netFlow = bUsd - sUsd;
    const dominanceRatio = total > 0 ? Math.abs(netFlow) / total : 0;
    let signal = 'BALANCED';
    let signalCls = 'neutral';
    if (dominanceRatio > 0.08) {
      signal = netFlow > 0 ? '▲ BUY PRESSURE' : '▼ SELL PRESSURE';
      signalCls = netFlow > 0 ? 'bullish' : 'bearish';
    }
    return { buyUsd: bUsd, sellUsd: sUsd, bCount, sCount, bMax, sMax, buyPct, sellPct, netFlow, signal, signalCls };
  }, [filteredTrades]);
  const { buyUsd, sellUsd, bCount, sCount, bMax, sMax, buyPct, sellPct, netFlow, signal, signalCls } = whaleStats;

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header">
        <h3 className="hft-panel-title font-mono" style={{ borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">🐋</span> LIVE WHALE TRADES
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            className="font-mono text-slate-300"
            value={minVolume}
            onChange={handleVolumeChange}
            style={{ background: 'var(--bg-slate-900)', border: '1px solid var(--border-panel)', padding: '2px 6px', borderRadius: '4px', outline: 'none', cursor: 'pointer' }}
          >
            <option value={100000}>≥ $100K</option>
            <option value={500000}>≥ $500K</option>
            <option value={1000000}>≥ $1M</option>
            <option value={5000000}>≥ $5M</option>
          </select>
          <ModuleMenu moduleId="hft_liquidations" />
        </div>
      </div>

      {/* ── Whale Pressure Dashboard ────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px', background: 'var(--bg-slate-950)', padding: '12px 14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>

        {/* Row 1: Net Flow + Signal badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="font-mono text-slate-400" style={{ fontSize: '0.6rem', marginBottom: '3px', letterSpacing: '0.08em' }}>NET WHALE FLOW</div>
            <div className="font-mono" style={{
              fontSize: '1.1rem', fontWeight: 700,
              color: netFlow > 0 ? 'var(--color-emerald-400)' : netFlow < 0 ? 'var(--color-rose-400)' : 'var(--text-slate-300)'
            }}>
              {netFlow > 0 ? '+' : ''}{fmtUsd(netFlow)}
            </div>
            {volume24h > 0 && (
              <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem', marginTop: '3px' }}>
                Chiếm {(((buyUsd + sellUsd) / volume24h) * 100).toFixed(2)}% Vol 24H
              </div>
            )}
          </div>
          <div className="font-mono" style={{
            fontSize: '0.65rem', fontWeight: 700,
            padding: '4px 10px', borderRadius: '4px', letterSpacing: '0.06em',
            background: signalCls === 'bullish' ? 'rgba(52,211,153,0.12)' : signalCls === 'bearish' ? 'rgba(251,113,133,0.12)' : 'rgba(100,116,139,0.15)',
            color: signalCls === 'bullish' ? 'var(--color-emerald-400)' : signalCls === 'bearish' ? 'var(--color-rose-400)' : 'var(--text-slate-400)',
            border: `1px solid ${signalCls === 'bullish' ? 'rgba(52,211,153,0.35)' : signalCls === 'bearish' ? 'rgba(251,113,133,0.35)' : 'rgba(100,116,139,0.3)'}`
          }}>
            {signal}
          </div>
        </div>

        {/* Row 2: BUY vs SELL volume bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span className="font-mono text-emerald" style={{ fontSize: '0.62rem' }}>BUY {buyPct.toFixed(1)}% · {fmtUsd(buyUsd)}</span>
            <span className="font-mono text-rose" style={{ fontSize: '0.62rem' }}>{fmtUsd(sellUsd)} · {sellPct.toFixed(1)}% SELL</span>
          </div>
          <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'var(--bg-slate-800)' }}>
            <div style={{ width: `${buyPct}%`, background: 'var(--color-emerald-400)', transition: 'width 0.4s ease' }} />
            <div style={{ width: `${sellPct}%`, background: 'var(--color-rose-400)', transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Row 3: Trade count + max trade */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: '4px', padding: '6px 8px' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem', marginBottom: '2px' }}>BUY TRADES</div>
            <div className="font-mono text-emerald" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{bCount} lệnh</div>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem', marginTop: '2px' }}>Max: {bMax > 0 ? fmtUsd(bMax) : '---'}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(251,113,133,0.06)', border: '1px solid rgba(251,113,133,0.15)', borderRadius: '4px', padding: '6px 8px' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem', marginBottom: '2px' }}>SELL TRADES</div>
            <div className="font-mono text-rose" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{sCount} lệnh</div>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem', marginTop: '2px' }}>Max: {sMax > 0 ? fmtUsd(sMax) : '---'}</div>
          </div>
        </div>

      </div>

      {filteredTrades.length === 0 ? (
        <div className="hft-empty font-mono">Chưa có lệnh nào khớp với điều kiện lọc...</div>
      ) : (
        <div className="whale-table-wrap" style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <table className="liq-table font-mono" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-slate-900)', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '8px' }}>Thời gian</th>
                <th style={{ padding: '8px' }}>Side</th>
                <th style={{ padding: '8px' }}>Giá khớp</th>
                <th style={{ padding: '8px' }}>Khối lượng (BTC)</th>
                <th style={{ padding: '8px' }}>Giá trị (USD)</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.slice(0, 100).map((t, i) => (
                <tr key={t.id || `${t.timestamp}-${t.price}-${t.qty}-${i}`} style={{ borderBottom: '1px solid var(--border-panel)' }}>
                  <td style={{ color: 'var(--text-slate-400)', padding: '8px' }}>{t.time}</td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span className={`liq-side-tag ${t.side === 'BUY' ? 'liq-tag-long' : 'liq-tag-short'}`}>
                        {t.side}
                      </span>
                      <span
                        style={{
                          fontSize: '0.45rem',
                          opacity: 0.6,
                          border: '1px solid var(--border-panel)',
                          padding: '1px 3px',
                          borderRadius: '2px',
                          background: 'var(--bg-slate-900)',
                          color: 'var(--text-slate-300)'
                        }}
                        title="Binance Futures"
                      >
                        BIN-F
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>{fmtPrice(t.price)}</td>
                  <td style={{ padding: '8px' }}>{t.qty.toFixed(3)}</td>
                  <td className={t.usdtVol >= 1e6 ? 'whale-mega' : ''} style={{ color: t.side === 'BUY' ? 'var(--color-emerald-400)' : 'var(--color-rose-400)', padding: '8px' }}>
                    {fmtUsd(t.usdtVol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MemoTargetLiquidityPanel = React.memo(TargetLiquidityPanel);

// ─── Wrapper: computes clustered data from raw whaleData + gap ────────────────

function TargetLiquidityPanelWrapper({ whaleData, whaleGap, setWhaleGap, isNested }) {
  const { whaleBids, whaleAsks, bidRatio, signal, signalCls } = whaleData || {};

  const clusteredBids = useMemo(() => clusterOrders(whaleBids || [], whaleGap), [whaleBids, whaleGap]);
  const clusteredAsks = useMemo(() => clusterOrders(whaleAsks || [], whaleGap), [whaleAsks, whaleGap]);

  const bidWallTotal = useMemo(() => clusteredBids.reduce((s, o) => s + o.usdValue, 0), [clusteredBids]);
  const askWallTotal = useMemo(() => clusteredAsks.reduce((s, o) => s + o.usdValue, 0), [clusteredAsks]);

  return (
    <MemoTargetLiquidityPanel
      clusteredBids={clusteredBids}
      clusteredAsks={clusteredAsks}
      bidWallTotal={bidWallTotal}
      askWallTotal={askWallTotal}
      bidRatio={bidRatio}
      signal={signal}
      signalCls={signalCls}
      gap={whaleGap}
      setGap={setWhaleGap}
      isNested={isNested}
    />
  );
}

function AdvancedChartWrapper({ theme, whaleData, whaleGap, children }) {
  const clusteredWhaleData = useMemo(() => {
    if (!whaleData) return null;
    const clusteredBids = clusterOrders(whaleData.whaleBids || [], whaleGap);
    const clusteredAsks = clusterOrders(whaleData.whaleAsks || [], whaleGap);
    return {
      ...whaleData,
      whaleBids: clusteredBids,
      whaleAsks: clusteredAsks,
    };
  }, [whaleData, whaleGap]);

  return <AdvancedChart theme={theme} whaleData={clusteredWhaleData} moduleId="hft_heatmap">{children}</AdvancedChart>;
}

// ─── PANEL: Move Tracker — realtime trigger + research log ───────────────────

const OUTCOME_LABELS = {
  CONTINUATION: 'Tiếp diễn ngắn hạn',
  PARTIAL_RETRACE: 'Hồi lại một phần',
  MEAN_REVERSION: 'Đảo chiều về trung bình',
  DATA_INCOMPLETE: 'Dữ liệu chưa đủ',
  UNRESOLVED: 'Đang chờ',
};

const formatBps = (value) => value == null ? 'N/A' : `${value > 0 ? '+' : ''}${Number(value).toFixed(1)} bps`;

function MoveStatsTable({ title, groups = [] }) {
  return (
    <div className="move-stats-block">
      <div className="move-stats-title font-mono">{title}</div>
      <div className="move-table-container">
        <table className="move-table move-stats-table font-mono">
          <thead><tr><th>Nhóm</th><th>N</th><th>Đủ dữ liệu</th><th>Trung vị +5m</th><th>MFE / MAE</th><th>Tiếp diễn / Đảo chiều</th></tr></thead>
          <tbody>
            {groups.length === 0 ? (
              <tr><td colSpan="6" className="move-stats-empty">Chưa đủ event đã hoàn tất +5m.</td></tr>
            ) : groups.map((group) => (
              <tr key={group.key}>
                <td>{group.key}{group.smallSample && <span className="move-small-sample">MẪU NHỎ</span>}</td>
                <td>{group.n}</td>
                <td>{group.dataCompleteRate}%</td>
                <td>{formatBps(group.medianReturnBps)}</td>
                <td>{formatBps(group.medianMfeBps)} / {formatBps(group.medianMaeBps)}</td>
                <td>{group.continuationRate == null ? 'N/A' : `${group.continuationRate}% / ${group.reversionRate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MoveTrackerPanel() {
  const [trackerState, setTrackerState] = useState({
    status: 'IDLE', activeMove: null, pendingRecoveries: [], moveHistory: [], health: {}, thresholdUsd: null,
    atrState: { value: null, status: 'UNAVAILABLE' }, researchStats: null,
    settings: { mode: MOVE_CONFIG.MODE_ATR, atrMult: MOVE_CONFIG.DEFAULT_ATR_MULT, fixedUsd: MOVE_CONFIG.DEFAULT_FIXED_USD, enabled: true },
  });
  const [expandedMoveId, setExpandedMoveId] = useState(null);
  const [historyDirection, setHistoryDirection] = useState('ALL');
  const [historyFlow, setHistoryFlow] = useState('ALL');
  const [nowTick, setNowTick] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => subscribeMoveTracker(setTrackerState), []);
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { status, activeMove, pendingRecoveries = [], moveHistory = [], settings, health = {}, thresholdUsd, atrState = {}, researchStats } = trackerState;
  const pendingMove = pendingRecoveries[0] || null;
  const displayMove = activeMove || pendingMove || moveHistory[0] || null;
  const recoveryRemaining = pendingMove ? (nowTick ? Math.max(0, Math.ceil((pendingMove.recoveryEndsAt - nowTick) / 1000)) : 60) : 0;
  const futuresAge = health.futuresLastTradeAt ? nowTick - health.futuresLastTradeAt : Infinity;
  const spotAge = health.spotLastTradeAt ? nowTick - health.spotLastTradeAt : Infinity;
  const connectionState = futuresAge < 10_000 && spotAge < 10_000 ? 'LIVE' : futuresAge === Infinity && spotAge === Infinity ? 'WARMING' : 'DATA GAP';
  const filteredHistory = useMemo(() => moveHistory.filter((move) =>
    (historyDirection === 'ALL' || move.direction === historyDirection) &&
    (historyFlow === 'ALL' || move.flowLabel === historyFlow)
  ), [moveHistory, historyDirection, historyFlow]);

  const statusBadge = useMemo(() => {
    if (!settings.enabled) return { label: 'ĐÃ TẠM DỪNG', cls: 'status-tag--idle' };
    if (status === 'TRACKING') return { label: 'ĐANG TRACKING', cls: 'status-tag--tracking' };
    if (pendingMove) return { label: `POST-EVENT ${recoveryRemaining}s`, cls: 'status-tag--recovery' };
    return { label: 'ĐANG CHỜ EVENT', cls: 'status-tag--idle' };
  }, [status, settings.enabled, pendingMove, recoveryRemaining]);

  const trigger = displayMove?.triggerSnapshot;
  const end = displayMove?.endSnapshot;
  const interpretation = useMemo(() => describeMoveEvent(displayMove), [displayMove]);
  const currentPrice = displayMove?.endPrice ?? displayMove?.triggerPrice;
  const triggerMovePct = displayMove ? ((displayMove.triggerPrice - displayMove.startPrice) / displayMove.startPrice) * 100 : 0;
  const atrText = atrState.value == null ? 'N/A' : `$${Number(atrState.value).toFixed(0)}`;
  const thresholdText = Number.isFinite(thresholdUsd) ? `$${Math.round(thresholdUsd)}` : 'WAITING';

  const handleExport = async (format) => {
    setExporting(true);
    try { await downloadMoveResearch(format); } finally { setExporting(false); }
  };

  return (
    <section className="hft-panel glass-panel move-tracker-panel" aria-label="BTC move tracker">
      <header className="hft-panel-header move-tracker-header">
        <div className="move-heading-block">
          <div className="hft-panel-title font-mono"><span className="hft-icon">↕</span> MOVE TRACKER</div>
          <div className="move-source-line font-mono">
            <span>BINANCE BTCUSDT</span>
            <span className={`move-health move-health--${connectionState.toLowerCase().replace(' ', '-')}`}>{connectionState}</span>
            <span>CHAMPION PRICE DETECTOR · SHADOW FLOW RESEARCH</span>
          </div>
        </div>
        <div className="move-header-actions">
          <span className={`move-status-badge ${statusBadge.cls}`}>{statusBadge.label}</span>
          <button type="button" className={`move-enable-btn ${settings.enabled ? 'is-on' : ''}`} onClick={() => updateMoveTrackerSettings({ enabled: !settings.enabled })} aria-pressed={settings.enabled}>{settings.enabled ? 'ON' : 'OFF'}</button>
          <ModuleMenu moduleId="hft_move_tracker" />
        </div>
      </header>

      <div className="move-controls font-mono">
        <label className="move-control-field"><span>Cách phát hiện</span><select className="move-select" value={settings.mode} onChange={(event) => updateMoveTrackerSettings({ mode: event.target.value })}><option value={MOVE_CONFIG.MODE_ATR}>Futures ATR (nến 5m đã đóng)</option><option value={MOVE_CONFIG.MODE_FIXED}>Ngưỡng USD cố định</option></select></label>
        {settings.mode === MOVE_CONFIG.MODE_ATR ? (
          <label className="move-control-field"><span>Độ nhạy</span><select className="move-select" value={settings.atrMult} onChange={(event) => updateMoveTrackerSettings({ atrMult: Number(event.target.value) })}>{[1, 1.5, 2, 3].map((value) => <option key={value} value={value}>{value.toFixed(1)} × ATR</option>)}</select></label>
        ) : (
          <label className="move-control-field"><span>Ngưỡng</span><select className="move-select" value={settings.fixedUsd} onChange={(event) => updateMoveTrackerSettings({ fixedUsd: Number(event.target.value) })}>{[300, 500, 1000, 1500].map((value) => <option key={value} value={value}>≥ ${value.toLocaleString()}</option>)}</select></label>
        )}
        <span className={`move-atr-info move-atr-info--${String(atrState.status).toLowerCase()}`}>Futures ATR(14) {atrText} · 120s threshold {thresholdText} · {atrState.status}</span>
      </div>

      {displayMove ? (
        <div className={`move-card move-card--${displayMove.direction?.toLowerCase() || 'pump'}`}>
          <div className="move-timeline font-mono">
            {['PHÁT HIỆN', 'THEO DÕI', 'HẬU SỰ KIỆN', 'KẾT QUẢ'].map((phase, index) => {
              const activeIndex = activeMove ? 1 : pendingMove ? 2 : displayMove.forwardOutcomes?.['900'] ? 3 : 2;
              return <span key={phase} className={index <= activeIndex ? 'is-complete' : ''}>{phase}</span>;
            })}
          </div>
          <div className="move-card-header">
            <div className="move-main-title">
              <span className={`move-dir-tag move-dir-tag--${displayMove.direction?.toLowerCase()}`}>{displayMove.direction === 'PUMP' ? '▲ XUNG LỰC TĂNG' : '▼ XUNG LỰC GIẢM'}</span>
              <span className="move-price-delta font-mono">Trigger {displayMove.direction === 'PUMP' ? '+' : '-'}${Math.round(Math.abs(displayMove.triggerPrice - displayMove.startPrice)).toLocaleString()} ({triggerMovePct > 0 ? '+' : ''}{triggerMovePct.toFixed(2)}%) · {displayMove.detectionWindowSec}s</span>
            </div>
            <span className={`move-decision-state move-decision-state--${interpretation?.tone || 'neutral'} font-mono`}>{interpretation?.stateLabel}</span>
          </div>

          {pendingMove && <div className="move-recovery-progress" aria-label={`${recoveryRemaining} seconds remaining`}><span style={{ width: `${((60 - recoveryRemaining) / 60) * 100}%` }} /></div>}

          <div className={`move-decision-brief move-decision-brief--${interpretation?.tone || 'neutral'}`}>
            <div className="move-decision-copy">
              <span className="move-decision-eyebrow font-mono">ĐIỀU HỆ THỐNG ĐANG QUAN SÁT</span>
              <strong>{interpretation?.summary}</strong>
              <p>{interpretation?.implication}</p>
            </div>
            <div className="move-decision-guardrail">
              <span className="font-mono">KHÔNG CÓ NGHĨA</span>
              <p>{interpretation?.limitation}</p>
            </div>
          </div>

          <div className="move-decision-evidence font-mono">
            <div><span>CƯỜNG ĐỘ</span><strong>{interpretation?.evidence.participation}</strong></div>
            <div><span>NGUỒN DÒNG TIỀN</span><strong>{interpretation?.evidence.flow}</strong></div>
            <div><span>BỐI CẢNH</span><strong>{interpretation?.evidence.timeframe}</strong></div>
            <div><span>CHẤT LƯỢNG DỮ LIỆU</span><strong>{interpretation?.evidence.data}</strong></div>
          </div>

          <div className="move-watch-next">
            <span className="font-mono">ĐIỀU CẦN THEO DÕI TIẾP</span>
            <p>{interpretation?.watchNext}</p>
          </div>

          <details className="move-detail-disclosure">
            <summary>Xem dữ liệu nghiên cứu và outcome ngắn hạn</summary>
            <div className="move-snapshot-note font-mono"><strong>TRIGGER SNAPSHOT</strong> — dữ liệu decision-time được đóng băng tại lúc alert. Outcome +5m/+15m là hậu nghiệm và không dự báo xu hướng nhiều ngày.</div>
            <div className="move-research-badges font-mono">
              <span className={`move-tier move-tier--${String(displayMove.qualityTier).toLowerCase()}`}>{displayMove.qualityTier}</span>
              <span className="move-flow-label">{displayMove.flowLabel}</span>
              {displayMove.outcomeLabel !== 'UNRESOLVED' && <span className="move-outcome-label">{OUTCOME_LABELS[displayMove.outcomeLabel]}</span>}
            </div>
            <div className="move-metrics-grid font-mono">
              <div className="move-metric-item"><span className="move-metric-lbl">PRICE AT TRIGGER / NOW</span><span className="move-metric-val">${displayMove.triggerPrice?.toLocaleString()} / ${currentPrice?.toLocaleString()}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">FUTURES CVD @ TRIGGER</span><span className={`move-metric-val ${(trigger?.futures?.cvd || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>{fmtUsd(trigger?.futures?.cvd)}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">SPOT CVD @ TRIGGER</span><span className={`move-metric-val ${(trigger?.spot?.cvd || 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>{trigger?.spot?.cvd == null ? 'N/A' : fmtUsd(trigger.spot.cvd)}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">+5M OUTCOME</span><span className="move-metric-val highlight">{formatBps(displayMove.forwardOutcomes?.['300']?.continuationBps)} · {OUTCOME_LABELS[displayMove.forwardOutcomes?.['300']?.outcomeLabel] || 'Pending'}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">TRIGGER FUTURES VOLUME</span><span className="move-metric-val">{fmtUsd(trigger?.futures?.totalVolume)} · {trigger?.futures?.tradeCount?.toLocaleString() || 0} trades</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">END FUTURES VOLUME</span><span className="move-metric-val">{end ? `${fmtUsd(end.futures?.totalVolume)} · ${end.futures?.tradeCount?.toLocaleString() || 0} trades` : 'Pending'}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">DATA QUALITY</span><span className="move-metric-val">{displayMove.dataQuality?.complete ? 'COMPLETE' : 'INCOMPLETE'} · baseline {displayMove.dataQuality?.baselineSampleCount ?? 0}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">OI / FUNDING / OBI</span><span className="move-metric-val">{trigger?.externalContext?.status || 'STALE'} · {trigger?.externalContext?.openInterest ?? 'N/A'} / {trigger?.externalContext?.fundingRate ?? 'N/A'} / {trigger?.externalContext?.obiPercent ?? 'N/A'}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">CONTEXT 5M / 15M / 1H</span><span className="move-metric-val">{['5m', '15m', '1h'].map((tf) => `${tf} ${displayMove.timeframeContext?.[tf]?.structure || 'N/A'}`).join(' · ')}</span></div>
              <div className="move-metric-item"><span className="move-metric-lbl">FORWARD PATH</span><span className="move-metric-val">{[15, 30, 60, 300, 900].map((h) => `${h < 300 ? `${h}s` : `${h / 60}m`} ${formatBps(displayMove.forwardOutcomes?.[String(h)]?.continuationBps)}`).join(' · ')}</span></div>
            </div>
            <div className="move-window-scores font-mono">{displayMove.detectionScores?.map((score) => <span key={score.windowSec}>{score.windowSec}s: {score.available ? `${Number(score.score).toFixed(2)}×` : 'N/A'}</span>)}</div>
          </details>
        </div>
      ) : (
        <div className="move-empty-state font-mono"><strong>{connectionState === 'LIVE' && atrState.status === 'LIVE' ? 'Đang lắng nghe dòng lệnh thực thi' : 'Đang khởi tạo dữ liệu decision-time'}</strong><span>Hệ thống sẽ giải thích xung lực, nguồn dòng tiền và bối cảnh ngay khi phát hiện event mới.</span></div>
      )}

      <div className="move-research-section">
        <div className="move-history-head">
          <div><div className="move-history-title font-mono">90-DAY RESEARCH · {researchStats?.overall?.n ?? moveHistory.length} EVENTS</div><div className="move-research-disclaimer font-mono">Descriptive only · chưa phải edge giao dịch · slice N&lt;30 được đánh dấu mẫu nhỏ</div></div>
          <div className="move-history-filters">
            <button type="button" className="move-export-btn" disabled={exporting} onClick={() => handleExport('csv')}>CSV</button>
            <button type="button" className="move-export-btn" disabled={exporting} onClick={() => handleExport('json')}>JSON</button>
          </div>
        </div>
        <MoveStatsTable title="CỬA SỔ PHÁT HIỆN · KẾT QUẢ SAU 5 PHÚT" groups={researchStats?.detectionHorizons} />
        <MoveStatsTable title="BỐI CẢNH THỊ TRƯỜNG · 5M / 15M / 1H" groups={researchStats?.timeframeContexts} />
      </div>

      {moveHistory.length > 0 && (
        <div className="move-history-section">
          <div className="move-history-head">
            <div className="move-history-title font-mono">EVENT LOG · {filteredHistory.length}/{moveHistory.length}</div>
            <div className="move-history-filters">
              <select className="move-select" aria-label="Lọc hướng biến động" value={historyDirection} onChange={(event) => setHistoryDirection(event.target.value)}><option value="ALL">Mọi hướng</option><option value="PUMP">Xung lực tăng</option><option value="DUMP">Xung lực giảm</option></select>
              <select className="move-select" aria-label="Lọc nguồn dòng tiền" value={historyFlow} onChange={(event) => setHistoryFlow(event.target.value)}><option value="ALL">Mọi nguồn dòng tiền</option><option value="SPOT_CONFIRMED">Spot + Futures đồng thuận</option><option value="FUTURES_LED">Futures dẫn dắt</option><option value="SPOT_LED">Spot dẫn dắt</option><option value="MIXED_FLOW">Dòng tiền phân kỳ</option><option value="DATA_INCOMPLETE">Dữ liệu chưa đủ</option></select>
            </div>
          </div>
          <div className="move-table-container"><table className="move-table font-mono"><thead><tr><th>Thời điểm</th><th>Biến động</th><th>Cửa sổ</th><th>Diễn giải tại trigger</th><th>+5m</th><th>Kết quả ngắn hạn</th><th></th></tr></thead><tbody>
            {filteredHistory.map((move) => {
              const historyInterpretation = describeMoveEvent(move);
              return <React.Fragment key={move.id}>
                <tr className="move-tr">
                  <td>{new Date(move.triggerTime).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                  <td><span className={`move-badge move-badge--${move.direction?.toLowerCase()}`}>{move.direction}</span></td>
                  <td>{move.detectionWindowSec ?? 'N/A'}s</td>
                  <td className="move-history-interpretation"><strong>{historyInterpretation?.stateLabel}</strong><span>{historyInterpretation?.evidence.flow}</span></td>
                  <td>{formatBps(move.forwardOutcomes?.['300']?.continuationBps)}</td>
                  <td>{OUTCOME_LABELS[move.outcomeLabel] || move.outcomeLabel}</td>
                  <td><button type="button" className="move-row-toggle" onClick={() => setExpandedMoveId(expandedMoveId === move.id ? null : move.id)} aria-expanded={expandedMoveId === move.id}>{expandedMoveId === move.id ? '−' : '+'}</button></td>
                </tr>
                {expandedMoveId === move.id && <tr className="move-detail-row"><td colSpan="7"><div><span>Trigger {fmtUsd(move.triggerSnapshot?.futures?.totalVolume)} Futures</span><span>End {fmtUsd(move.endSnapshot?.futures?.totalVolume)} Futures</span><span>Recovery {move.recovery?.recoveryPct == null ? 'N/A' : `${move.recovery.recoveryPct}%`}</span><span>Status {move.status}</span></div><p>Snapshot trigger bất biến. Mọi chỉ số end/recovery/outcome là dữ liệu hậu sự kiện và không được dùng để tái tạo alert.</p></td></tr>}
              </React.Fragment>
            })}
          </tbody></table></div>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main HFT Radar Tab Component
// ═══════════════════════════════════════════════════════════════════════════════

const MemoCVDPanel = React.memo(CVDPanel);
const MemoTargetLiquidityPanelWrapper = React.memo(TargetLiquidityPanelWrapper);
const MemoOrderBookPanel = React.memo(OrderBookPanel);
const MemoAdvancedChartWrapper = React.memo(AdvancedChartWrapper);
const MemoWhaleTradesPanel = React.memo(WhaleTradesPanel);
const MemoMoveTrackerPanel = React.memo(MoveTrackerPanel);

export default function HftRadarTab({
  cvd, sessionCvd, buyVolume, sellVolume, cvdHistory, futuresStream, spotStream,
  cvdHistory24h, cvdHistory7d, cvdHistory30d,
  cvdHistory24hSpot, cvdHistory7dSpot, cvdHistory30dSpot,
  cvdStatus, livePrice, whaleTrades, theme, volNodes,
  data, liveVolume, fundingRate,
}) {
  const { isModuleHidden } = useModuleVisibility();
  const [orderBook, setOrderBook] = useState(null);
  const [whaleData, setWhaleData] = useState(null);
  const [, setIsLoading] = useState(false);
  const [whaleGap, setWhaleGap] = useState(() => {
    const saved = localStorage.getItem('hft_whale_gap');
    return saved ? Number(saved) : 100;
  });
  const [depthLimit, setDepthLimit] = useState(() => {
    const saved = localStorage.getItem('hft-depth-limit');
    return saved ? Number(saved) : 100;
  });

  useEffect(() => {
    localStorage.setItem('hft-depth-limit', String(depthLimit));
    localStorage.setItem('hft_whale_gap', String(whaleGap));
  }, [depthLimit, whaleGap]);

  const obIntervalRef = useRef(null);
  const whaleIntervalRef = useRef(null);
  const smoothedObiRef = useRef(null);

  useEffect(() => {
    const fetchOB = async () => {
      const data = await getOrderBookDepth('BTCUSDT', depthLimit);
      if (data) {
        if (smoothedObiRef.current === null) {
          smoothedObiRef.current = data.obiPercent;
        } else {
          smoothedObiRef.current = (smoothedObiRef.current * 0.85) + (data.obiPercent * 0.15);
        }
        const smoothed = {
          ...data,
          obiPercent: parseFloat(smoothedObiRef.current.toFixed(1))
        };
        setOrderBook(smoothed);
      }
    };

    const fetchWhales = async () => {
      const d = await getWhaleWalls();
      if (d) {
        setWhaleData(d);
      }
    };

    const fetchAll = async () => {
      setIsLoading(true);
      await Promise.allSettled([fetchOB(), fetchWhales()]);
      setIsLoading(false);
    };
    fetchAll();

    obIntervalRef.current = setInterval(fetchOB, 3000);
    whaleIntervalRef.current = setInterval(fetchWhales, 12000);

    return () => {
      if (obIntervalRef.current) clearInterval(obIntervalRef.current);
      if (whaleIntervalRef.current) clearInterval(whaleIntervalRef.current);
    };
  }, [depthLimit]);

  useEffect(() => {
    updateMoveTrackerContext({
      openInterest: data?.openInterest ?? null,
      fundingRate: fundingRate ?? data?.fundingRate ?? null,
      obiPercent: orderBook?.obiPercent ?? null,
      orderBookSignal: orderBook?.signal ?? null,
      updatedAt: Date.now(),
    });
  }, [data?.openInterest, data?.fundingRate, fundingRate, orderBook?.obiPercent, orderBook?.signal]);

  return (
    <div className="hft-radar-layout">
      <div className="hft-radar-header glass-panel">
        <h2 className="hft-radar-title font-mono">
          <span className="hft-icon-lg">🎯</span> DATA — DERIVATIVES ORDER FLOW
        </h2>
        <p className="hft-radar-desc font-mono">
          Phân tích dòng tiền phái sinh theo thời gian thực: CVD, Target Liquidity &amp; Order Book Imbalance
        </p>
      </div>

      <div className="hft-grid">
        {!isModuleHidden('hft_cvd') && (
          <MemoCVDPanel
            cvd={cvd}
            sessionCvd={sessionCvd}
            buyVolume={buyVolume}
            sellVolume={sellVolume}
            cvdHistory={cvdHistory}
            futuresStream={futuresStream}
            spotStream={spotStream}
            cvdHistory24h={cvdHistory24h}
            cvdHistory7d={cvdHistory7d}
            cvdHistory30d={cvdHistory30d}
            cvdHistory24hSpot={cvdHistory24hSpot}
            cvdHistory7dSpot={cvdHistory7dSpot}
            cvdHistory30dSpot={cvdHistory30dSpot}
            cvdStatus={cvdStatus}
            livePrice={livePrice}
            volNodes={volNodes}
            theme={theme}
            openInterest={data?.openInterest}
            oiHistory={data?.oiHistory}
            fundingRate={fundingRate ?? data?.fundingRate}
          />
        )}

        {!isModuleHidden('hft_move_tracker') && (
          <MemoMoveTrackerPanel />
        )}

        {(!isModuleHidden('hft_heatmap') || !isModuleHidden('hft_whale_walls')) && (
          <MemoAdvancedChartWrapper theme={theme} whaleData={whaleData} whaleGap={whaleGap}>
            {!isModuleHidden('hft_whale_walls') && (
              <MemoTargetLiquidityPanelWrapper whaleData={whaleData} whaleGap={whaleGap} setWhaleGap={setWhaleGap} isNested={true} />
            )}
          </MemoAdvancedChartWrapper>
        )}

        {!isModuleHidden('hft_orderbook') && (
          <MemoOrderBookPanel
            orderBook={orderBook}
            depthLimit={depthLimit}
            setDepthLimit={setDepthLimit}
          />
        )}

        {!isModuleHidden('hft_liquidations') && (
          <MemoWhaleTradesPanel whaleTrades={whaleTrades} volume24h={liveVolume || data?.btc?.volume} />
        )}
      </div>
    </div>
  );
}

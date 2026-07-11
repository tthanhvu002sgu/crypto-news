import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Line } from 'react-chartjs-2';

import { getOrderBookDepth, getWhaleWalls } from '../services/api';
import { runSignalDetection, takePeriodicSnapshot, SIGNAL_TYPE } from '../services/signalEngine';
import { getSignals, exportSignals, clearAllSignals, clearOldSignals } from '../services/signalStore';
import Tooltip, { METRIC_METADATA } from './Tooltip';
import AdvancedChart from './AdvancedChart';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';


// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtUsd = (n) => {
  if (n == null) return '---';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
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

const fmtPrice = (n) => n ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '---';

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
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: tickColor, maxTicksLimit: 12, font: { family: 'Outfit, JetBrains Mono', size: 10 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: 'Outfit, JetBrains Mono', size: 10 } },
      },
    },
  };
};

// ─── PANEL 1: CVD & Order Flow ────────────────────────────────────────────────

function CVDPanel({ cvd, sessionCvd, buyVolume, sellVolume, cvdHistory, cvdHistory24h, cvdHistory7d, cvdHistory30d, cvdStatus, livePrice, theme, volNodes = [] }) {
  const [cvdTf, setCvdTf] = useState('1H');
  const [nodeGap, setNodeGap] = useState(() => {
    const saved = localStorage.getItem('hft_cvd_gap');
    return saved ? Number(saved) : 100;
  });

  const totalVol = buyVolume + sellVolume;
  const buyPct = totalVol > 0 ? (buyVolume / totalVol * 100) : 50;
  const sellPct = 100 - buyPct;

  const clusteredNodes = useMemo(() => {
    if (!volNodes || volNodes.length === 0) return [];
    if (!nodeGap || nodeGap <= 1) return volNodes;

    const map = new Map();
    for (let i = 0; i < volNodes.length; i++) {
      const n = volNodes[i];
      const binPrice = Math.floor(n.price / nodeGap) * nodeGap;
      let entry = map.get(binPrice);
      if (!entry) {
        entry = { price: binPrice, priceHigh: binPrice + nodeGap - 1, buy: 0, sell: 0 };
        map.set(binPrice, entry);
      }
      entry.buy += n.buy;
      entry.sell += n.sell;
    }
    
    // Convert to array and sort descending by price
    const arr = Array.from(map.values()).sort((a, b) => b.price - a.price);
    return arr;
  }, [volNodes, nodeGap]);

  const baseSession24hRef = useRef(sessionCvd || 0);
  const prevList24hRef = useRef(cvdHistory24h);
  if (prevList24hRef.current !== cvdHistory24h) {
    prevList24hRef.current = cvdHistory24h;
    baseSession24hRef.current = sessionCvd || 0;
  }
  const delta24h = (sessionCvd || 0) - baseSession24hRef.current;

  const baseSession7dRef = useRef(sessionCvd || 0);
  const prevList7dRef = useRef(cvdHistory7d);
  if (prevList7dRef.current !== cvdHistory7d) {
    prevList7dRef.current = cvdHistory7d;
    baseSession7dRef.current = sessionCvd || 0;
  }
  const delta7d = (sessionCvd || 0) - baseSession7dRef.current;

  const baseSession30dRef = useRef(sessionCvd || 0);
  const prevList30dRef = useRef(cvdHistory30d);
  if (prevList30dRef.current !== cvdHistory30d) {
    prevList30dRef.current = cvdHistory30d;
    baseSession30dRef.current = sessionCvd || 0;
  }
  const delta30d = (sessionCvd || 0) - baseSession30dRef.current;

  // Normalize 1H rolling window so Net CVD delta starts from baseline 60 mins ago
  const list1h = useMemo(() => {
    if (!cvdHistory || cvdHistory.length === 0) return [];
    const base1h = cvdHistory[0]?.cvd || 0;
    return cvdHistory.map((item, idx) => {
      const isLast = idx === cvdHistory.length - 1;
      return {
        ...item,
        cvd: (isLast ? cvd : item.cvd) - base1h,
        price: isLast ? (livePrice || item.price) : item.price
      };
    });
  }, [cvdHistory, cvd, livePrice]);

  const chartList = useMemo(() => {
    if (cvdTf === '1H') return list1h;
    if (cvdTf === '24H') {
      if (!cvdHistory24h || cvdHistory24h.length === 0) return [];
      const list = [...cvdHistory24h];
      const last = list[list.length - 1];
      list[list.length - 1] = { ...last, cvd: last.cvd + delta24h, price: livePrice || last.price };
      return list;
    }
    if (cvdTf === '7D') {
      if (!cvdHistory7d || cvdHistory7d.length === 0) return [];
      const list = [...cvdHistory7d];
      const last = list[list.length - 1];
      list[list.length - 1] = { ...last, cvd: last.cvd + delta7d, price: livePrice || last.price };
      return list;
    }
    if (cvdTf === '30D') {
      if (!cvdHistory30d || cvdHistory30d.length === 0) return [];
      const list = [...cvdHistory30d];
      const last = list[list.length - 1];
      list[list.length - 1] = { ...last, cvd: last.cvd + delta30d, price: livePrice || last.price };
      return list;
    }
    return [];
  }, [cvdTf, list1h, cvdHistory24h, cvdHistory7d, cvdHistory30d, delta24h, delta7d, delta30d, livePrice]);

  const latestCvd = chartList.length > 0 ? chartList[chartList.length - 1].cvd : 0;

  const chartOpts = useMemo(() => {
    const base = getChartOptsBase(theme);
    return {
      ...base,
      plugins: {
        ...base.plugins,
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: {
            label: (ctx) => {
              const item = chartList[ctx.dataIndex];
              const btcStr = item?.price ? ` (BTC: $${Number(item.price).toLocaleString()})` : '';
              return ` CVD: ${fmtCvdUsd(ctx.parsed.y)}${btcStr}`;
            }
          }
        }
      },
      scales: {
        ...base.scales,
        y: {
          ...base.scales.y,
          ticks: {
            ...base.scales.y.ticks,
            callback: (val) => fmtCvdUsd(val)
          }
        }
      }
    };
  }, [theme, chartList]);

  const chartData = useMemo(() => {
    const labels = chartList.map(item => {
      if (typeof item.time === 'string') return item.time;
      if (item.time == null) return '';
      const d = new Date(item.time);
      if (cvdTf === '24H') {
        return `${String(d.getHours()).padStart(2, '0')}:00`;
      }
      if (cvdTf === '7D') {
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      }
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const cvdVals = chartList.map(item => item.cvd);
    const lastVal = cvdVals.length > 0 ? cvdVals[cvdVals.length - 1] : cvd;
    const isPos = lastVal >= 0;
    const lineColor = isPos ? '#10b981' : '#f43f5e';
    const isLight = theme === 'light';
    const bgColor = isPos
      ? (isLight ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.15)')
      : (isLight ? 'rgba(244, 63, 94, 0.1)' : 'rgba(244, 63, 94, 0.15)');

    return {
      labels,
      datasets: [
        {
          label: 'CVD',
          data: cvdVals,
          borderColor: lineColor,
          backgroundColor: bgColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.25,
        }
      ]
    };
  }, [chartList, cvdTf, cvd, theme]);



  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Tooltip content={METRIC_METADATA.cvd}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, margin: 0 }}>
              <span className="hft-icon">📊</span> CVD &amp; ORDER FLOW
            </h3>
          </Tooltip>
          <div className="hft-panel-badges">
            <span
              className="hft-badge badge-api font-mono"
              style={{ cursor: 'help' }}
              title="Binance Futures aggTrade được sử dụng làm chỉ số tham chiếu CVD chuẩn (Benchmark Proxy) vì chiếm hơn 50% thanh khoản phái sinh toàn cầu"
            >
              BIN-F PROXY
            </span>
            <span className={`hft-badge font-mono ${cvdStatus === 'connected' ? 'badge-live' : 'badge-off'}`}>
              {cvdStatus === 'connected' ? '⚡ LIVE' : 'WS OFF'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="etf-timeframe-toggle font-mono">
            {['1H', '24H', '7D', '30D'].map(t => (
              <button
                key={t}
                onClick={() => setCvdTf(t)}
                className={`toggle-btn ${cvdTf === t ? 'active' : ''}`}
              >
                {t === '1H' ? '1H (LIVE)' : t}
              </button>
            ))}
          </div>
          <ModuleMenu moduleId="hft_cvd" />
        </div>
      </div>

      {/* CVD Value */}
      <div className="cvd-hero" style={{ paddingBottom: '8px' }}>
        <div className="cvd-value-wrap">
          <span className="cvd-label font-mono" title="CVD ròng tích lũy trong khung thời gian">
            {`CVD RÒNG (${cvdTf === '1H' ? '1 GIỜ QUA' : cvdTf === '24H' ? '24 GIỜ QUA' : cvdTf === '7D' ? '7 NGÀY QUA' : '30 NGÀY QUA'})`}
          </span>
          <span className={`cvd-value font-mono ${latestCvd >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {fmtCvdUsd(latestCvd)}
          </span>
        </div>
      </div>

      {/* CVD Line Chart */}
      <div className="cvd-chart-container" style={{ height: '180px', width: '100%', marginBottom: '16px' }}>
        {chartList.length > 1 ? (
          <Line data={chartData} options={chartOpts} />
        ) : (
          <div className="hft-empty font-mono" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-slate-400)', fontSize: '0.75rem' }}>
            {cvdTf === '1H' ? '⚡ Đang tích lũy dữ liệu CVD realtime theo phút...' : 'Đang tải dữ liệu biểu đồ CVD...'}
          </div>
        )}
      </div>

      {/* Volume Gauge */}
      <div className="vol-gauge-container">
        <div className="vol-gauge-labels font-mono">
          <span className="text-emerald">BUY {buyPct.toFixed(1)}%</span>
          <span className="text-slate-400">Volume Ratio (Realtime)</span>
          <span className="text-rose">SELL {sellPct.toFixed(1)}%</span>
        </div>
        <div className="vol-gauge-bar">
          <div className="vol-gauge-buy" style={{ width: `${buyPct}%` }} />
          <div className="vol-gauge-sell" style={{ width: `${sellPct}%` }} />
        </div>
        <div className="vol-gauge-values font-mono">
          <span>{fmtUsd(buyVolume)}</span>
          <span>{fmtUsd(sellVolume)}</span>
        </div>
      </div>

      {/* Node Gap Config */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.55rem', fontWeight: 600 }}>FOOTPRINT GAP (NODE)</span>
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
      
      {/* Nodes Table */}
      {clusteredNodes.length > 0 && (
        <div style={{ maxHeight: '250px', overflowY: 'auto', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)', padding: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.65rem' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-slate-950)', zIndex: 10 }}>
              <tr>
                <th title="Vùng giá (Node) gộp các mức giá dựa trên cấu hình GAP. Dữ liệu được tích lũy theo thời gian thực từ WebSocket kể từ lúc bạn mở trang Web." style={{ padding: '8px', textAlign: 'left', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>VÙNG GIÁ (NODE)</th>
                <th title="Volume Mua Chủ Động (Lệnh Market Buy khớp vào Limit Sell) tích lũy realtime kể từ lúc mở trang." style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>BUY VOL</th>
                <th title="Volume Bán Chủ Động (Lệnh Market Sell khớp vào Limit Buy) tích lũy realtime kể từ lúc mở trang." style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>SELL VOL</th>
                <th title="Độ chênh lệch (Buy Vol - Sell Vol) tích lũy realtime kể từ lúc mở trang. Dương (Xanh) = Phe Mua áp đảo. Âm (Đỏ) = Phe Bán áp đảo." style={{ padding: '8px', color: 'var(--text-slate-400)', fontWeight: 600, borderBottom: '1px solid var(--border-panel)', cursor: 'help' }}>DELTA</th>
              </tr>
            </thead>
            <tbody>
              {clusteredNodes.map(n => {
                const delta = n.buy - n.sell;
                const total = n.buy + n.sell;
                if (total === 0) return null;
                
                // Dynamic shading base
                const maxVol = Math.max(...clusteredNodes.map(cn => cn.buy + cn.sell));
                const maxSingleVol = Math.max(...clusteredNodes.map(cn => Math.max(cn.buy, cn.sell)));
                const buyWidth = Math.min(100, (n.buy / maxSingleVol) * 100);
                const sellWidth = Math.min(100, (n.sell / maxSingleVol) * 100);
                
                return (
                  <tr key={n.price} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td className="font-mono" style={{ padding: '8px', textAlign: 'left', color: 'var(--text-slate-200)' }}>
                      {n.price} <span style={{ color: 'var(--text-slate-500)', margin: '0 4px' }}>~</span> {n.priceHigh}
                    </td>
                    <td className="font-mono" style={{ padding: '8px', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '4px', bottom: '4px', right: '8px', width: `${buyWidth}%`, background: 'rgba(16, 185, 129, 0.15)', borderRadius: '2px', zIndex: 1 }} />
                      <span style={{ position: 'relative', zIndex: 2, color: 'var(--color-emerald-400)' }}>{fmtUsd(n.buy)}</span>
                    </td>
                    <td className="font-mono" style={{ padding: '8px', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '4px', bottom: '4px', right: '8px', width: `${sellWidth}%`, background: 'rgba(244, 63, 94, 0.15)', borderRadius: '2px', zIndex: 1 }} />
                      <span style={{ position: 'relative', zIndex: 2, color: 'var(--color-rose-400)' }}>{fmtUsd(n.sell)}</span>
                    </td>
                    <td className={`font-mono ${delta > 0 ? 'text-emerald' : 'text-rose'}`} style={{ padding: '8px', fontWeight: 600 }}>
                      <div style={{ background: delta > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)', display: 'inline-block', padding: '2px 6px', borderRadius: '4px' }}>
                        {delta > 0 ? '+' : ''}{fmtUsd(delta)}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
              {netFlow >= 0 ? '+' : ''}{fmtUsd(netFlow)}
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



// ─── PANEL 5: Signal Log ─────────────────────────────────────────────────────

const SIGNAL_TYPE_LABELS = {
  PRICE_SPIKE: '💥 Price Spike',
  VOLUME_SPIKE: '📈 Volume Spike',
  CVD_DIVERGENCE: '⚠️ CVD Divergence',
  FUNDING_EXTREME: '💰 Funding',
  OI_SURGE: '📊 OI Surge',
  OBI_EXTREME: '📖 OBI Extreme',
  WHALE_CLUSTER: '🐋 Whale Cluster',
  WHALE_WALL_SHIFT: '🧱 Whale Wall',
  MACRO_EVENT: '🌍 Macro Event',
  FNG_EXTREME: '😱 Fear/Greed',
  PERIODIC_SNAPSHOT: '📸 Snapshot',
};

const SNAPSHOT_LABELS = {
  btcPrice: 'BTC Price',
  btcChange24h: 'BTC 24h%',
  ethPrice: 'ETH Price',
  solPrice: 'SOL Price',
  cvd: 'CVD',
  sessionCvd: 'Session CVD',
  buyVolume: 'Buy Vol',
  sellVolume: 'Sell Vol',
  buyRatio: 'Buy Ratio',
  fundingRate: 'Funding Rate',
  fundingRateRest: 'FR (REST)',
  openInterest: 'Open Interest',
  openInterestRest: 'OI (REST)',
  obiPercent: 'OBI %',
  obSignal: 'OB Signal',
  bidVolBtc: 'Bid Vol BTC',
  askVolBtc: 'Ask Vol BTC',
  bidWallTotal: 'Bid Walls',
  askWallTotal: 'Ask Walls',
  bidRatio: 'Wall Bid Ratio',
  whaleWallSignal: 'Wall Signal',
  fngValue: 'Fear & Greed',
  fngSentiment: 'F&G Label',
  btcDominance: 'BTC Dom',
  totalMarketCap: 'Mkt Cap',
  stablecoinTotal: 'Stablecoin',
  fedRate: 'Fed Rate',
  cpi: 'CPI',
  tenYearYield: '10Y Yield',
  dxy: 'DXY',
  vix: 'VIX',
  sp500: 'S&P 500',
  netLiquidity: 'Net Liq.',
  mvrv: 'MVRV',
  highYield: 'HY Spread',
  m2Supply: 'M2 Supply',
};

function formatSnapshotValue(key, value) {
  if (value == null || value === '') return '---';
  if (typeof value === 'object') return JSON.stringify(value);

  // USD values
  if (['btcPrice', 'ethPrice', 'solPrice', 'sp500'].includes(key)) {
    return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  // Large USD volumes or numbers
  if (['cvd', 'sessionCvd', 'buyVolume', 'sellVolume', 'bidWallTotal', 'askWallTotal', 'btcVolume24h'].includes(key)) {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : value > 0 && ['cvd', 'sessionCvd'].includes(key) ? '+' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  // Market cap
  if (['totalMarketCap', 'stablecoinTotal'].includes(key)) {
    return `$${(value / 1e12).toFixed(2)}T`;
  }
  // Percentages
  if (['btcChange24h', 'buyRatio', 'obiPercent', 'btcDominance'].includes(key)) {
    return `${value >= 0 && key !== 'buyRatio' && key !== 'btcDominance' ? '+' : ''}${Number(value).toFixed(1)}%`;
  }
  // Funding rate
  if (['fundingRate', 'fundingRateRest'].includes(key)) {
    return `${(value * 100).toFixed(4)}%`;
  }
  // Ratios
  if (['bidRatio'].includes(key)) {
    return `${(value * 100).toFixed(0)}%`;
  }
  // Open interest
  if (['openInterest', 'openInterestRest'].includes(key)) {
    return `${Number(value).toLocaleString()} BTC`;
  }

  return String(value);
}

// Helper: Analyze snapshot to give concise BIAS and HIGHLIGHTS
function analyzeSnapshot(snapshot) {
  if (!snapshot) return null;

  let bullPoints = 0;
  let bearPoints = 0;
  const highlights = [];

  // 1. CVD Analysis
  if (snapshot.cvd != null) {
    if (snapshot.cvd > 10000000) {
      bullPoints += 2;
      highlights.push(`⚡ Dòng tiền Mua chủ động (+${formatSnapshotValue('cvd', snapshot.cvd)} CVD)`);
    } else if (snapshot.cvd < -10000000) {
      bearPoints += 2;
      highlights.push(`⚡ Dòng tiền Bán chủ động (${formatSnapshotValue('cvd', snapshot.cvd)} CVD)`);
    }
  }

  // 2. OBI Analysis
  if (snapshot.obiPercent != null) {
    if (snapshot.obiPercent > 15) {
      bullPoints += 1;
      highlights.push(`📖 Sổ lệnh nghiêng Mua (+${snapshot.obiPercent}% OBI)`);
    } else if (snapshot.obiPercent < -15) {
      bearPoints += 1;
      highlights.push(`📖 Sổ lệnh nghiêng Bán (${snapshot.obiPercent}% OBI)`);
    }
  }

  // 3. Whale Walls Analysis
  if (snapshot.bidRatio != null) {
    const ratioPct = Math.round(snapshot.bidRatio * 100);
    if (ratioPct >= 60) {
      bullPoints += 2;
      highlights.push(`🧱 Tường cá voi đỡ giá dày (${ratioPct}% Bid ~ ${formatSnapshotValue('bidWallTotal', snapshot.bidWallTotal)})`);
    } else if (ratioPct <= 40) {
      bearPoints += 2;
      highlights.push(`🧱 Tường cá voi chặn bán dày (${100 - ratioPct}% Ask ~ ${formatSnapshotValue('askWallTotal', snapshot.askWallTotal)})`);
    }
  }

  // 4. Funding Rate Analysis
  const fr = snapshot.fundingRate ?? snapshot.fundingRateRest;
  if (fr != null) {
    if (fr > 0.0003) {
      bearPoints += 1;
      highlights.push(`🔥 Funding Rate cao (${(fr * 100).toFixed(4)}%) — Áp lực thanh lý Long`);
    } else if (fr < -0.0001) {
      bullPoints += 1;
      highlights.push(`🎯 Funding Rate âm (${(fr * 100).toFixed(4)}%) — Short trả phí, dễ Short Squeeze`);
    }
  }

  // 5. Fear & Greed
  if (snapshot.fngValue != null) {
    if (snapshot.fngValue <= 25) {
      highlights.push(`😱 Tâm lý Extreme Fear (${snapshot.fngValue}) — Thường là vùng mua hoảng loạn`);
    } else if (snapshot.fngValue >= 75) {
      highlights.push(`🤑 Tâm lý Extreme Greed (${snapshot.fngValue}) — Thường là vùng FOMO rủi ro`);
    }
  }

  if (highlights.length === 0) {
    highlights.push('⚖️ Thị trường cân bằng, dòng tiền và sổ lệnh không có chênh lệch lớn.');
  }

  let biasLabel = '⚪ NEUTRAL (Trung Tính)';
  let biasClass = 'bias-neutral';
  if (bullPoints > bearPoints + 1) {
    biasLabel = '🟢 BULLISH BIAS (Thiên Về Mua)';
    biasClass = 'bias-bullish';
  } else if (bearPoints > bullPoints + 1) {
    biasLabel = '🔴 BEARISH BIAS (Thiên Về Bán)';
    biasClass = 'bias-bearish';
  }

  return { biasLabel, biasClass, highlights };
}

function SignalLogPanel({ signals, onRefresh, signalCount }) {
  const [filter, setFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState(null);

  const filteredSignals = useMemo(() => {
    if (filter === 'ALL') return signals;
    if (filter === 'ALERTS') return signals.filter(s => s.type !== SIGNAL_TYPE.PERIODIC_SNAPSHOT);
    return signals.filter(s => s.severity === filter);
  }, [signals, filter]);

  const handleExport = useCallback(async () => {
    try {
      const json = await exportSignals();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signal-log-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[SignalLog] Export error:', e);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (window.confirm('Xóa toàn bộ signal log?')) {
      await clearAllSignals();
      onRefresh();
    }
  }, [onRefresh]);

  const handleCleanup = useCallback(async () => {
    const deleted = await clearOldSignals(7);
    if (deleted > 0) {
      onRefresh();
    }
  }, [onRefresh]);

  return (
    <div className="hft-panel glass-panel signal-log-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header">
        <h3 className="hft-panel-title font-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">📋</span> SIGNAL LOG (KIỂM TRA BIAS &amp; DÒNG TIỀN)
        </h3>
        <div className="hft-panel-badges" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="hft-badge badge-api font-mono">{signalCount} entries</span>
          <ModuleMenu moduleId="hft_signals" />
        </div>
      </div>

      {/* Toolbar: Filters + Actions */}
      <div className="signal-log-toolbar">
        <div className="signal-log-filters">
          {['ALL', 'ALERTS', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(f => (
            <button
              key={f}
              className={`signal-filter-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'ALERTS' ? '⚡ Alerts' : f}
            </button>
          ))}
        </div>
        <div className="signal-log-actions">
          <button className="signal-log-btn" onClick={handleCleanup} title="Xóa log cũ hơn 7 ngày">🧹 Clean 7d</button>
          <button className="signal-log-btn" onClick={handleExport} title="Export signal log ra JSON">📥 Export</button>
          <button className="signal-log-btn btn-danger" onClick={handleClear} title="Xóa toàn bộ">🗑️ Clear</button>
        </div>
      </div>

      {/* Signal List */}
      {filteredSignals.length === 0 ? (
        <div className="hft-empty font-mono">
          {filter === 'ALL'
            ? 'Chưa có signal nào. Engine sẽ tự động ghi nhận khi phát hiện sự kiện...'
            : `Không có signal nào cho filter "${filter}"`}
        </div>
      ) : (
        <div className="signal-log-list">
          {filteredSignals.map((sig) => {
            const isExpanded = expandedId === sig.id;
            const timeStr = new Date(sig.timestamp).toLocaleString('vi-VN', {
              day: '2-digit', month: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const typeLabel = SIGNAL_TYPE_LABELS[sig.type] || sig.type;
            const analysis = analyzeSnapshot(sig.snapshot);

            return (
              <div key={sig.id} className={`signal-card severity-${sig.severity}`}>
                <div className="signal-card-header">
                  <div className="signal-card-left">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className="signal-card-title">{sig.title}</span>
                      <span className="signal-type-badge">{typeLabel}</span>
                      {analysis && (
                        <span className={`signal-bias-pill font-mono ${analysis.biasClass}`}>
                          {analysis.biasLabel}
                        </span>
                      )}
                    </div>
                    {sig.description && <div className="signal-card-desc">{sig.description}</div>}
                  </div>
                  <div className="signal-card-meta">
                    <span className={`signal-severity-tag tag-${sig.severity}`}>{sig.severity}</span>
                    <span className="signal-time">{timeStr}</span>
                  </div>
                </div>

                {/* Quick Synthesis Highlights (Show right away if alert or expanded) */}
                {analysis && analysis.highlights.length > 0 && (
                  <div className="signal-highlights font-mono">
                    <div className="signal-hl-title">NỔI TRỘI TẠI THỜI ĐIỂM NÀY:</div>
                    <ul className="signal-hl-list">
                      {analysis.highlights.map((hl, idx) => (
                        <li key={idx}>{hl}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Snapshot toggle + grouped content */}
                {sig.snapshot && (
                  <>
                    <button
                      className="signal-snapshot-toggle font-mono"
                      onClick={() => setExpandedId(isExpanded ? null : sig.id)}
                    >
                      {isExpanded ? '▼ Ẩn bảng chỉ số chi tiết' : '▶ Xem toàn bộ bảng chỉ số chi tiết'}
                    </button>
                    {isExpanded && (
                      <div className="signal-snapshot-grouped">
                        {/* Group 1: Flow & Order Book */}
                        <div className="snap-group">
                          <div className="snap-group-title font-mono">⚡ DÒNG TIỀN &amp; SỔ LỆNH</div>
                          {['btcPrice', 'btcChange24h', 'btcVolume24h', 'cvd', 'sessionCvd', 'obiPercent', 'obSignal', 'bidWallTotal', 'askWallTotal', 'bidRatio', 'whaleWallSignal']
                            .filter(k => sig.snapshot[k] != null)
                            .map(key => (
                              <div key={key} className="signal-snap-item">
                                <span className="signal-snap-label">{SNAPSHOT_LABELS[key] || key}</span>
                                <span className="signal-snap-value">{formatSnapshotValue(key, sig.snapshot[key])}</span>
                              </div>
                            ))}
                        </div>

                        {/* Group 2: Derivatives & Sentiment */}
                        <div className="snap-group">
                          <div className="snap-group-title font-mono">📊 PHÁI SINH &amp; TÂM LÝ</div>
                          {['fundingRate', 'fundingRateRest', 'openInterest', 'openInterestRest', 'fngValue', 'fngSentiment', 'btcDominance']
                            .filter(k => sig.snapshot[k] != null)
                            .map(key => (
                              <div key={key} className="signal-snap-item">
                                <span className="signal-snap-label">{SNAPSHOT_LABELS[key] || key}</span>
                                <span className="signal-snap-value">{formatSnapshotValue(key, sig.snapshot[key])}</span>
                              </div>
                            ))}
                        </div>

                        {/* Group 3: Macro & Global */}
                        <div className="snap-group">
                          <div className="snap-group-title font-mono">🌍 KINH TẾ VĨ MÔ (MACRO)</div>
                          {['fedRate', 'cpi', 'tenYearYield', 'dxy', 'vix', 'sp500', 'netLiquidity', 'mvrv', 'highYield', 'm2Supply']
                            .filter(k => sig.snapshot[k] != null)
                            .map(key => (
                              <div key={key} className="signal-snap-item">
                                <span className="signal-snap-label">{SNAPSHOT_LABELS[key] || key}</span>
                                <span className="signal-snap-value">{formatSnapshotValue(key, sig.snapshot[key])}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
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



// ═══════════════════════════════════════════════════════════════════════════════
// Main HFT Radar Tab Component

// ═══════════════════════════════════════════════════════════════════════════════

const MemoCVDPanel = React.memo(CVDPanel);
const MemoTargetLiquidityPanelWrapper = React.memo(TargetLiquidityPanelWrapper);
const MemoOrderBookPanel = React.memo(OrderBookPanel);
const MemoAdvancedChartWrapper = React.memo(AdvancedChartWrapper);
const MemoWhaleTradesPanel = React.memo(WhaleTradesPanel);
const MemoSignalLogPanel = React.memo(SignalLogPanel);

export default function HftRadarTab({
  cvd, sessionCvd, buyVolume, sellVolume, cvdHistory, cvdHistory24h, cvdHistory7d, cvdHistory30d, cvdStatus, livePrice, whaleTrades, theme, volNodes,
  // Additional props for signal engine context
  data, fundingRate, liveChange, liveHigh, liveLow, liveVolume, liveEthPrice, liveSolPrice,
}) {
  const { isModuleHidden } = useModuleVisibility();
  const [orderBook, setOrderBook] = useState(null);
  const [whaleData, setWhaleData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [whaleGap, setWhaleGap] = useState(() => {
    const saved = localStorage.getItem('hft_whale_gap');
    return saved ? Number(saved) : 100;
  });
  const [depthLimit, setDepthLimit] = useState(() => {
    const saved = localStorage.getItem('hft-depth-limit');
    return saved ? Number(saved) : 100;
  });

  // ── Signal Log State ──────────────────────────────────────────────────────
  const [signals, setSignals] = useState([]);
  const [signalCount, setSignalCount] = useState(0);
  const signalDetectionRef = useRef(null);
  const snapshotRef = useRef(null);

  // Load signals from IndexedDB on mount
  const loadSignals = useCallback(async () => {
    const stored = await getSignals(200);
    setSignals(stored);
    setSignalCount(stored.length);
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  useEffect(() => {
    localStorage.setItem('hft-depth-limit', String(depthLimit));
  }, [depthLimit]);

  const obIntervalRef = useRef(null);
  const whaleIntervalRef = useRef(null);
  const smoothedObiRef = useRef(null);

  // Refs to hold latest values for signal engine (avoids stale closures)
  const orderBookRef = useRef(null);
  const whaleDataRef = useRef(null);

  // Fetch Order Book every 3s + Whale Walls every 12s
  useEffect(() => {
    const fetchOB = async () => {
      const data = await getOrderBookDepth('BTCUSDT', depthLimit);
      if (data) {
        if (smoothedObiRef.current === null) {
          smoothedObiRef.current = data.obiPercent;
        } else {
          // EMA smoothing with alpha = 0.15 to filter noise
          smoothedObiRef.current = (smoothedObiRef.current * 0.85) + (data.obiPercent * 0.15);
        }
        const smoothed = {
          ...data,
          obiPercent: parseFloat(smoothedObiRef.current.toFixed(1))
        };
        setOrderBook(smoothed);
        orderBookRef.current = smoothed;
      }
    };

    const fetchWhales = async () => {
      const d = await getWhaleWalls();
      if (d) {
        setWhaleData(d);
        whaleDataRef.current = d;
      }
    };

    // Initial fetch all
    const fetchAll = async () => {
      setIsLoading(true);
      await Promise.allSettled([
        fetchOB(),
        fetchWhales()
      ]);
      setIsLoading(false);
    };
    fetchAll();

    // Order book polling every 3s
    obIntervalRef.current = setInterval(fetchOB, 3000);
    // Whale walls polling every 12s
    whaleIntervalRef.current = setInterval(fetchWhales, 12000);

    return () => {
      if (obIntervalRef.current) clearInterval(obIntervalRef.current);
      if (whaleIntervalRef.current) clearInterval(whaleIntervalRef.current);
    };
  }, [depthLimit]);

  // ── Signal Detection Engine (every 30s) ──────────────────────────────────
  useEffect(() => {
    // Run signal detection every 30 seconds
    signalDetectionRef.current = setInterval(async () => {
      const ctx = {
        livePrice,
        liveChange,
        liveHigh,
        liveLow,
        liveVolume,
        liveEthPrice,
        liveSolPrice,
        cvd,
        sessionCvd,
        buyVolume,
        sellVolume,
        fundingRate,
        orderBook: orderBookRef.current,
        whaleData: whaleDataRef.current,
        data,
      };
      const newSignals = await runSignalDetection(ctx);
      if (newSignals.length > 0) {
        loadSignals(); // Refresh from DB
      }
    }, 30 * 1000);

    return () => {
      if (signalDetectionRef.current) clearInterval(signalDetectionRef.current);
    };
  }, [livePrice, liveChange, liveHigh, liveLow, liveVolume, liveEthPrice, liveSolPrice, cvd, sessionCvd, buyVolume, sellVolume, fundingRate, data, loadSignals]);

  // ── Periodic Snapshot (every 15 min) ─────────────────────────────────────
  useEffect(() => {
    // Take first snapshot after 60s, then every 15 min
    const initialTimeout = setTimeout(async () => {
      const ctx = {
        livePrice,
        liveChange,
        liveHigh,
        liveLow,
        liveVolume,
        liveEthPrice,
        liveSolPrice,
        cvd,
        sessionCvd,
        buyVolume,
        sellVolume,
        fundingRate,
        orderBook: orderBookRef.current,
        whaleData: whaleDataRef.current,
        data,
      };
      await takePeriodicSnapshot(ctx);
      loadSignals();

      // Then every 15 min
      snapshotRef.current = setInterval(async () => {
        const freshCtx = {
          livePrice,
          liveChange,
          liveHigh,
          liveLow,
          liveVolume,
          liveEthPrice,
          liveSolPrice,
          cvd,
          sessionCvd,
          buyVolume,
          sellVolume,
          fundingRate,
          orderBook: orderBookRef.current,
          whaleData: whaleDataRef.current,
          data,
        };
        await takePeriodicSnapshot(freshCtx);
        loadSignals();
      }, 15 * 60 * 1000);
    }, 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      if (snapshotRef.current) clearInterval(snapshotRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            cvdHistory24h={cvdHistory24h}
            cvdHistory7d={cvdHistory7d}
            cvdHistory30d={cvdHistory30d}
            cvdStatus={cvdStatus}
            livePrice={livePrice}
            volNodes={volNodes}
            theme={theme}
          />
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

        {!isModuleHidden('hft_signals') && (
          <MemoSignalLogPanel
            signals={signals}
            onRefresh={loadSignals}
            signalCount={signalCount}
          />
        )}

      </div>
    </div>
  );
}






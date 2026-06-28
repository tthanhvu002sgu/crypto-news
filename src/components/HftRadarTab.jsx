import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Line } from 'react-chartjs-2';

import { getOrderBookDepth, getWhaleWalls } from '../services/api';
import Tooltip, { METRIC_METADATA } from './Tooltip';
import AdvancedChart from './AdvancedChart';


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

function CVDPanel({ cvd, sessionCvd, buyVolume, sellVolume, cvdHistory, cvdHistory24h, cvdHistory7d, cvdHistory30d, cvdStatus, livePrice, theme }) {
  const [cvdTf, setCvdTf] = useState('1H');
  const totalVol = buyVolume + sellVolume;
  const buyPct = totalVol > 0 ? (buyVolume / totalVol * 100) : 50;
  const sellPct = 100 - buyPct;

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

    </div>
  );
}

// ─── PANEL 2: Target Liquidity (Whale Walls) ──────────────────────────────────

function TargetLiquidityPanel({ whaleData }) {
  if (!whaleData) {
    return (
      <div className="hft-panel glass-panel">
        <div className="hft-panel-header">
          <Tooltip content={METRIC_METADATA.whaleWalls}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
              <span className="hft-icon">🎯</span> TARGET LIQUIDITY (WHALE WALLS)
            </h3>
          </Tooltip>
        </div>
        <div className="hft-empty font-mono">Nhấn SYNC để quét các vùng thanh khoản...</div>
      </div>
    );
  }

  const { whaleBids, whaleAsks, bidWallTotal, askWallTotal, bidRatio, signal, signalCls } = whaleData;
  const sortedAsks = [...whaleAsks].sort((a, b) => b.usdValue - a.usdValue).slice(0, 10);
  const sortedBids = [...whaleBids].sort((a, b) => b.usdValue - a.usdValue).slice(0, 10);

  return (
    <div className="hft-panel glass-panel">
      <div className="hft-panel-header">
        <Tooltip content={METRIC_METADATA.whaleWalls}>
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
            <span className="hft-icon">🎯</span> TARGET LIQUIDITY (≥$500K)
          </h3>
        </Tooltip>
        <span className={`hft-signal font-mono ${signalCls}`}>{signal}</span>
      </div>

      {/* Summary */}
      <div className="whale-summary">
        <div className="whale-sum-card whale-bid-card">
          <span className="whale-sum-label font-mono">SUPPORT WALLS ({whaleBids.length})</span>
          <span className="whale-sum-value font-mono text-emerald">{fmtUsd(bidWallTotal)}</span>
        </div>
        <div className="whale-sum-card whale-ask-card">
          <span className="whale-sum-label font-mono">RESISTANCE WALLS ({whaleAsks.length})</span>
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
              {sortedAsks.map((w, i) => (
                <tr key={`ask-${i}`} className="whale-row-ask">
                  <td>
                    <span className="liq-side-tag liq-tag-long">
                      RESISTANCE
                    </span>
                  </td>
                  <td>{fmtPrice(w.price)}</td>
                  <td>{w.qty.toFixed(3)}</td>
                  <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''}>
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
              ))}
              {/* Support second */}
              {sortedBids.map((w, i) => (
                <tr key={`bid-${i}`} className="whale-row-bid">
                  <td>
                    <span className="liq-side-tag liq-tag-short">
                      SUPPORT
                    </span>
                  </td>
                  <td>{fmtPrice(w.price)}</td>
                  <td>{w.qty.toFixed(3)}</td>
                  <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''}>
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
              ))}
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
        <span className="font-mono text-slate-400" style={{ fontSize: '0.55rem', fontWeight: 600 }}>SỔ LỆNH DEPTH (OBI LEVEL)</span>
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
        <div className="hft-panel-header">
          <Tooltip content={METRIC_METADATA.obi}>
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
              <span className="hft-icon">📖</span> ORDER BOOK IMBALANCE
            </h3>
          </Tooltip>
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
        <span className={`hft-signal font-mono ${signalCls}`}>{signal}</span>
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

function WhaleTradesPanel({ whaleTrades }) {
  const [minVolume, setMinVolume] = useState(() => {
    const saved = localStorage.getItem('hft_whale_min_vol');
    return saved ? Number(saved) : 100000;
  });

  const handleVolumeChange = (e) => {
    const val = Number(e.target.value);
    setMinVolume(val);
    localStorage.setItem('hft_whale_min_vol', String(val));
  };

  const filteredTrades = (whaleTrades || []).filter(t => t.usdtVol >= minVolume);

  let buyVol = 0, buyUsd = 0;
  let sellVol = 0, sellUsd = 0;
  
  filteredTrades.forEach(t => {
    if (t.side === 'BUY') {
      buyVol += t.qty;
      buyUsd += t.usdtVol;
    } else {
      sellVol += t.qty;
      sellUsd += t.usdtVol;
    }
  });

  const avgBuyPrice = buyVol > 0 ? buyUsd / buyVol : null;
  const avgSellPrice = sellVol > 0 ? sellUsd / sellVol : null;

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header">
        <h3 className="hft-panel-title font-mono" style={{ borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">🐋</span> LIVE WHALE TRADES
        </h3>
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
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', background: 'var(--bg-slate-950)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
        <div style={{ flex: 1 }}>
          <div className="font-mono text-slate-400" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>TRUNG BÌNH GIÁ KHỚP LONG (BUY)</div>
          <div className="font-mono text-emerald" style={{ fontSize: '1rem', fontWeight: 600 }}>{avgBuyPrice ? fmtPrice(avgBuyPrice) : '---'}</div>
          <div className="font-mono text-slate-500" style={{ fontSize: '0.65rem' }}>Tổng Vol: {fmtUsd(buyUsd)}</div>
        </div>
        <div style={{ width: '1px', background: 'var(--border-panel)' }}></div>
        <div style={{ flex: 1 }}>
          <div className="font-mono text-slate-400" style={{ fontSize: '0.65rem', marginBottom: '4px' }}>TRUNG BÌNH GIÁ KHỚP SHORT (SELL)</div>
          <div className="font-mono text-rose" style={{ fontSize: '1rem', fontWeight: 600 }}>{avgSellPrice ? fmtPrice(avgSellPrice) : '---'}</div>
          <div className="font-mono text-slate-500" style={{ fontSize: '0.65rem' }}>Tổng Vol: {fmtUsd(sellUsd)}</div>
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
              {filteredTrades.map((t, i) => (
                <tr key={`${t.timestamp}-${i}`} style={{ borderBottom: '1px solid var(--border-panel)' }}>
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



// ═══════════════════════════════════════════════════════════════════════════════
// Main HFT Radar Tab Component

// ═══════════════════════════════════════════════════════════════════════════════

export default function HftRadarTab({
  cvd, sessionCvd, buyVolume, sellVolume, cvdHistory, cvdHistory24h, cvdHistory7d, cvdHistory30d, cvdStatus, livePrice, whaleTrades, theme,
}) {
  const [orderBook, setOrderBook] = useState(null);
  const [whaleData, setWhaleData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [depthLimit, setDepthLimit] = useState(() => {
    const saved = localStorage.getItem('hft-depth-limit');
    return saved ? Number(saved) : 100;
  });

  useEffect(() => {
    localStorage.setItem('hft-depth-limit', String(depthLimit));
  }, [depthLimit]);

  const obIntervalRef = useRef(null);
  const whaleIntervalRef = useRef(null);
  const smoothedObiRef = useRef(null);

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
        setOrderBook({
          ...data,
          obiPercent: parseFloat(smoothedObiRef.current.toFixed(1))
        });
      }
    };

    const fetchWhales = async () => {
      const d = await getWhaleWalls();
      if (d) setWhaleData(d);
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

  return (
    <div className="hft-radar-layout">
      <div className="hft-radar-header glass-panel">
        <h2 className="hft-radar-title font-mono">
          <span className="hft-icon-lg">🎯</span> HFT RADAR — DERIVATIVES ORDER FLOW
        </h2>
        <p className="hft-radar-desc font-mono">
          Phân tích dòng tiền phái sinh theo thời gian thực: CVD, Target Liquidity &amp; Order Book Imbalance
        </p>
      </div>

      <div className="hft-grid">
        <CVDPanel
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
          theme={theme}
        />

        <TargetLiquidityPanel whaleData={whaleData} />

        <OrderBookPanel 
          orderBook={orderBook} 
          depthLimit={depthLimit}
          setDepthLimit={setDepthLimit}
        />

        <AdvancedChart theme={theme} whaleData={whaleData} />

        <WhaleTradesPanel whaleTrades={whaleTrades} />

      </div>
    </div>
  );
}





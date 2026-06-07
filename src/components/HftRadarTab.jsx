import React, { useState, useEffect, useRef } from 'react';

import { getOrderBookDepth, getWhaleWalls } from '../services/api';
import Tooltip, { METRIC_METADATA } from './Tooltip';


// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtUsd = (n) => {
  if (n == null) return '---';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtPrice = (n) => n ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '---';

// Helper to get Chart Options based on current Theme
const getChartOptsBase = (theme) => {
  const isLight = theme === 'light';
  const gridColor = isLight ? 'rgba(71, 85, 105, 0.4)' : 'rgba(30, 41, 59, 0.4)';
  const tickColor = isLight ? '#000000' : '#94a3b8';
  const tooltipBg = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
  const tooltipBorder = isLight ? '#334155' : 'rgba(30, 41, 59, 0.8)';
  const tooltipTitle = isLight ? '#000000' : '#94a3b8';
  const tooltipBody = isLight ? '#000000' : '#e2e8f0';

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
        ticks: { color: tickColor, maxTicksLimit: 12, font: { family: 'JetBrains Mono', size: 9 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: 'JetBrains Mono', size: 9 } },
      },
    },
  };
};

// ─── PANEL 1: CVD & Order Flow ────────────────────────────────────────────────

function CVDPanel({ cvd, buyVolume, sellVolume, cvdHistory, cvdStatus, livePrice, theme }) {
  const totalVol = buyVolume + sellVolume;
  const buyPct = totalVol > 0 ? (buyVolume / totalVol * 100) : 50;
  const sellPct = 100 - buyPct;

  // Divergence detection: compares CVD trend against Price trend
  const detectDivergence = () => {
    if (cvdHistory.length < 5) return null;
    const recent = cvdHistory.slice(-5);
    const cvdDelta = recent[recent.length - 1].cvd - recent[0].cvd;
    
    // Fallback if price is not tracked inside history object
    const pStart = recent[0].price || livePrice;
    const pEnd = recent[recent.length - 1].price || livePrice;
    const priceDelta = pEnd - pStart;

    if (!pStart || !pEnd) return null;

    // Bullish Absorption: Price goes down, CVD goes up
    if (priceDelta < -10 && cvdDelta > 300000) {
      return { type: 'bullish', text: '✓ Phân kỳ BULLISH (MUA HẤP THỤ): Giá giảm nhưng CVD tăng (Taker đang hấp thụ lực bán)' };
    }
    // Bearish Absorption: Price goes up, CVD goes down
    if (priceDelta > 10 && cvdDelta < -300000) {
      return { type: 'bearish', text: '⚠ Phân kỳ BEARISH (BÁN HẤP THỤ): Giá tăng nhưng CVD giảm (Taker đang xả hàng hấp thụ lực mua)' };
    }
    // Aggressive buying momentum
    if (priceDelta > 20 && cvdDelta > 500000) {
      return { type: 'bullish-trend', text: '✓ Momentum Tăng: Lực mua chủ động áp đảo đẩy giá lên' };
    }
    // Aggressive selling momentum
    if (priceDelta < -20 && cvdDelta < -500000) {
      return { type: 'bearish-trend', text: '⚠ Momentum Giảm: Lực bán chủ động áp đảo đè giá xuống' };
    }
    return null;
  };

  const divergence = detectDivergence();

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2' }}>
      <div className="hft-panel-header">
        <Tooltip content={METRIC_METADATA.cvd}>
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
            <span className="hft-icon">📊</span> CVD &amp; ORDER FLOW
          </h3>
        </Tooltip>
        <span className={`hft-badge font-mono ${cvdStatus === 'connected' ? 'badge-live' : 'badge-off'}`}>
          {cvdStatus === 'connected' ? '⚡ aggTrade' : 'WS OFF'}
        </span>
      </div>

      {/* CVD Value */}
      <div className="cvd-hero">
        <div className="cvd-value-wrap">
          <span className="cvd-label font-mono" title="CVD tích lũy từ đầu ngày (00:00)">CVD TRONG NGÀY (INTRADAY CVD)</span>
          <span className={`cvd-value font-mono ${cvd >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {cvd >= 0 ? '+' : ''}{fmtUsd(cvd)}
          </span>
        </div>
      </div>

      {/* Volume Gauge */}
      <div className="vol-gauge-container">
        <div className="vol-gauge-labels font-mono">
          <span className="text-emerald">BUY {buyPct.toFixed(1)}%</span>
          <span className="text-slate-400">Volume Ratio</span>
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

      {/* Divergence Alert */}
      {divergence && (
        <div className={`divergence-alert ${divergence.type.startsWith('bearish') ? 'alert-bearish' : 'alert-bullish'}`}>
          <span className="font-mono">{divergence.text}</span>
        </div>
      )}
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
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
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
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
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
                  <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''}>{fmtUsd(w.usdValue)}</td>
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
                  <td className={w.usdValue >= 1e6 ? 'whale-mega' : ''}>{fmtUsd(w.usdValue)}</td>
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
            <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
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
          <h3 className="hft-panel-title font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
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



// ═══════════════════════════════════════════════════════════════════════════════
// Main HFT Radar Tab Component

// ═══════════════════════════════════════════════════════════════════════════════

export default function HftRadarTab({
  cvd, buyVolume, sellVolume, cvdHistory, cvdStatus, livePrice, theme,
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
  const smoothedObiRef = useRef(null);

  // Fetch Order Book every 3s + Whale Walls on mount
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

    // Initial fetch all
    const fetchAll = async () => {
      setIsLoading(true);
      await Promise.allSettled([
        fetchOB(),
        getWhaleWalls().then(d => { if (d) setWhaleData(d); }),
      ]);
      setIsLoading(false);
    };
    fetchAll();

    // Order book polling every 3s
    obIntervalRef.current = setInterval(fetchOB, 3000);

    return () => {
      if (obIntervalRef.current) clearInterval(obIntervalRef.current);
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
          buyVolume={buyVolume}
          sellVolume={sellVolume}
          cvdHistory={cvdHistory}
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


      </div>
    </div>
  );
}





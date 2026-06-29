import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { getBTCKlines } from '../services/api';

const BINS = 150;

function calculateVolumeProfile(klines) {
  if (!klines || klines.length === 0) return null;
  
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  
  klines.forEach(k => {
    if (k.low < minPrice) minPrice = k.low;
    if (k.high > maxPrice) maxPrice = k.high;
  });

  const binSize = (maxPrice - minPrice) / BINS;
  if (binSize === 0) return null;

  const profile = new Array(BINS).fill(0);

  // 1. Uniform Volume Distribution
  klines.forEach(k => {
    let lowBin = Math.floor((k.low - minPrice) / binSize);
    let highBin = Math.floor((k.high - minPrice) / binSize);
    
    // Bounds check
    if (lowBin < 0) lowBin = 0;
    if (highBin >= BINS) highBin = BINS - 1;
    
    const binsTouched = highBin - lowBin + 1;
    const volPerBin = k.volume / binsTouched;

    for (let b = lowBin; b <= highBin; b++) {
      profile[b] += volPerBin;
    }
  });

  let maxVol = 0;
  let pocIndex = 0;
  let totalVol = 0;

  profile.forEach((vol, i) => {
    totalVol += vol;
    if (vol > maxVol) {
      maxVol = vol;
      pocIndex = i;
    }
  });

  const pocPrice = minPrice + (pocIndex * binSize) + (binSize / 2);

  // 3. CBOT 2-bin Value Area Algorithm (70% of volume around POC)
  const targetVol = totalVol * 0.7;
  let currentVol = profile[pocIndex];
  let upIndex = pocIndex + 1;
  let downIndex = pocIndex - 1;

  while (currentVol < targetVol && (upIndex < BINS || downIndex >= 0)) {
    // Sum of next 2 bins above
    let upVol = 0;
    if (upIndex < BINS) upVol += profile[upIndex];
    if (upIndex + 1 < BINS) upVol += profile[upIndex + 1];

    // Sum of next 2 bins below
    let downVol = 0;
    if (downIndex >= 0) downVol += profile[downIndex];
    if (downIndex - 1 >= 0) downVol += profile[downIndex - 1];

    if (upVol === 0 && downVol === 0) break;

    if (upVol > downVol) {
      if (upIndex < BINS) currentVol += profile[upIndex++];
      if (upIndex < BINS && currentVol < targetVol) currentVol += profile[upIndex++];
    } else if (downVol > upVol) {
      if (downIndex >= 0) currentVol += profile[downIndex--];
      if (downIndex >= 0 && currentVol < targetVol) currentVol += profile[downIndex--];
    } else {
      // Tie, add both if possible
      if (upIndex < BINS) currentVol += profile[upIndex++];
      if (upIndex < BINS && currentVol < targetVol) currentVol += profile[upIndex++];
      if (downIndex >= 0 && currentVol < targetVol) currentVol += profile[downIndex--];
      if (downIndex >= 0 && currentVol < targetVol) currentVol += profile[downIndex--];
    }
  }

  const vahPrice = minPrice + (Math.min(upIndex, BINS - 1) * binSize) + (binSize / 2);
  const valPrice = minPrice + (Math.max(downIndex, 0) * binSize) + (binSize / 2);

  return { pocPrice, vahPrice, valPrice, profile, minPrice, maxPrice, binSize, maxVol };
}

function calculateLiqZones(klines) {
  if (!klines || klines.length < 20) return [];
  // Look for recent swing high and low
  const recent = klines.slice(-50);
  let highest = -Infinity;
  let lowest = Infinity;
  recent.forEach(k => {
    if (k.high > highest) highest = k.high;
    if (k.low < lowest) lowest = k.low;
  });

  const zones = [];
  const MM_RATE = 0.004; // 0.4% Maintenance Margin

  // Shorts (liquidated when price goes UP)
  // Formula: Entry * (1 + 1/leverage - MM)
  zones.push({ price: highest * (1 + 1/10 - MM_RATE), label: '10x Short Liq', color: '#fb7185', type: 'short' });
  zones.push({ price: highest * (1 + 1/25 - MM_RATE), label: '25x Short Liq', color: '#f43f5e', type: 'short' });
  zones.push({ price: highest * (1 + 1/50 - MM_RATE), label: '50x Short Liq', color: '#e11d48', type: 'short' });
  zones.push({ price: highest * (1 + 1/100 - MM_RATE), label: '100x Short Liq', color: '#be123c', type: 'short' });
  
  // Longs (liquidated when price goes DOWN)
  // Formula: Entry * (1 - 1/leverage + MM)
  zones.push({ price: lowest * (1 - 1/10 + MM_RATE), label: '10x Long Liq', color: '#34d399', type: 'long' });
  zones.push({ price: lowest * (1 - 1/25 + MM_RATE), label: '25x Long Liq', color: '#10b981', type: 'long' });
  zones.push({ price: lowest * (1 - 1/50 + MM_RATE), label: '50x Long Liq', color: '#059669', type: 'long' });
  zones.push({ price: lowest * (1 - 1/100 + MM_RATE), label: '100x Long Liq', color: '#047857', type: 'long' });

  return zones;
}

export default function AdvancedChart({ theme = 'dark', whaleData }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const pocLineRef = useRef(null);
  const vahLineRef = useRef(null);
  const valLineRef = useRef(null);
  const liqLinesRef = useRef([]);
  const wallLinesRef = useRef([]);
  const wsRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [vpData, setVpData] = useState(null);
  const [klines, setKlines] = useState(null);
  const [showWalls, setShowWalls] = useState(true);
  const [showLiq, setShowLiq] = useState(true);

  useEffect(() => {
    const isLight = theme === 'light';
    const bg = isLight ? '#ffffff' : '#121214';
    const textColor = isLight ? '#333333' : '#d1d5db';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';

    if (!chartRef.current && chartContainerRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: textColor,
        },
        grid: {
          vertLines: { color: gridColor },
          horzLines: { color: gridColor },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: gridColor,
        },
        timeScale: {
          borderColor: gridColor,
          timeVisible: true,
        },
        autoSize: true,
      });

      const mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#f43f5e',
        borderDownColor: '#f43f5e',
        borderUpColor: '#10b981',
        wickDownColor: '#f43f5e',
        wickUpColor: '#10b981',
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      chartRef.current = chart;
      seriesRef.current = mainSeries;
      volumeSeriesRef.current = volumeSeries;
    } else if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: { textColor: textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } }
      });
    }
  }, [theme]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      // Fetch 1h klines
      const rawKlines = await getBTCKlines('BTCUSDT', '1h', 150);
      
      let formatted = rawKlines.map(k => ({
        time: Math.floor(k.time.getTime() / 1000),
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));

      // Lightweight-charts requires strictly ascending unique times
      formatted.sort((a, b) => a.time - b.time);
      formatted = formatted.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

      let volumeData = rawKlines.map(k => ({
        time: Math.floor(k.time.getTime() / 1000),
        value: k.volume,
        color: k.close >= k.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'
      }));

      volumeData.sort((a, b) => a.time - b.time);
      volumeData = volumeData.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

      if (seriesRef.current && volumeSeriesRef.current) {
        seriesRef.current.setData(formatted);
        volumeSeriesRef.current.setData(volumeData);
      }

      // Compute VP
      const vp = calculateVolumeProfile(rawKlines);
      setVpData(vp);
      setKlines(rawKlines);
      setLoading(false);

      // Start realtime WebSocket updates
      if (wsRef.current) wsRef.current.close();
      wsRef.current = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1h');
      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const k = message.k;
          if (k && seriesRef.current && volumeSeriesRef.current) {
            const time = Math.floor(k.t / 1000);
            const open = parseFloat(k.o);
            const high = parseFloat(k.h);
            const low = parseFloat(k.l);
            const close = parseFloat(k.c);
            const volume = parseFloat(k.v);
            const color = close >= open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)';
            
            seriesRef.current.update({ time, open, high, low, close });
            volumeSeriesRef.current.update({ time, value: volume, color });
          }
        } catch (e) {
          console.error('[AdvancedChart] WS Error:', e);
        }
      };
    }
    loadData();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !klines) return;

    // Clean up existing lines
    if (pocLineRef.current) { seriesRef.current.removePriceLine(pocLineRef.current); pocLineRef.current = null; }
    if (vahLineRef.current) { seriesRef.current.removePriceLine(vahLineRef.current); vahLineRef.current = null; }
    if (valLineRef.current) { seriesRef.current.removePriceLine(valLineRef.current); valLineRef.current = null; }
    
    liqLinesRef.current.forEach(l => seriesRef.current.removePriceLine(l));
    liqLinesRef.current = [];

    wallLinesRef.current.forEach(l => seriesRef.current.removePriceLine(l));
    wallLinesRef.current = [];

    const vp = calculateVolumeProfile(klines);
    if (vp) {
      pocLineRef.current = seriesRef.current.createPriceLine({
        price: vp.pocPrice,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'POC',
      });

      vahLineRef.current = seriesRef.current.createPriceLine({
        price: vp.vahPrice,
        color: 'rgba(251, 191, 36, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: 'VAH',
      });

      valLineRef.current = seriesRef.current.createPriceLine({
        price: vp.valPrice,
        color: 'rgba(251, 191, 36, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: 'VAL',
      });
    }

    if (showLiq) {
      const liqZones = calculateLiqZones(klines);
      liqZones.forEach(z => {
        const line = seriesRef.current.createPriceLine({
          price: z.price,
          color: z.color,
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          axisLabelVisible: true,
          title: z.label,
        });
        liqLinesRef.current.push(line);
      });
    }

    if (showWalls && whaleData) {
      const fmtWallUsd = (val) => {
        if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
        if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
        return `$${val.toFixed(0)}`;
      };

      const currentPrice = klines[klines.length - 1]?.close || 0;
      const topBids = (whaleData.whaleBids || [])
        .filter(w => !currentPrice || (w.avgPrice || w.price) <= currentPrice)
        .slice(0, 3);
      const topAsks = (whaleData.whaleAsks || [])
        .filter(w => !currentPrice || (w.avgPrice || w.price) >= currentPrice)
        .slice(0, 3);

      topBids.forEach(w => {
        const line = seriesRef.current.createPriceLine({
          price: w.avgPrice || w.price,
          color: '#38bdf8',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: w.count > 1 ? `🛡️ Bid Wall (${fmtWallUsd(w.usdValue)} ⚡${w.count})` : `🛡️ Bid Wall (${fmtWallUsd(w.usdValue)})`,
        });
        wallLinesRef.current.push(line);
      });

      topAsks.forEach(w => {
        const line = seriesRef.current.createPriceLine({
          price: w.avgPrice || w.price,
          color: '#c084fc',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: w.count > 1 ? `🛡️ Ask Wall (${fmtWallUsd(w.usdValue)} ⚡${w.count})` : `🛡️ Ask Wall (${fmtWallUsd(w.usdValue)})`,
        });
        wallLinesRef.current.push(line);
      });
    }
  }, [klines, whaleData, showWalls, showLiq]);

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2', position: 'relative', height: '520px', display: 'flex', flexDirection: 'column' }}>
      <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 className="hft-panel-title font-mono" style={{ borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">📊</span> ADVANCED PRICE ACTION: POC, WALLS & LIQUIDATIONS
        </h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setShowWalls(!showWalls)}
            className="font-mono"
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: showWalls ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              color: showWalls ? '#38bdf8' : 'var(--text-slate-400)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🎯 Limit Walls {showWalls ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setShowLiq(!showLiq)}
            className="font-mono"
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: showLiq ? 'rgba(244, 63, 94, 0.2)' : 'transparent',
              color: showLiq ? '#f43f5e' : 'var(--text-slate-400)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🔥 Liq Zones {showLiq ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      
      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      
      <div style={{ flexGrow: 1, position: 'relative', marginTop: '10px' }}>
        <div ref={chartContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      </div>

      <div className="hft-empty font-mono" style={{ marginTop: '12px', fontSize: '0.7rem', lineHeight: 1.6 }}>
        <span style={{color: '#fbbf24'}}>POC</span>: Khối lượng lớn nhất |{' '}
        <span style={{color: '#38bdf8'}}>🛡️ Bid Wall</span> / <span style={{color: '#c084fc'}}>🛡️ Ask Wall</span>: Top tường mua/bán khủng ($\ge \$500K$) |{' '}
        <span style={{color: '#f43f5e'}}>Short Liq</span> / <span style={{color: '#10b981'}}>Long Liq</span>: Vùng ước tính quét thanh lý đòn bẩy cao.
      </div>
    </div>
  );
}

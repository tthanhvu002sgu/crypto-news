import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { getBTCKlines } from '../services/api';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';

const BINS = 150;

// ─── Helper: format USD values compactly ───────────────────────────────────────
const fmtWallUsdCompact = (val) => {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

const fmtPriceCompact = (price) => {
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return price.toFixed(2);
};

class HeatmapWallPrimitive {
  constructor() {
    this._walls = [];
    this._series = null;
    this._requestUpdate = null;
    this._options = { wallWidthPct: 35 };
  }
  setOptions(opts) {
    this._options = { ...this._options, ...opts };
    if (this._requestUpdate) this._requestUpdate();
  }
  attached({ series, requestUpdate }) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._series = null;
  }
  setData(walls) {
    this._walls = walls || [];
    if (this._requestUpdate) this._requestUpdate();
  }
  updateAllViews() {}
  paneViews() {
    return [{
      zOrder: () => 'bottom',
      renderer: () => ({
        draw: (target) => {
          if (!this._series || !this._walls || !this._walls.length) return;
          target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            const width = mediaSize.width;
            const height = mediaSize.height;
            context.save();

            // ── Global max USD across all sub-levels for normalization ──
            let maxUsd = 1;
            this._walls.forEach(w => {
              if (w.subLevels && w.subLevels.length) {
                w.subLevels.forEach(sub => {
                  if (sub.usdValue > maxUsd) maxUsd = sub.usdValue;
                });
              } else if (w.usdValue > maxUsd) {
                maxUsd = w.usdValue;
              }
            });

            // ── Render each wall cluster ────────────────────────────────
            this._walls.forEach(w => {
              const yMax = this._series.priceToCoordinate(w.maxPrice || w.price || 0);
              const yMin = this._series.priceToCoordinate(w.minPrice || w.price || 0);
              if (yMax === null || yMin === null) return;

              let topY = Math.min(yMax, yMin);
              let bottomY = Math.max(yMax, yMin);
              const clusterHeight = bottomY - topY;
              if (clusterHeight < 24) {
                const center = (topY + bottomY) / 2;
                topY = center - 12;
                bottomY = center + 12;
              }

              const isBid = w.side === 'BID';
              const baseR = isBid ? 56 : 192;
              const baseG = isBid ? 189 : 132;
              const baseB = isBid ? 248 : 252;
              const accentR = isBid ? 14 : 217;
              const accentG = isBid ? 165 : 70;
              const accentB = isBid ? 233 : 239;
              const borderColor = `rgba(${baseR}, ${baseG}, ${baseB}, 0.55)`;
              const labelColor = `rgba(${baseR}, ${baseG}, ${baseB}, 0.85)`;

              // ── 1. Calculate Peak Sub-level ───────────────────────────
              let peakSub = null;
              let peakSubY = null;
              let peakBarW = 0;

              const MAX_BAR_WIDTH = width * (this._options.wallWidthPct / 100); // Maximum width of the histogram bar

              // Handle sub-levels
              if (w.subLevels && w.subLevels.length > 0) {
                const subHeight = Math.max(3, Math.min(14, clusterHeight / w.subLevels.length));

                // Find peak sub-level
                let peakVal = 0;
                w.subLevels.forEach(sub => {
                  if (sub.usdValue > peakVal) {
                    peakVal = sub.usdValue;
                    peakSub = sub;
                  }
                });

                // Draw horizontal bars (Depth Histogram)
                w.subLevels.forEach(sub => {
                  const subY = this._series.priceToCoordinate(sub.price);
                  if (subY !== null && subY >= -30 && subY <= height + 30) {
                    const ratio = Math.min(1, Math.max(0.05, sub.usdValue / maxUsd));
                    const barW = ratio * MAX_BAR_WIDTH;
                    const isPeak = peakSub && sub.price === peakSub.price;
                    
                    const alpha = isPeak ? 0.7 : 0.35;
                    const barH = isPeak ? Math.max(subHeight, 6) : subHeight;
                    
                    context.fillStyle = `rgba(${accentR}, ${accentG}, ${accentB}, ${alpha})`;
                    context.fillRect(width - barW, subY - barH / 2, barW, barH);

                    if (isPeak) {
                      peakSubY = subY;
                      peakBarW = barW;
                    }
                  }
                });
              } else {
                // Single-level wall (no sub-levels)
                const center = (topY + bottomY) / 2;
                const ratio = Math.min(1, Math.max(0.1, (w.usdValue || 0) / maxUsd));
                const barW = ratio * MAX_BAR_WIDTH;
                const alpha = 0.5;
                
                context.fillStyle = `rgba(${accentR}, ${accentG}, ${accentB}, ${alpha})`;
                context.fillRect(width - barW, center - 6, barW, 12);

                peakSubY = center;
                peakBarW = barW;
                peakSub = { price: w.avgPrice || w.price, usdValue: w.usdValue };
              }

              // ── 2. Peak Volume Label (Pill style) ─────────────────────
              if (peakSub && peakSubY !== null && peakSubY >= -10 && peakSubY <= height + 10) {
                const priceText = fmtPriceCompact(peakSub.price);
                const usdText = fmtWallUsdCompact(peakSub.usdValue);
                const labelText = `${priceText} | ${usdText}`;
                
                context.font = 'bold 10px monospace';
                const textW = context.measureText(labelText).width;
                const padX = 6;
                const padY = 4;
                const pillW = textW + padX * 2;
                const pillH = 16;
                
                // Position label just to the left of the peak bar
                const pillX = width - peakBarW - pillW - 4;
                const pillY = peakSubY - pillH / 2;

                // Background pill
                context.fillStyle = isBid ? 'rgba(14, 165, 233, 0.85)' : 'rgba(168, 85, 247, 0.85)';
                context.beginPath();
                context.roundRect(pillX, pillY, pillW, pillH, 4);
                context.fill();

                // Text
                context.fillStyle = '#ffffff';
                context.textAlign = 'left';
                context.textBaseline = 'middle';
                context.fillText(labelText, pillX + padX, peakSubY);
                
                // Small connection triangle
                context.fillStyle = isBid ? 'rgba(14, 165, 233, 0.85)' : 'rgba(168, 85, 247, 0.85)';
                context.beginPath();
                context.moveTo(pillX + pillW, peakSubY - 4);
                context.lineTo(pillX + pillW + 4, peakSubY);
                context.lineTo(pillX + pillW, peakSubY + 4);
                context.closePath();
                context.fill();
              }
            });
            context.restore();
          });
        }
      })
    }];
  }
}

class TPOPrimitive {
  constructor() {
    this._data = [];
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
    this._options = { mode: 'off' }; // 'off', 'blocks', 'letters'
  }
  setOptions(opts) {
    this._options = { ...this._options, ...opts };
    if (this._requestUpdate) this._requestUpdate();
  }
  setChart(chart) {
    this._chart = chart;
  }
  attached({ series, requestUpdate }) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }
  detached() {
    this._series = null;
  }
  setData(klines) {
    this._data = klines || [];
    if (this._requestUpdate) this._requestUpdate();
  }
  updateAllViews() {}
  paneViews() {
    return [{
      zOrder: () => 'bottom',
      renderer: () => ({
        draw: (target) => {
          if (!this._series || !this._chart || !this._data.length || this._options.mode === 'off') return;
          
          target.useMediaCoordinateSpace(({ context }) => {
            context.save();
            
            // Group klines by Day (UTC)
            const sessions = {};
            let globalMin = Infinity;
            let globalMax = -Infinity;

            this._data.forEach(k => {
              if (k.low < globalMin) globalMin = k.low;
              if (k.high > globalMax) globalMax = k.high;
              const date = new Date(k.time * 1000);
              const dayStr = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
              if (!sessions[dayStr]) sessions[dayStr] = [];
              sessions[dayStr].push(k);
            });

            // Bin size: dynamically calculate based on visible range or fixed.
            const binSize = Math.max((globalMax - globalMin) / 150, 10);
            if (binSize <= 0 || !isFinite(binSize)) { context.restore(); return; }

            const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
            const isLettersMode = this._options.mode === 'letters';
            const blockWidth = isLettersMode ? 8 : 4;
            const blockHeight = isLettersMode ? 10 : 4;
            const timeScale = this._chart.timeScale();

            Object.values(sessions).forEach(sessionKlines => {
              if (!sessionKlines.length) return;
              sessionKlines.sort((a,b) => a.time - b.time);
              
              const firstTime = sessionKlines[0].time;
              let xCoordinate = timeScale.timeToCoordinate(firstTime);
              if (xCoordinate === null) return; // Still offscreen or error

              const profile = {};
              let maxLen = 0;
              let pocBin = null;

              sessionKlines.forEach((k, idx) => {
                const char = LETTERS[idx % LETTERS.length];
                const startBin = Math.floor((k.low - globalMin) / binSize);
                const endBin = Math.floor((k.high - globalMin) / binSize);
                
                for (let b = startBin; b <= endBin; b++) {
                  if (!profile[b]) profile[b] = [];
                  profile[b].push({ char, klineTime: k.time });
                  if (profile[b].length > maxLen) {
                    maxLen = profile[b].length;
                    pocBin = b;
                  }
                }
              });

              // Draw POC background
              if (pocBin !== null) {
                 const pocPrice = globalMin + pocBin * binSize + binSize / 2;
                 const y = this._series.priceToCoordinate(pocPrice);
                 if (y !== null) {
                    context.fillStyle = 'rgba(251, 191, 36, 0.2)'; // amber-400 with opacity
                    context.fillRect(xCoordinate, y - blockHeight / 2, profile[pocBin].length * blockWidth, blockHeight);
                 }
              }

              // Draw TPO blocks
              Object.keys(profile).forEach(b => {
                const binIdx = parseInt(b);
                const priceCenter = globalMin + binIdx * binSize + binSize / 2;
                const yCoordinate = this._series.priceToCoordinate(priceCenter);
                if (yCoordinate === null) return;
                
                const items = profile[binIdx];
                items.forEach((item, i) => {
                  const drawX = xCoordinate + i * blockWidth;
                  const colorIdx = LETTERS.indexOf(item.char);
                  const ratio = Math.min(1, colorIdx / 48); // max 48 periods in a day
                  // Gradient from blue to purple
                  const r = Math.floor(56 + (168 - 56) * ratio);
                  const g = Math.floor(189 - (189 - 85) * ratio);
                  const b_col = Math.floor(248 - (248 - 247) * ratio);
                  
                  if (!isLettersMode) {
                    context.fillStyle = `rgba(${r}, ${g}, ${b_col}, 0.8)`;
                    context.fillRect(drawX, yCoordinate - blockHeight / 2, blockWidth - 1, blockHeight - 1);
                  } else {
                    context.fillStyle = `rgba(${r}, ${g}, ${b_col}, 0.9)`;
                    context.font = 'bold 9px monospace';
                    context.textAlign = 'left';
                    context.textBaseline = 'middle';
                    context.fillText(item.char, drawX, yCoordinate);
                  }
                });
              });
            });

            context.restore();
          });
        }
      })
    }];
  }
}

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

function AdvancedChart({ theme = 'dark', whaleData, moduleId, children }) {
  const { isModuleHidden } = useModuleVisibility();
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const pocLineRef = useRef(null);
  const vahLineRef = useRef(null);
  const valLineRef = useRef(null);
  const liqLinesRef = useRef([]);
  const wallLinesRef = useRef([]);
  const wallPrimitiveRef = useRef(null);
  const tpoPrimitiveRef = useRef(null);
  const wsRef = useRef(null);
  const autoScrollRef = useRef(true);
  const latestPriceRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [, setVpData] = useState(null);
  const [klines, setKlines] = useState(null);
  const [showWalls, setShowWalls] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [tpoMode, setTpoMode] = useState('off');
  const [autoScroll, setAutoScroll] = useState(true);
  const [wallTick, setWallTick] = useState(0);

  // Settings state
  const [wallWidth, setWallWidth] = useState(() => parseInt(localStorage.getItem('hft_wall_width')) || 35);
  const [rightOffset, setRightOffset] = useState(() => parseInt(localStorage.getItem('hft_right_offset')) || 120);

  // Apply Wall Width dynamically
  useEffect(() => {
    if (wallPrimitiveRef.current) {
      wallPrimitiveRef.current.setOptions({ wallWidthPct: wallWidth });
    }
  }, [wallWidth]);

  // Apply Right Offset dynamically
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({ rightOffset: rightOffset });
    }
  }, [rightOffset]);

  useEffect(() => {
    if (tpoPrimitiveRef.current) {
      tpoPrimitiveRef.current.setOptions({ mode: tpoMode });
    }
  }, [tpoMode]);

  // Wall reset cycle (500ms) to ensure limit walls update promptly
  useEffect(() => {
    let interval;
    if (showWalls) {
      interval = setInterval(() => setWallTick(t => t + 1), 500);
    }
    return () => clearInterval(interval);
  }, [showWalls]);

  const handleWallWidthChange = (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 0;
    setWallWidth(val);
    localStorage.setItem('hft_wall_width', val);
  };

  const handleRightOffsetChange = (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 0;
    setRightOffset(val);
    localStorage.setItem('hft_right_offset', val);
  };

  useEffect(() => {
    const isLight = theme === 'light';
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
          shiftVisibleRangeOnNewBar: true,
          rightOffset: rightOffset,
        },
        autoSize: true,
      });

      const isLight = theme === 'light';
      const mainSeries = chart.addSeries(LineSeries, {
        color: isLight ? '#000000' : '#ffffff',
        lineWidth: 2,
        crosshairMarkerVisible: true,
      });

      chartRef.current = chart;
      seriesRef.current = mainSeries;

      const heatmapPrimitive = new HeatmapWallPrimitive();
      mainSeries.attachPrimitive(heatmapPrimitive);
      wallPrimitiveRef.current = heatmapPrimitive;

      const tpoPrimitive = new TPOPrimitive();
      mainSeries.attachPrimitive(tpoPrimitive);
      tpoPrimitive.setChart(chart);
      tpoPrimitiveRef.current = tpoPrimitive;
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
      // Fetch 30m klines
      const rawKlines = await getBTCKlines('BTCUSDT', '30m', 300);
      
      let formatted = rawKlines.map(k => ({
        time: Math.floor(k.time.getTime() / 1000),
        value: k.close,
      }));

      // Lightweight-charts requires strictly ascending unique times
      formatted.sort((a, b) => a.time - b.time);
      formatted = formatted.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

      if (seriesRef.current) {
        seriesRef.current.setData(formatted);
        if (chartRef.current && autoScrollRef.current) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      }

      // Compute VP
      const vp = calculateVolumeProfile(rawKlines);
      setVpData(vp);
      setKlines(rawKlines);
      if (rawKlines.length > 0) {
        latestPriceRef.current = rawKlines[rawKlines.length - 1].close;
      }
      setLoading(false);

      if (tpoPrimitiveRef.current) {
        tpoPrimitiveRef.current.setData(rawKlines);
      }

      // Start realtime WebSocket updates
      if (wsRef.current) wsRef.current.close();
      wsRef.current = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_30m');
      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const k = message.k;
          if (k && seriesRef.current) {
            const time = Math.floor(k.t / 1000);
            const close = parseFloat(k.c);
            
            latestPriceRef.current = close;
            seriesRef.current.update({ time, value: close });
            if (autoScrollRef.current && chartRef.current) {
              chartRef.current.timeScale().scrollToRealTime();
            }
            if (tpoPrimitiveRef.current) {
              // trigger a redraw if needed, or we might need to append data.
              // For simplicity, lightweight-charts requests updates automatically when series updates.
            }
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
    if (pocLineRef.current) { try { seriesRef.current.removePriceLine(pocLineRef.current); } catch(e) {} pocLineRef.current = null; }
    if (vahLineRef.current) { try { seriesRef.current.removePriceLine(vahLineRef.current); } catch(e) {} vahLineRef.current = null; }
    if (valLineRef.current) { try { seriesRef.current.removePriceLine(valLineRef.current); } catch(e) {} valLineRef.current = null; }
    
    liqLinesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch(e) {} });
    liqLinesRef.current = [];

    wallLinesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch(e) {} });
    wallLinesRef.current = [];
    if (wallPrimitiveRef.current) wallPrimitiveRef.current.setData([]);

    const vp = calculateVolumeProfile(klines);
    if (vp) {
      pocLineRef.current = seriesRef.current.createPriceLine({
        price: vp.pocPrice,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
        title: `POC ${fmtPriceCompact(vp.pocPrice)}`,
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
          axisLabelVisible: false,
          title: `${fmtPriceCompact(z.price)} | ${z.label}`,
        });
        liqLinesRef.current.push(line);
      });
    }
  }, [klines, showLiq]);

  // Handle Limit Walls independently with its own reset tick
  useEffect(() => {
    if (!seriesRef.current) return;

    wallLinesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch(e) {} });
    wallLinesRef.current = [];
    if (wallPrimitiveRef.current) wallPrimitiveRef.current.setData([]);

    if (showWalls && whaleData) {
      const fmtWallUsd = (val) => {
        if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
        if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
        return `$${val.toFixed(0)}`;
      };

      const currentPrice = latestPriceRef.current || (klines && klines.length > 0 ? klines[klines.length - 1].close : 0);
      const topBids = (whaleData.whaleBids || [])
        .filter(w => !currentPrice || (w.avgPrice || w.price) <= currentPrice)
        .slice(0, 3);
      const topAsks = (whaleData.whaleAsks || [])
        .filter(w => !currentPrice || (w.avgPrice || w.price) >= currentPrice)
        .slice(0, 3);

      topBids.forEach(w => {
        const avgP = w.avgPrice || w.price;
        const line = seriesRef.current.createPriceLine({
          price: avgP,
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `${fmtPriceCompact(avgP)} | ${fmtWallUsd(w.usdValue)} | [${w.count || 1}]`,
        });
        wallLinesRef.current.push(line);
      });

      topAsks.forEach(w => {
        const avgP = w.avgPrice || w.price;
        const line = seriesRef.current.createPriceLine({
          price: avgP,
          color: '#c084fc',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: `${fmtPriceCompact(avgP)} | ${fmtWallUsd(w.usdValue)} | [${w.count || 1}]`,
        });
        wallLinesRef.current.push(line);
      });

      if (wallPrimitiveRef.current) {
        wallPrimitiveRef.current.setData([...topBids, ...topAsks]);
      }
    }
  }, [whaleData, showWalls, wallTick, klines]);

  if (moduleId && isModuleHidden(moduleId)) return null;

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2', position: 'relative', minHeight: '520px', height: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div className="hft-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 className="hft-panel-title font-mono" style={{ borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">📊</span> ADVANCED PRICE ACTION: POC, WALLS & LIQUIDATIONS
        </h3>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Settings Inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-panel)' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)' }} title="Tỉ lệ % chiều rộng của vùng Limit Wall">WALL WIDTH:</span>
            <input 
              type="number" 
              value={wallWidth} 
              onChange={handleWallWidthChange} 
              style={{ width: '35px', background: 'transparent', border: 'none', color: 'var(--text-slate-200)', fontSize: '0.7rem', outline: 'none', textAlign: 'right' }} 
              min="10" max="100" 
            />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-slate-500)' }}>%</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-panel)' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)' }} title="Khoảng cách từ nến hiện tại đến lề phải (đơn vị: số nến)">OFFSET:</span>
            <input 
              type="number" 
              value={rightOffset} 
              onChange={handleRightOffsetChange} 
              style={{ width: '35px', background: 'transparent', border: 'none', color: 'var(--text-slate-200)', fontSize: '0.7rem', outline: 'none', textAlign: 'right' }} 
              min="0" max="300" 
            />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-slate-500)' }}>BARS</span>
          </div>
          <button
            onClick={() => {
              if (chartRef.current) {
                chartRef.current.timeScale().scrollToRealTime();
              }
            }}
            className="font-mono"
            title="Cuộn ngay đến nến mới nhất"
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            ⏩ Nến mới nhất
          </button>
          <button
            onClick={() => {
              const nextVal = !autoScroll;
              setAutoScroll(nextVal);
              autoScrollRef.current = nextVal;
              if (nextVal && chartRef.current) {
                chartRef.current.timeScale().scrollToRealTime();
              }
            }}
            className="font-mono"
            title="Tự động bám sát theo nến realtime"
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: autoScroll ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
              color: autoScroll ? '#fbbf24' : 'var(--text-slate-400)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            ⚡ Auto Scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
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
          <button
            onClick={() => setTpoMode(prev => prev === 'off' ? 'blocks' : prev === 'blocks' ? 'letters' : 'off')}
            className="font-mono"
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              borderRadius: '4px',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              background: tpoMode !== 'off' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
              color: tpoMode !== 'off' ? '#a855f7' : 'var(--text-slate-400)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🧩 TPO: {tpoMode.toUpperCase()}
          </button>
          {moduleId && <ModuleMenu moduleId={moduleId} />}
        </div>
      </div>
      
      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      
      <div style={{ flex: 1, width: '100%', position: 'relative', minHeight: '400px' }}>
        <div ref={chartContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              autoScrollRef.current = true;
              if (chartRef.current) {
                chartRef.current.timeScale().scrollToRealTime();
              }
            }}
            className="font-mono"
            style={{
              position: 'absolute',
              bottom: '16px',
              right: '68px',
              zIndex: 10,
              padding: '5px 12px',
              fontSize: '0.72rem',
              borderRadius: '20px',
              border: '1px solid #10b981',
              background: 'rgba(16, 185, 129, 0.95)',
              color: '#ffffff',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
              fontWeight: 600
            }}
          >
            ⏩ Đến nến mới nhất
          </button>
        )}
      </div>

      <div className="hft-empty font-mono" style={{ marginTop: '12px', fontSize: '0.7rem', lineHeight: 1.6 }}>
        <span style={{color: '#38bdf8'}}>Limit Walls</span>: Chiều dài các thanh ngang thể hiện khối lượng lệnh chờ khớp (Bid/Ask) tại mỗi mức giá.{' '}
        <span style={{background: 'rgba(168, 85, 247, 0.85)', color: '#fff', padding: '2px 6px', borderRadius: '4px', margin: '0 4px', display: 'inline-block'}}>63,000 | $1M</span>:{' '}
        Nhãn hiển thị <span style={{color: '#fbbf24'}}>Mức giá</span> có thanh khoản lớn nhất | <span style={{color: '#fbbf24'}}>Tổng USD</span> chờ khớp tại cụm đó.
        <span style={{color: '#a855f7', marginLeft: '8px'}}>TPO Profile</span>: Biểu đồ thời gian - giá theo ngày (Blocks/Letters). POC của ngày có màu vàng mờ.
      </div>
      {children}
    </div>
  );
}

export default React.memo(AdvancedChart);

import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { getBTCKlines } from '../services/api';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import { emitCrosshair } from '../services/crosshairSync';

const BINS = 150;

const HOVER_TOLERANCE_PX = 6;
const ALERT_TOUCH_PCT = 0.0015; // 0.15% quanh mốc
const ALERT_COOLDOWN_MS = 2 * 60 * 1000;
const WALL_NEW_MS = 45 * 1000;
const WALL_OLD_MS = 5 * 60 * 1000;

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

// ─── Volume Bubble Primitive: Robust Z-Score + Price Impact + NMS ────────────
class VolumeBubblePrimitive {
  constructor() {
    this._data = [];
    this._series = null;
    this._chart = null;
    this._requestUpdate = null;
    this._options = {
      show: false,
      rollingPeriod: 60,    // N candles for median/MAD and ATR
      robustZMin: 2.5,      // Minimum robust Z-Score
      cooldownBars: 3,      // Non-maximum suppression window
    };
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

  // ── Pre-compute rolling median, MAD, and filter passes ──────────────
  _computeAnomalies() {
    const data = this._data;
    const n = data.length;
    const { rollingPeriod, robustZMin, cooldownBars } = this._options;
    if (n < rollingPeriod + 1) return [];

    const candidates = [];

    for (let i = rollingPeriod; i < n; i++) {
      const candle = data[i];
      // Only process closed candles or fallback if isClosed is missing (for safety)
      if (candle.isClosed === false) continue;
      
      const qVol = candle.quoteVolume || candle.volume; // Fallback to base volume if quote not available
      if (!qVol || qVol <= 0) continue;

      // 1. Calculate log1p quote volume for the window [i - rollingPeriod .. i - 1]
      const windowLogs = [];
      let trueRangeSum = 0;
      for (let j = i - rollingPeriod; j < i; j++) {
        const c = data[j];
        const v = c.quoteVolume || c.volume;
        windowLogs.push(Math.log1p(v));

        // Calculate True Range for ATR
        const prevC = data[j-1] ? data[j-1].close : c.open;
        const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC), Math.abs(c.low - prevC));
        trueRangeSum += tr;
      }

      windowLogs.sort((a, b) => a - b);
      const medianX = windowLogs[Math.floor(rollingPeriod / 2)];

      const absDeviations = windowLogs.map(x => Math.abs(x - medianX)).sort((a, b) => a - b);
      let mad = absDeviations[Math.floor(rollingPeriod / 2)];
      if (mad < 1e-6) mad = 1e-6; // Epsilon

      const currentLog = Math.log1p(qVol);
      const robustZ = (currentLog - medianX) / (1.4826 * mad);

      if (robustZ < robustZMin) continue;

      // 2. Price Impact Filter (Displacement vs ATR)
      const atr = trueRangeSum / rollingPeriod;
      const displacement = atr > 0 ? Math.abs(candle.close - candle.open) / atr : 0;
      
      // Classify Type
      // High volume + High displacement (> 0.5) -> Initiative
      // High volume + Low displacement (<= 0.5) -> Absorption
      const type = displacement > 0.5 ? 'initiative' : 'absorption';

      // 3. Taker Volume Delta Ratio
      let deltaRatio = 0;
      if (candle.takerBuyQuoteVolume !== undefined && candle.quoteVolume !== undefined) {
        const takerBuy = candle.takerBuyQuoteVolume;
        const takerSell = candle.quoteVolume - takerBuy;
        const delta = takerBuy - takerSell;
        deltaRatio = delta / candle.quoteVolume; // range [-1, 1]
      } else {
        // Fallback for base volume if missing quote
        deltaRatio = candle.close >= candle.open ? 0.5 : -0.5;
      }

      candidates.push({ idx: i, robustZ, type, deltaRatio, candle });
    }

    // 4. Non-Maximum Suppression (NMS) to remove clusters
    const anomalies = [];
    for (const cand of candidates) {
      if (anomalies.length === 0) {
        anomalies.push(cand);
        continue;
      }
      
      const lastCand = anomalies[anomalies.length - 1];
      if (cand.idx - lastCand.idx < cooldownBars) {
        // In the same cluster, keep the stronger one
        if (cand.robustZ > lastCand.robustZ) {
          anomalies[anomalies.length - 1] = cand;
        }
      } else {
        anomalies.push(cand);
      }
    }

    return anomalies;
  }

  paneViews() {
    return [{
      zOrder: () => 'normal',
      renderer: () => ({
        draw: (target) => {
          if (!this._series || !this._chart || !this._data.length || !this._options.show) return;
          target.useMediaCoordinateSpace(({ context }) => {
            context.save();
            const timeScale = this._chart.timeScale();
            const anomalies = this._computeAnomalies();

            for (const a of anomalies) {
              const candle = this._data[a.idx];
              const timeSec = Math.floor(candle.time.getTime() / 1000);
              const x = timeScale.timeToCoordinate(timeSec);
              if (x === null) continue;

              // Position bubble at the tip of the candle
              const isGreen = candle.close >= candle.open;
              const priceY = isGreen ? candle.high : candle.low;
              const y = this._series.priceToCoordinate(priceY);
              if (y === null) continue;

              // Continuous Radius Calculation
              const radius = 5 + 7 * Math.sqrt(Math.max(0, a.robustZ - 2.5));
              
              // Color based on Delta Ratio
              let r, g, b;
              if (a.deltaRatio > 0.1) {
                r = 14; g = 165; b = 233; // Sky blue (Buy Dominated)
              } else if (a.deltaRatio < -0.1) {
                r = 239; g = 68; b = 68; // Red (Sell Dominated)
              } else {
                r = 251; g = 191; b = 36; // Amber (Neutral)
              }
              
              const coreAlpha = Math.min(0.85, 0.4 + a.robustZ * 0.05);

              // Outer glow halo
              if (a.robustZ >= 3.5) {
                const glowTotal = radius + (a.robustZ - 3.5) * 3;
                const glow = context.createRadialGradient(x, y, radius * 0.8, x, y, glowTotal);
                glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${coreAlpha * 0.3})`);
                glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.0)`);
                context.beginPath();
                context.arc(x, y, glowTotal, 0, 2 * Math.PI);
                context.fillStyle = glow;
                context.fill();
              }

              // Core bubble with radial gradient
              context.beginPath();
              context.arc(x, y, radius, 0, 2 * Math.PI);
              const grad = context.createRadialGradient(x, y, 0, x, y, radius);
              grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${coreAlpha})`);
              grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${coreAlpha * 0.5})`);
              grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.05)`);
              context.fillStyle = grad;
              context.fill();

              // Crisp stroke ring
              context.lineWidth = a.robustZ >= 4 ? 2 : 1;
              context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${coreAlpha + 0.1})`;
              context.stroke();

              // Marker based on type
              if (a.type === 'initiative') {
                const d = radius * 0.4;
                context.beginPath();
                context.moveTo(x, y - d);
                context.lineTo(x + d, y);
                context.lineTo(x, y + d);
                context.lineTo(x - d, y);
                context.closePath();
                context.fillStyle = `rgba(255, 255, 255, 0.9)`;
                context.fill();
              } else if (a.type === 'absorption') {
                const d = radius * 0.3;
                context.beginPath();
                context.arc(x, y, d, 0, 2 * Math.PI);
                context.fillStyle = `rgba(255, 255, 255, 0.9)`;
                context.fill();
              }
            }
            context.restore();
          });
        }
      })
    }];
  }
}

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
            const currentPrice = this._options.currentPrice;
            const currentPriceY = (currentPrice && currentPrice > 0) ? this._series.priceToCoordinate(currentPrice) : null;

            this._walls.forEach(w => {
              const isBid = w.side === 'BID';
              const avgP = w.avgPrice || w.price || 0;

              // Strict Orderbook Logic Filter:
              // BID (Limit Buy) MUST be < currentPrice
              // ASK (Limit Sell) MUST be > currentPrice
              if (currentPrice && currentPrice > 0) {
                if (isBid && avgP >= currentPrice) return;
                if (!isBid && avgP <= currentPrice) return;
              }

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

              // Clip bounds relative to currentPriceY (In chart coords: higher price = smaller Y)
              if (currentPriceY !== null) {
                if (isBid) {
                  // BID wall is below currentPrice (larger Y coord). Prevent topY from going above currentPriceY!
                  topY = Math.max(topY, currentPriceY + 2);
                } else {
                  // ASK wall is above currentPrice (smaller Y coord). Prevent bottomY from going below currentPriceY!
                  bottomY = Math.min(bottomY, currentPriceY - 2);
                }
              }

              if (bottomY <= topY) return;

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
    this._options = { mode: 'blocks' }; // 'off', 'blocks', 'letters'
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
              const date = k.time; // k.time is already a Date object
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
              sessionKlines.sort((a,b) => a.time.getTime() - b.time.getTime());
              
              const firstTime = Math.floor(sessionKlines[0].time.getTime() / 1000);
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
  const bubblePrimitiveRef = useRef(null);
  const klinesRef = useRef([]);
  const wsRef = useRef(null);
  const autoScrollRef = useRef(true);
  const latestPriceRef = useRef(null);
  // Registry các price line đang hiển thị (để hover-detect + alert)
  const staticLinesRef = useRef([]); // POC/VAH/VAL/LIQ
  const wallRegRef = useRef([]);     // Limit walls
  const wallHistoryRef = useRef(new Map()); // key -> {side, avgP, usdValue, count, firstSeen, lastSeen, eatenNotified, announcedAt}
  const alertCooldownRef = useRef(new Map());
  const alertsOnRef = useRef(true);
  const checkAlertsRef = useRef(() => {});
  const wallEventSeqRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [vpData, setVpData] = useState(null);
  const [livePx, setLivePx] = useState(null);
  const [klines, setKlines] = useState(null);
  const [showWalls, setShowWalls] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [tpoMode, setTpoMode] = useState('blocks');
  const [showBubbles, setShowBubbles] = useState(() => localStorage.getItem('hft_show_bubbles') === 'true');
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('hft_timeframe') || '30m');
  const [autoScroll, setAutoScroll] = useState(true);
  const [wallTick, setWallTick] = useState(0);
  const [hoverLine, setHoverLine] = useState(null);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [wallEvents, setWallEvents] = useState([]);
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(() => localStorage.getItem('hft_show_alerts') !== 'false');

  useEffect(() => { alertsOnRef.current = showAlerts; }, [showAlerts]);

  const pushWallEvent = (type, side, price, usdNew, usdOld) => {
    setWallEvents(prev => [{
      id: ++wallEventSeqRef.current,
      type, side, price, usdNew, usdOld,
      ts: Date.now(),
    }, ...prev].slice(0, 30));
  };

  const fireToast = (text, color) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-3), { id, text, color }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  };

  // Alert khi giá chạm POC / Wall / Liq zone (kèm cooldown chống spam)
  useEffect(() => {
    checkAlertsRef.current = (price) => {
      if (!alertsOnRef.current || !price) return;
      const now = Date.now();
      const all = [...staticLinesRef.current, ...wallRegRef.current];
      for (const l of all) {
        const key = `${l.kind}:${Math.round(l.price)}`;
        const last = alertCooldownRef.current.get(key) || 0;
        if (now - last < ALERT_COOLDOWN_MS) continue;
        if (Math.abs(price - l.price) / l.price <= ALERT_TOUCH_PCT) {
          alertCooldownRef.current.set(key, now);
          fireToast(`🎯 ${l.hoverTitle} — giá đang chạm!`, l.color);
        }
      }
    };
  });

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

  useEffect(() => {
    if (bubblePrimitiveRef.current) {
      bubblePrimitiveRef.current.setOptions({ show: showBubbles });
    }
  }, [showBubbles]);

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

      const bubblePrimitive = new VolumeBubblePrimitive();
      bubblePrimitive.setOptions({ show: showBubbles });
      mainSeries.attachPrimitive(bubblePrimitive);
      bubblePrimitive.setChart(chart);
      bubblePrimitiveRef.current = bubblePrimitive;
    } else if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: { textColor: textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } }
      });
    }
  }, [theme]);

  // Crosshair: hover-detect price lines gần cursor + phát tín hiệu sync sang CVD Panel
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handler = (param) => {
      if (!param.point || param.point.x == null || !seriesRef.current) {
        setHoverLine(null);
        emitCrosshair(null);
        return;
      }

      emitCrosshair(param.time != null ? { timeMs: param.time * 1000 } : null);

      const mid = seriesRef.current.coordinateToPrice(param.point.y);
      const up = seriesRef.current.coordinateToPrice(param.point.y - HOVER_TOLERANCE_PX);
      const down = seriesRef.current.coordinateToPrice(param.point.y + HOVER_TOLERANCE_PX);
      if (mid == null || up == null || down == null) {
        setHoverLine(null);
        return;
      }

      const lo = Math.min(up, down);
      const hi = Math.max(up, down);
      let best = null;
      let bestDist = Infinity;
      [...staticLinesRef.current, ...wallRegRef.current].forEach(l => {
        if (l.price >= lo && l.price <= hi) {
          const d = Math.abs(l.price - mid);
          if (d < bestDist) { bestDist = d; best = l; }
        }
      });
      setHoverLine(best ? { ...best, x: param.point.x, y: param.point.y } : null);
    };

    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Fetch klines based on timeframe
        const limit = timeframe === '1m' || timeframe === '5m' ? 500 : 300;
        const rawKlines = await getBTCKlines('BTCUSDT', timeframe, limit);
        
        let formatted = rawKlines.map(k => ({
          time: Math.floor(k.time.getTime() / 1000),
          value: k.close,
        }));

        formatted.sort((a, b) => a.time - b.time);
        formatted = formatted.filter((v, i, a) => i === 0 || v.time > a[i - 1].time);

        if (seriesRef.current) {
          seriesRef.current.setData(formatted);
          if (chartRef.current && autoScrollRef.current) {
            chartRef.current.timeScale().scrollToRealTime();
          }
        }

        const vp = calculateVolumeProfile(rawKlines);
        setVpData(vp);
        setKlines(rawKlines);
        klinesRef.current = [...rawKlines];
        if (rawKlines.length > 0) {
          latestPriceRef.current = rawKlines[rawKlines.length - 1].close;
        }
        setLoading(false);

        if (tpoPrimitiveRef.current) {
          tpoPrimitiveRef.current.setData(rawKlines);
        }
        if (bubblePrimitiveRef.current) {
          bubblePrimitiveRef.current.setData(klinesRef.current);
        }
      } catch (err) {
        console.error('[AdvancedChart] Error in loadData:', err);
      }

      // Start realtime WebSocket updates for current timeframe
      if (wsRef.current) wsRef.current.close();
      wsRef.current = new WebSocket(`wss://stream.binance.com:9443/ws/btcusdt@kline_${timeframe}`);
      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const k = message.k;
          if (k && seriesRef.current) {
            const time = Math.floor(k.t / 1000);
            const close = parseFloat(k.c);
            
            latestPriceRef.current = close;
            setLivePx(close);
            checkAlertsRef.current(close);
            seriesRef.current.update({ time, value: close });

            // Update klines array ref for volume bubbles
            if (klinesRef.current && klinesRef.current.length > 0) {
              const lastK = klinesRef.current[klinesRef.current.length - 1];
              if (Math.floor(lastK.time.getTime() / 1000) === time) {
                lastK.close = close;
                lastK.open = parseFloat(k.o);
                lastK.high = parseFloat(k.h);
                lastK.low = parseFloat(k.l);
                lastK.volume = parseFloat(k.v);
                lastK.quoteVolume = parseFloat(k.q);
                lastK.takerBuyQuoteVolume = parseFloat(k.Q);
                lastK.isClosed = k.x;
              } else {
                klinesRef.current.push({ 
                  time: new Date(k.t), 
                  open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close, 
                  volume: parseFloat(k.v), quoteVolume: parseFloat(k.q), takerBuyQuoteVolume: parseFloat(k.Q), isClosed: k.x 
                });
                if (klinesRef.current.length > 600) klinesRef.current.shift();
              }
              if (bubblePrimitiveRef.current) {
                bubblePrimitiveRef.current.setData(klinesRef.current);
              }
            }

            if (autoScrollRef.current && chartRef.current) {
              chartRef.current.timeScale().scrollToRealTime();
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
  }, [timeframe]);

  useEffect(() => {
    if (!seriesRef.current || !klines) return;

    // Clean up existing lines
    if (pocLineRef.current) { try { seriesRef.current.removePriceLine(pocLineRef.current); } catch(e) {} pocLineRef.current = null; }
    if (vahLineRef.current) { try { seriesRef.current.removePriceLine(vahLineRef.current); } catch(e) {} vahLineRef.current = null; }
    if (valLineRef.current) { try { seriesRef.current.removePriceLine(valLineRef.current); } catch(e) {} valLineRef.current = null; }
    
    liqLinesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch(e) {} });
    liqLinesRef.current = [];

    const vp = calculateVolumeProfile(klines);
    if (vp) {
      pocLineRef.current = seriesRef.current.createPriceLine({
        price: vp.pocPrice,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
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

    const liqZones = showLiq ? calculateLiqZones(klines) : [];
    if (showLiq) {
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

    // Registry phục vụ hover tooltip + price alert
    staticLinesRef.current = [
      ...(vp ? [{
        kind: 'POC',
        price: vp.pocPrice,
        color: '#fbbf24',
        hoverTitle: `POC ${fmtPriceCompact(vp.pocPrice)}`,
        detail: `Value Area ${fmtPriceCompact(vp.valPrice)} → ${fmtPriceCompact(vp.vahPrice)}`,
      }] : []),
      ...liqZones.map(z => ({
        kind: 'LIQ',
        price: z.price,
        color: z.color,
        hoverTitle: `${z.label} ~${fmtPriceCompact(z.price)}`,
        detail: 'Mức thanh khoản suy luận từ swing high/low (ESTIMATED)',
      })),
    ];
  }, [klines, showLiq]);

  // Handle Limit Walls independently with its own reset tick
  useEffect(() => {
    if (!seriesRef.current) return;

    wallLinesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch(e) {} });
    wallLinesRef.current = [];
    if (wallPrimitiveRef.current) wallPrimitiveRef.current.setData([]);

    if (!showWalls || !whaleData) {
      wallRegRef.current = [];
      return;
    }

    const currentPrice = latestPriceRef.current || (klines && klines.length > 0 ? klines[klines.length - 1].close : 0);

    // Top 3 Limit Buy (BID) Walls: MUST be strictly BELOW currentPrice
    const topBids = (whaleData.whaleBids || [])
      .filter(w => {
        const avgP = w.avgPrice || w.price;
        return currentPrice > 0 ? avgP < currentPrice : true;
      })
      .sort((a, b) => (b.avgPrice || b.price) - (a.avgPrice || a.price))
      .slice(0, 3);

    // Top 3 Limit Sell (ASK) Walls: MUST be strictly ABOVE currentPrice
    const topAsks = (whaleData.whaleAsks || [])
      .filter(w => {
        const avgP = w.avgPrice || w.price;
        return currentPrice > 0 ? avgP > currentPrice : true;
      })
      .sort((a, b) => (a.avgPrice || a.price) - (b.avgPrice || b.price))
      .slice(0, 3);

    // ── Wall lifecycle: aging + absorption/pull detection ──────────────
    const now = Date.now();
    const hist = wallHistoryRef.current;
    const seenKeys = new Set();

    const trackWall = (w, side) => {
      const avgP = w.avgPrice || w.price;
      const key = `${side}:${Math.round(avgP)}`;
      seenKeys.add(key);
      const prev = hist.get(key);
      if (!prev) {
        const rec = { side, avgP, usdValue: w.usdValue, count: w.count || 1, firstSeen: now, lastSeen: now, eatenNotified: false, announcedAt: 0 };
        hist.set(key, rec);
        if (now - rec.announcedAt > 60 * 1000) {
          rec.announcedAt = now;
          pushWallEvent('NEW', side, avgP, w.usdValue, null);
        }
        return rec;
      }
      if (!prev.eatenNotified && prev.usdValue > 0 && w.usdValue < prev.usdValue * 0.5) {
        prev.eatenNotified = true;
        pushWallEvent('EATEN', side, avgP, w.usdValue, prev.usdValue);
      }
      prev.usdValue = w.usdValue;
      prev.count = w.count || 1;
      prev.lastSeen = now;
      return prev;
    };

    topBids.forEach(w => trackWall(w, 'BID'));
    topAsks.forEach(w => trackWall(w, 'ASK'));

    // Wall biến mất khỏi top list ≥4s → coi như bị rút (PULLED)
    hist.forEach((rec, key) => {
      if (!seenKeys.has(key) && now - rec.lastSeen > 4000) {
        pushWallEvent('PULLED', rec.side, rec.avgP, null, rec.usdValue);
        hist.delete(key);
      }
    });

    let strongestUsd = 0;

    [...topBids, ...topAsks].forEach(w => strongestUsd = Math.max(strongestUsd, w.usdValue || 0));

    const drawWallLine = (w, isBid) => {
      const avgP = w.avgPrice || w.price;
      const side = isBid ? 'BID' : 'ASK';
      const rec = trackAlreadyDone(hist, side, avgP);
      const age = rec ? now - rec.firstSeen : 0;
      const isNew = age < WALL_NEW_MS;
      const isOld = age >= WALL_OLD_MS;

      const baseRgb = isBid ? '56, 189, 248' : '192, 132, 252';
      const alpha = isNew ? 0.35 : isOld ? 0.95 : 0.6;
      const ageIcon = isOld ? '⏳' : isNew ? '🆕' : '';

      const line = seriesRef.current.createPriceLine({
        price: avgP,
        color: `rgba(${baseRgb}, ${alpha})`,
        lineWidth: isOld ? 2 : 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: w.usdValue === strongestUsd,
        title: `${ageIcon} ${isBid ? 'BUY' : 'SELL'} WALL ${fmtPriceCompact(avgP)} | ${fmtWallUsdCompact(w.usdValue)} | [${w.count || 1}]${isOld ? ` | ${Math.floor(age / 60000)}m` : ''}`,
      });
      wallLinesRef.current.push(line);

      return {
        kind: 'WALL',
        price: avgP,
        color: isBid ? '#38bdf8' : '#c084fc',
        hoverTitle: `${isBid ? 'BUY WALL' : 'SELL WALL'} ${fmtPriceCompact(avgP)}`,
        detail: `${fmtWallUsdCompact(w.usdValue)} · [${w.count || 1} lệnh] · tuổi ${age < 60000 ? `${Math.floor(age / 1000)}s` : `${Math.floor(age / 60000)}p`}${rec?.eatenNotified ? ' · ⚠ ĐANG BỊ ĂN MÒN' : ''}`,
      };
    };

    // trackAlreadyDone: tra record đã track ở trên mà không đếm lại lifecycle
    function trackAlreadyDone(h, side, avgP) {
      return h.get(`${side}:${Math.round(avgP)}`) || null;
    }

    const bidEntries = topBids.map(w => drawWallLine(w, true));
    const askEntries = topAsks.map(w => drawWallLine(w, false));
    wallRegRef.current = [...bidEntries, ...askEntries];

    if (wallPrimitiveRef.current) {
      wallPrimitiveRef.current.setOptions({ currentPrice, wallWidthPct: wallWidth });
      wallPrimitiveRef.current.setData([...topBids, ...topAsks]);
    }
  }, [whaleData, showWalls, wallTick, klines]);

  if (moduleId && isModuleHidden(moduleId)) return null;

  return (
    <div className="hft-panel glass-panel" style={{ gridColumn: 'span 2', position: 'relative', minHeight: '520px', height: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div className="hft-panel-header advanced-chart-header">
        <h3 className="hft-panel-title font-mono" style={{ borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-flex', alignItems: 'center', gap: '6px', lineHeight: 1.5, paddingTop: '4px' }}>
          <span className="hft-icon">📊</span> ADVANCED PRICE ACTION: POC, WALLS & LIQUIDATIONS
        </h3>
        <div className="advanced-chart-toolbar" aria-label="Chart controls">
          {/* ── Nhóm 1: Navigation ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '8px', borderRight: '1px solid var(--border-panel)' }}>
            <div className="advanced-chart-field" title="Khoảng cách từ nến hiện tại đến lề phải (đơn vị: số nến)">
              <span>OFF</span>
              <input
                type="number"
                value={rightOffset}
                onChange={handleRightOffsetChange}
                aria-label="Right offset in bars"
                min="0" max="300"
              />
              <span>B</span>
            </div>
            <button
              onClick={() => {
                if (chartRef.current) {
                  chartRef.current.timeScale().scrollToRealTime();
                }
              }}
              title="Cuộn ngay đến nến mới nhất"
              className="advanced-chart-control is-live font-mono"
            >
              ⏩ Latest
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
              title="Tự động bám sát theo nến realtime"
              className={`advanced-chart-control font-mono ${autoScroll ? 'is-active is-auto' : ''}`}
            >
              ⚡ Auto
            </button>
          </div>

          {/* ── Nhóm 2: Overlays dropdown ── */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setOverlaysOpen(o => !o)}
              title="Lớp phủ: Walls, Liq, Volume Bubbles, TPO, Wall width"
              className={`advanced-chart-control font-mono ${overlaysOpen ? 'is-active' : ''}`}
            >
              ▤ Overlays ▾
            </button>
            {overlaysOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOverlaysOpen(false)} />
                <div
                  style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 31,
                    background: 'var(--bg-slate-950, #0b0e14)', border: '1px solid var(--border-panel)',
                    borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column',
                    gap: '8px', minWidth: '200px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                >
                  <span className="font-mono" style={{ fontSize: '0.55rem', color: 'var(--text-slate-500)', fontWeight: 700 }}>OVERLAY LAYERS</span>
                  <button
                    onClick={() => setShowWalls(!showWalls)}
                    title="Bật/tắt Limit Walls"
                    className={`advanced-chart-control font-mono ${showWalls ? 'is-active is-walls' : ''}`}
                    style={{ justifyContent: 'space-between' }}
                  >
                    🎯 Limit Walls {showWalls ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => setShowLiq(!showLiq)}
                    title="Bật/tắt Liquidation Zones"
                    className={`advanced-chart-control font-mono ${showLiq ? 'is-active is-liq' : ''}`}
                    style={{ justifyContent: 'space-between' }}
                  >
                    🔥 Liq Zones {showLiq ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => {
                      const val = !showBubbles;
                      setShowBubbles(val);
                      localStorage.setItem('hft_show_bubbles', val);
                    }}
                    title="Bật/tắt Volume Bubbles"
                    className={`advanced-chart-control font-mono ${showBubbles ? 'is-active is-live' : ''}`}
                    style={{ justifyContent: 'space-between' }}
                  >
                    🫧 Vol Bubbles {showBubbles ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => setTpoMode(prev => prev === 'off' ? 'blocks' : prev === 'blocks' ? 'letters' : 'off')}
                    title="Chuyển TPO: tắt, blocks, letters"
                    className={`advanced-chart-control font-mono ${tpoMode !== 'off' ? 'is-active is-tpo' : ''}`}
                    style={{ justifyContent: 'space-between' }}
                  >
                    🧩 TPO {tpoMode === 'off' ? 'OFF' : tpoMode === 'blocks' ? 'BLOCKS' : 'LETTERS'}
                  </button>
                  <div className="advanced-chart-field" title="Tỉ lệ % chiều rộng của vùng Limit Wall" style={{ marginTop: '2px' }}>
                    <span>WALL W</span>
                    <input
                      type="number"
                      value={wallWidth}
                      onChange={handleWallWidthChange}
                      aria-label="Wall width percentage"
                      min="10" max="100"
                    />
                    <span>%</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Nhóm 3: Alert ── */}
          <button
            onClick={() => {
              const next = !showAlerts;
              setShowAlerts(next);
              localStorage.setItem('hft_show_alerts', String(next));
            }}
            title="Báo động khi giá chạm POC / Wall / Liq Zone (cooldown 2 phút mỗi mốc)"
            className={`advanced-chart-control font-mono ${showAlerts ? 'is-active is-liq' : ''}`}
          >
            🔔 Alert {showAlerts ? 'ON' : 'OFF'}
          </button>

          {/* ── Nhóm 4: Timeframe ── */}
          <div className="advanced-chart-field advanced-chart-timeframe">
            <span>TF</span>
            <select
              value={timeframe}
              onChange={(e) => {
                setTimeframe(e.target.value);
                localStorage.setItem('hft_timeframe', e.target.value);
              }}
              aria-label="Chart timeframe"
            >
              <option value="1m">1M</option>
              <option value="5m">5M</option>
              <option value="15m">15M</option>
              <option value="30m">30M</option>
              <option value="1h">1H</option>
              <option value="4h">4H</option>
            </select>
          </div>
          {moduleId && <ModuleMenu moduleId={moduleId} />}
        </div>
      </div>
      
      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      
      <div style={{ flex: 1, width: '100%', position: 'relative', minHeight: '400px' }}>
        <div ref={chartContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

        {/* ── Info Chip: POC / VAH / VAL + % distance + VA status ── */}
        {vpData && livePx ? (() => {
          const pctOf = (p) => ((livePx - p) / p) * 100;
          const inVA = livePx <= vpData.vahPrice && livePx >= vpData.valPrice;
          const vaStatus = inVA
            ? { text: 'IN VA', color: '#fbbf24' }
            : livePx > vpData.vahPrice
              ? { text: 'ABOVE VA', color: '#34d399' }
              : { text: 'BELOW VA', color: '#f43f5e' };
          const chip = (label, price, color) => (
            <span className="font-mono" style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '3px 8px', borderRadius: '6px', fontSize: '0.62rem', fontWeight: 600,
              background: 'rgba(10, 12, 18, 0.85)', border: `1px solid ${color}55`, color,
            }}>
              {label} {fmtPriceCompact(price)}
              <span style={{ opacity: 0.75, fontWeight: 400 }}>
                ({pctOf(price) >= 0 ? '+' : ''}{pctOf(price).toFixed(2)}%)
              </span>
            </span>
          );
          return (
            <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 12, display: 'flex', gap: '6px', flexWrap: 'wrap', pointerEvents: 'none' }}>
              {chip('POC', vpData.pocPrice, '#fbbf24')}
              {chip('VAH', vpData.vahPrice, 'rgba(251, 191, 36, 0.7)')}
              {chip('VAL', vpData.valPrice, 'rgba(251, 191, 36, 0.7)')}
              <span className="font-mono" style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '3px 8px', borderRadius: '6px', fontSize: '0.62rem', fontWeight: 700,
                background: 'rgba(10, 12, 18, 0.85)', border: `1px solid ${vaStatus.color}`,
                color: vaStatus.color,
              }}>
                {vaStatus.text}
              </span>
            </div>
          );
        })() : null}

        {/* ── Hover tooltip cho POC / Wall / Liq line ── */}
        {hoverLine ? (
          <div
            className="font-mono"
            style={{
              position: 'absolute',
              left: Math.min(hoverLine.x + 14, 9999),
              top: Math.max(hoverLine.y - 44, 4),
              zIndex: 14,
              pointerEvents: 'none',
              background: 'rgba(10, 12, 18, 0.95)',
              border: `1px solid ${hoverLine.color}`,
              borderRadius: '6px',
              padding: '5px 9px',
              fontSize: '0.62rem',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ color: hoverLine.color, fontWeight: 700 }}>{hoverLine.hoverTitle}</div>
            <div style={{ color: 'var(--text-slate-400, #94a3b8)' }}>{hoverLine.detail}</div>
          </div>
        ) : null}

        {/* ── Toast alerts ── */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 15, display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'none', maxWidth: '320px' }}>
          {toasts.map(t => (
            <div key={t.id} className="font-mono" style={{
              background: 'rgba(10, 12, 18, 0.95)',
              border: `1px solid ${t.color}`,
              borderLeft: `4px solid ${t.color}`,
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '0.65rem',
              color: 'var(--text-slate-200, #e2e8f0)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            }}>
              {t.text}
            </div>
          ))}
        </div>

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

      {/* ── Wall Event Feed: NEW / EATEN / PULLED ── */}
      <div style={{ marginTop: '10px', background: 'var(--bg-slate-950, #0b0e14)', border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '6px 8px' }}>
        <div
          className="font-mono"
          onClick={() => setFeedExpanded(e => !e)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: '0.58rem', color: 'var(--text-slate-400)', fontWeight: 700 }}
        >
          <span>⚡ WALL EVENTS ({wallEvents.length})</span>
          <span>{feedExpanded ? '▾ THU GỌN' : '▸ MỞ RỘNG'}</span>
        </div>
        {wallEvents.length > 0 && (
          <div className="font-mono" style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: feedExpanded ? '160px' : '52px', overflowY: 'auto' }}>
            {(feedExpanded ? wallEvents : wallEvents.slice(0, 3)).map(ev => {
              const cfg = {
                NEW: { label: 'NEW', color: '#38bdf8' },
                EATEN: { label: 'EATEN ⚠', color: '#fbbf24' },
                PULLED: { label: 'PULLED', color: '#f43f5e' },
              }[ev.type];
              const t = new Date(ev.ts);
              const hh = String(t.getHours()).padStart(2, '0');
              const mm = String(t.getMinutes()).padStart(2, '0');
              const ss = String(t.getSeconds()).padStart(2, '0');
              return (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.58rem' }}>
                  <span style={{ color: 'var(--text-slate-500)' }}>{hh}:{mm}:{ss}</span>
                  <span style={{
                    padding: '1px 5px', borderRadius: '3px', fontWeight: 700,
                    background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}55`,
                  }}>{cfg.label}</span>
                  <span style={{ color: ev.side === 'BID' ? '#38bdf8' : '#c084fc' }}>{ev.side === 'BID' ? 'BUY WALL' : 'SELL WALL'}</span>
                  <span style={{ color: 'var(--text-slate-300)' }}>{fmtPriceCompact(ev.price)}</span>
                  {ev.usdOld != null && (
                    <span style={{ color: 'var(--text-slate-500)' }}>
                      {ev.type === 'EATEN'
                        ? `${fmtWallUsdCompact(ev.usdOld)} → ${fmtWallUsdCompact(ev.usdNew)}`
                        : `was ${fmtWallUsdCompact(ev.usdOld)}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="hft-empty font-mono" style={{ marginTop: '12px', fontSize: '0.7rem', lineHeight: 1.6 }}>
        <span style={{color: '#38bdf8'}}>Limit Walls</span>: Chiều dài các thanh ngang thể hiện khối lượng lệnh chờ khớp (Bid/Ask) tại mỗi mức giá.{' '}
        <span style={{background: 'rgba(168, 85, 247, 0.85)', color: '#fff', padding: '2px 6px', borderRadius: '4px', margin: '0 4px', display: 'inline-block'}}>63,000 | $1M</span>:{' '}
        Nhãn hiển thị <span style={{color: '#fbbf24'}}>Mức giá</span> có thanh khoản lớn nhất | <span style={{color: '#fbbf24'}}>Tổng USD</span> chờ khớp tại cụm đó.{' '}
        <span style={{color: '#a855f7', marginLeft: '8px'}}>TPO Profile</span>: Biểu đồ thời gian - giá theo ngày (Blocks/Letters). POC của ngày có màu vàng mờ.{' '}
        <span style={{color: '#38bdf8', marginLeft: '8px'}}>🫧 Vol Bubbles</span>: Anomaly Volume (Robust Z-Score ≥ 2.5).{' '}
        <span style={{color: '#0ea5e9'}}>● Xanh</span>: Taker Buy | <span style={{color: '#ef4444'}}>● Đỏ</span>: Taker Sell | <span style={{color: '#f59e0b'}}>● Vàng</span>: Neutral.{' '}
        <span style={{color: '#fff'}}>◆ Diamond</span>: Initiative (Phá vỡ) | <span style={{color: '#fff'}}>● Circle</span>: Absorption (Hấp thụ).
      </div>
      {children}
    </div>
  );
}

export default React.memo(AdvancedChart);

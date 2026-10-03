import React, { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  TrendingUp, TrendingDown, Activity, Zap, Info, Calendar, Sparkles
} from 'lucide-react';
import { getBiasComparisonSeries } from '../services/biasHistoryService';

export default function BiasComparisonChart({
  data,
  etfHistory = [],
  snapshots = [],
  theme = 'dark',
}) {
  const [timeframe, setTimeframe] = useState('7d'); // '7d' | '30d' | 'realtime'

  const comparisonData = useMemo(() => {
    return getBiasComparisonSeries({
      timeframe,
      dashboardData: data,
      etfHistory,
      liveSnapshots: snapshots,
    });
  }, [timeframe, data, etfHistory, snapshots]);

  const { series, correlation, divergence, hasData } = comparisonData;

  const isLight = theme === 'light';
  const gridColor = isLight ? 'rgba(71, 85, 105, 0.15)' : 'rgba(30, 41, 59, 0.4)';
  const tickColor = isLight ? '#475569' : '#94a3b8';
  const textColor = isLight ? '#0f172a' : '#f8fafc';

  // Chart.js Data & Options
  const chartData = useMemo(() => {
    if (!hasData) return null;

    const labels = series.map((item) => item.dateStr);
    const btcPrices = series.map((item) => item.btcPrice);
    const biasScores = series.map((item) => item.biasScore);

    return {
      labels,
      datasets: [
        {
          label: 'BTC Price ($ USD)',
          data: btcPrices,
          yAxisID: 'yPrice',
          borderColor: isLight ? '#0284c7' : '#38bdf8',
          backgroundColor: isLight ? 'rgba(2, 132, 199, 0.05)' : 'rgba(56, 189, 248, 0.05)',
          borderWidth: 2,
          pointRadius: series.length > 20 ? 2 : 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: isLight ? '#0284c7' : '#38bdf8',
          pointBorderColor: '#ffffff',
          tension: 0.15,
          fill: false,
        },
        {
          label: 'Market Bias Score (-100..+100)',
          data: biasScores,
          yAxisID: 'yBias',
          borderColor: '#10b981',
          segment: {
            borderColor: (ctx) => {
              const val = ctx.p1?.parsed?.y ?? ctx.p0?.parsed?.y ?? 0;
              if (val > 10) return '#10b981'; // Bullish Green
              if (val < -10) return '#f43f5e'; // Bearish Rose
              return '#f59e0b'; // Amber / Neutral
            },
          },
          backgroundColor: (context) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return 'rgba(16, 185, 129, 0.08)';
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
            gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.02)');
            gradient.addColorStop(1, 'rgba(244, 63, 94, 0.22)');
            return gradient;
          },
          borderWidth: 2.4,
          pointRadius: series.length > 20 ? 2.5 : 4,
          pointHoverRadius: 7,
          pointBackgroundColor: series.map((item) =>
            item.biasScore > 10 ? '#10b981' : item.biasScore < -10 ? '#f43f5e' : '#f59e0b'
          ),
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          tension: 0.25,
          fill: true,
        },
      ],
    };
  }, [series, hasData, isLight]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            color: tickColor,
            font: {
              family: 'Roboto Mono, monospace',
              size: 11,
              weight: '500',
            },
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.96)',
          borderColor: isLight ? '#cbd5e1' : '#334155',
          borderWidth: 1,
          titleColor: textColor,
          bodyColor: tickColor,
          padding: 12,
          boxPadding: 6,
          titleFont: { family: 'Roboto Mono, monospace', size: 12, weight: 'bold' },
          bodyFont: { family: 'Roboto Mono, monospace', size: 11 },
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex;
              const point = series[index];
              return point?.fullDateStr || items[0]?.label || '';
            },
            label: (item) => {
              if (item.datasetIndex === 0) {
                return ` BTC Price: $${Number(item.raw).toLocaleString('en-US')}`;
              }
              const val = Number(item.raw);
              const sign = val > 0 ? '+' : '';
              const state = val > 10 ? 'Bullish' : val < -10 ? 'Bearish' : 'Neutral';
              return ` Bias Score: ${sign}${val} / 100 (${state})`;
            },
            afterBody: (items) => {
              const index = items[0]?.dataIndex;
              const point = series[index];
              if (!point) return [];
              return [
                ` Confidence: ${point.confidence || 0}%`,
                point.isLive ? ' ● Realtime Live Point' : ' ○ Daily Checkpoint',
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
            drawOnChartArea: true,
          },
          ticks: {
            color: tickColor,
            maxTicksLimit: timeframe === '30d' ? 12 : 8,
            font: { family: 'Roboto Mono, monospace', size: 10 },
          },
        },
        yPrice: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: {
            color: gridColor,
          },
          ticks: {
            color: isLight ? '#0284c7' : '#38bdf8',
            font: { family: 'Roboto Mono, monospace', size: 10, weight: '600' },
            callback: (val) => `$${(val / 1000).toFixed(1)}k`,
          },
        },
        yBias: {
          type: 'linear',
          display: true,
          position: 'right',
          min: -100,
          max: 100,
          grid: {
            drawOnChartArea: true,
            color: (context) => {
              // Highlight Zero Baseline distinctly
              if (context.tick && context.tick.value === 0) {
                return isLight ? 'rgba(15, 23, 42, 0.4)' : 'rgba(255, 255, 255, 0.45)';
              }
              return 'transparent';
            },
            lineWidth: (context) => {
              if (context.tick && context.tick.value === 0) return 1.8;
              return 0;
            },
          },
          ticks: {
            stepSize: 50,
            color: (context) => {
              const val = context.tick.value;
              if (val > 0) return '#10b981';
              if (val < 0) return '#f43f5e';
              return isLight ? '#0f172a' : '#ffffff';
            },
            font: { family: 'Roboto Mono, monospace', size: 10, weight: 'bold' },
            callback: (val) => `${val > 0 ? '+' : ''}${val}`,
          },
        },
      },
    };
  }, [series, hasData, timeframe, isLight, tickColor, textColor, gridColor]);

  const realtimeCount = snapshots.filter(
    (s) => Number.isFinite(Number(s.btcPrice)) && Number.isFinite(Number(s.biasScore))
  ).length;

  return (
    <div className="bias-comparison-panel font-mono">
      {/* ── Toolbar: Timeframe Selector & Status Chips ──────────────── */}
      <div className="bias-comp-toolbar">
        <div className="bias-comp-left">
          <div className="bias-comp-heading">
            <Sparkles size={14} className="text-emerald-400" />
            <span>ĐỐI CHIẾU SONG SONG: BIAS SCORE vs BTC PRICE</span>
          </div>

          {/* Timeframe Buttons */}
          <div className="bias-timeframe-group">
            <button
              type="button"
              className={`bias-tf-btn ${timeframe === '7d' ? 'is-active' : ''}`}
              onClick={() => setTimeframe('7d')}
            >
              7D
            </button>
            <button
              type="button"
              className={`bias-tf-btn ${timeframe === '30d' ? 'is-active' : ''}`}
              onClick={() => setTimeframe('30d')}
            >
              30D
            </button>
            <button
              type="button"
              className={`bias-tf-btn ${timeframe === 'realtime' ? 'is-active' : ''}`}
              onClick={() => setTimeframe('realtime')}
              disabled={realtimeCount < 2}
              title={realtimeCount < 2 ? 'Cần tối thiểu 2 snapshot realtime trong phiên' : 'Xem snapshot thời gian thực'}
            >
              REALTIME {realtimeCount > 0 ? `(${realtimeCount})` : ''}
            </button>
          </div>
        </div>

        {/* Analytics Badges */}
        <div className="bias-comp-right">
          {/* Pearson Correlation Badge */}
          <div
            className="bias-stat-pill"
            style={{ borderColor: correlation.color, color: correlation.color }}
            title="Hệ số tương quan tuyến tính Pearson r giữa Giá BTC và Điểm Bias"
          >
            <Activity size={12} />
            <span>TƯƠNG QUAN r: <strong>{correlation.r >= 0 ? `+${correlation.r}` : correlation.r}</strong></span>
          </div>

          {/* Divergence Status Badge */}
          <div
            className="bias-stat-pill"
            style={{ borderColor: divergence.color, color: divergence.color, backgroundColor: `${divergence.color}15` }}
            title={divergence.desc}
          >
            <Zap size={12} />
            <span>{divergence.shortLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Quant Insights Ribbon ─────────────────────────────────────── */}
      <div className="bias-insights-ribbon">
        <div className="bias-insight-item">
          <span className="insight-label">Δ GIÁ BTC:</span>
          <strong className={divergence.deltaPricePct >= 0 ? 'text-emerald' : 'text-rose'}>
            {divergence.deltaPricePct >= 0 ? '▲ +' : '▼ '}
            {divergence.deltaPricePct != null ? divergence.deltaPricePct.toFixed(2) : '0.00'}%
          </strong>
        </div>

        <div className="bias-insight-item">
          <span className="insight-label">Δ BIAS SCORE:</span>
          <strong className={divergence.deltaBias >= 0 ? 'text-emerald' : 'text-rose'}>
            {divergence.deltaBias >= 0 ? '▲ +' : '▼ '}
            {divergence.deltaBias != null ? divergence.deltaBias.toFixed(0) : '0'} pt
          </strong>
        </div>

        <div className="bias-insight-item bias-insight-desc" title={divergence.desc}>
          <Info size={12} className="text-slate-400" />
          <span>{divergence.desc}</span>
        </div>
      </div>

      {/* ── Main Dual-Axis Chart Canvas ─────────────────────────────────── */}
      <div className="bias-chart-canvas-wrap">
        {!hasData ? (
          <div className="bias-chart-empty-state">
            <div className="warming-spinner-dot" />
            <span>Đang tải chuỗi dữ liệu đối chiếu {timeframe.toUpperCase()}...</span>
          </div>
        ) : (
          <Line data={chartData} options={chartOptions} />
        )}
      </div>

      {/* ── Footer Guidance & Axis Legend ─────────────────────────────── */}
      <div className="bias-comp-footer">
        <div className="axis-hint-group">
          <span className="axis-hint text-sky-400">
            ● Trục Trái: Giá Bitcoin ($ USD)
          </span>
          <span className="axis-hint text-emerald-400">
            ● Trục Phải: Market Bias Score (-100 đến +100)
          </span>
          <span className="axis-hint text-slate-400">
            --- Đường Zero Baseline (0: Điểm cân bằng)
          </span>
        </div>

        <div className="provenance-hint text-slate-500">
          {timeframe === 'realtime'
            ? '🛡 Dữ liệu Realtime Provenance Snapshot thực tế'
            : `🛡 Dữ liệu Daily Checkpoint ${timeframe.toUpperCase()} đồng bộ nến ngày`}
        </div>
      </div>
    </div>
  );
}

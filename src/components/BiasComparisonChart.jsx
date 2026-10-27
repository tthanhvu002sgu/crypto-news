import { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  Activity, Zap, Info, Sparkles, BarChart2, Layers
} from 'lucide-react';
import {
  getBiasComparisonSeries,
  computeBiasBucketDistribution,
} from '../services/biasHistoryService';

// Ensure all controllers and elements used in mixed chart are registered
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Title,
  ChartTooltip,
  Legend,
  Filler
);

export default function BiasComparisonChart({
  data,
  etfHistory = [],
  snapshots = [],
  theme = 'dark',
}) {
  const [timeframe, setTimeframe] = useState('7d'); // '7d' | '30d' | 'realtime'
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'distribution'
  const [returnHorizon, setReturnHorizon] = useState('1D'); // '1D' | '3D' | '7D'
  const [showReturnBars, setShowReturnBars] = useState(true);

  const comparisonData = useMemo(() => {
    return getBiasComparisonSeries({
      timeframe,
      dashboardData: data,
      etfHistory,
      liveSnapshots: snapshots,
    });
  }, [timeframe, data, etfHistory, snapshots]);

  const { series, distributionSeries, correlation, divergence, hasData } = comparisonData;

  // Phân phối theo 5 bucket bias cho kỳ hạn được chọn (dùng distributionSeries để bảo đảm đủ mẫu đã resolve)
  const bucketDist = useMemo(() => {
    return computeBiasBucketDistribution(distributionSeries || series, returnHorizon);
  }, [distributionSeries, series, returnHorizon]);

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
    const forwardReturns = series.map((item) => {
      const fRet = item.forwardReturns?.[returnHorizon] ??
        (returnHorizon === '1D' ? item.forwardReturn1d :
         returnHorizon === '3D' ? item.forwardReturn3d :
         returnHorizon === '7D' ? item.forwardReturn7d : null);
      return fRet;
    });

    const datasets = [
      {
        type: 'line',
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
        order: 2,
      },
      {
        type: 'line',
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
        order: 1,
      },
    ];

    if (showReturnBars) {
      datasets.push({
        type: 'bar',
        label: `Forward Return +${returnHorizon} (%)`,
        data: forwardReturns,
        yAxisID: 'yReturn',
        backgroundColor: forwardReturns.map((val) =>
          val == null ? 'transparent' : val >= 0 ? 'rgba(16, 185, 129, 0.45)' : 'rgba(244, 63, 94, 0.45)'
        ),
        borderColor: forwardReturns.map((val) =>
          val == null ? 'transparent' : val >= 0 ? '#10b981' : '#f43f5e'
        ),
        borderWidth: 1,
        borderRadius: 2,
        barPercentage: 0.4,
        order: 3,
      });
    }

    return { labels, datasets };
  }, [series, hasData, isLight, showReturnBars, returnHorizon]);

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
              if (item.datasetIndex === 1) {
                const val = Number(item.raw);
                const sign = val > 0 ? '+' : '';
                const state = val > 10 ? 'Bullish' : val < -10 ? 'Bearish' : 'Neutral';
                return ` Bias Score: ${sign}${val} / 100 (${state})`;
              }
              if (item.datasetIndex === 2) {
                const val = item.raw;
                if (val == null) return ` Forward Return (+${returnHorizon}): Chưa kết thúc phiên`;
                return ` Forward Return (+${returnHorizon}): ${val >= 0 ? '+' : ''}${Number(val).toFixed(2)}%`;
              }
              return '';
            },
            afterBody: (items) => {
              const index = items[0]?.dataIndex;
              const point = series[index];
              if (!point) return [];
              const fRet = point.forwardReturns?.[returnHorizon];
              const lines = [
                ` Bucket: ${point.bucket?.label || 'Neutral'}`,
                ` Confidence: ${point.confidence || 0}%`,
              ];
              if (fRet != null) {
                const isHit = (point.biasScore > 10 && fRet > 0) ||
                              (point.biasScore < -10 && fRet < 0) ||
                              (Math.abs(point.biasScore) <= 10 && Math.abs(fRet) <= 1.5);
                lines.push(` Edge Check: ${isHit ? 'ĐÚNG HƯỚNG ✓ (HIT)' : 'NGƯỢC CHIỀU ✗ (MISS)'}`);
              }
              lines.push(point.isLive ? ' ● Realtime Live Point' : ' ○ Daily Checkpoint');
              return lines;
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
        yReturn: {
          type: 'linear',
          display: showReturnBars,
          position: 'right',
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            display: false, // Dùng tooltip hiển thị giá trị cụ thể để tránh rối mắt
          },
        },
      },
    };
  }, [series, timeframe, isLight, tickColor, textColor, gridColor, showReturnBars, returnHorizon]);

  const realtimeCount = snapshots.filter(
    (s) => Number.isFinite(Number(s.btcPrice)) && Number.isFinite(Number(s.biasScore))
  ).length;

  return (
    <div className="bias-comparison-panel font-mono">
      {/* ── Toolbar: Timeframe Selector & Mode Tabs ──────────────── */}
      <div className="bias-comp-toolbar">
        <div className="bias-comp-left">
          <div className="bias-comp-heading">
            <Sparkles size={14} className="text-emerald-400" />
            <span>ĐỐI CHIẾU SONG SONG &amp; PHÂN PHỐI FORWARD RETURN</span>
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

          {/* Mode Switch: Chart vs 5-Bucket Distribution */}
          <div className="bias-subview-toggle">
            <button
              type="button"
              className={`bias-subview-btn ${activeTab === 'chart' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              <BarChart2 size={12} />
              <span>OVERLAY CHART</span>
            </button>
            <button
              type="button"
              className={`bias-subview-btn ${activeTab === 'distribution' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('distribution')}
            >
              <Layers size={12} />
              <span>PHÂN PHỐI 5 BUCKET</span>
            </button>
          </div>
        </div>

        {/* Analytics Badges & Horizon Selector */}
        <div className="bias-comp-right">
          {/* Horizon Selection Buttons */}
          <div className="bias-horizon-group" title="Kỳ hạn Forward Return thực tế">
            <span className="horizon-tag-label">KỲ HẠN:</span>
            {['1D', '3D', '7D'].map((h) => (
              <button
                key={h}
                type="button"
                className={`bias-horizon-btn ${returnHorizon === h ? 'is-active' : ''}`}
                onClick={() => setReturnHorizon(h)}
              >
                +{h}
              </button>
            ))}
          </div>

          {/* Pearson Correlation Badge */}
          <div
            className="bias-stat-pill"
            style={{ borderColor: correlation.color, color: correlation.color }}
            title="Hệ số tương quan tuyến tính Pearson r giữa Giá BTC và Điểm Bias"
          >
            <Activity size={12} />
            <span>r: <strong>{correlation.r >= 0 ? `+${correlation.r}` : correlation.r}</strong></span>
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

        <div className="bias-insight-item">
          <span className="insight-label">HIT-RATE (+{returnHorizon}):</span>
          <strong className={bucketDist.overallHitRate >= 55 ? 'text-emerald' : 'text-amber-400'}>
            {bucketDist.overallHitRate != null ? `${bucketDist.overallHitRate}%` : '---'}
          </strong>
          <span className="text-slate-500" style={{ fontSize: '0.65rem' }}>
            ({bucketDist.totalResolved}/{bucketDist.totalSamples} mẫu)
          </span>
        </div>

        <div className="bias-insight-item bias-insight-desc" title={divergence.desc}>
          <Info size={12} className="text-slate-400" />
          <span>{divergence.desc}</span>
        </div>

        {activeTab === 'chart' && (
          <label className="bias-bars-toggle-label">
            <input
              type="checkbox"
              checked={showReturnBars}
              onChange={(e) => setShowReturnBars(e.target.checked)}
            />
            <span>Return Bars (+{returnHorizon})</span>
          </label>
        )}
      </div>

      {/* ── View 1: Main Dual-Axis Chart Canvas ────────────────────────── */}
      {activeTab === 'chart' && (
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
      )}

      {/* ── View 2: 5-Bucket Forward Return Distribution ─────────────── */}
      {activeTab === 'distribution' && (
        <div className="bias-distribution-view">
          <div className="bias-dist-header">
            <div className="dist-title-group">
              <Layers size={14} className="text-emerald" />
              <span className="dist-title">PHÂN PHỐI FORWARD RETURN THEO 5 BUCKET BIAS ({returnHorizon})</span>
            </div>
            <span className="dist-provenance-tag">
              🛡 Không look-ahead leakage · Walk-forward {timeframe.toUpperCase()}
            </span>
          </div>

          <div className="bias-buckets-grid">
            {bucketDist.buckets.map((b) => {
              const hasSamples = b.resolvedCount > 0;
              const hitRateColor = b.hitRate == null ? '#94a3b8' : b.hitRate >= 60 ? '#10b981' : b.hitRate >= 50 ? '#34d399' : '#f43f5e';

              return (
                <div
                  key={b.id}
                  className="bias-bucket-card font-mono"
                  style={{ borderColor: `${b.color}35`, background: `linear-gradient(180deg, ${b.color}08 0%, transparent 100%)` }}
                >
                  <div className="bucket-card-top">
                    <div className="bucket-badge" style={{ backgroundColor: `${b.color}20`, color: b.color, borderColor: `${b.color}50` }}>
                      <span className="bucket-dot" style={{ backgroundColor: b.color }} />
                      <strong style={{ fontSize: '0.75rem' }}>{b.label.toUpperCase()}</strong>
                    </div>
                    <span className="bucket-range text-slate-400">{b.rangeStr}</span>
                  </div>

                  <div className="bucket-kpi-row">
                    <div className="bucket-kpi-col">
                      <span className="kpi-micro-label">HIT-RATE</span>
                      <div className="kpi-micro-val" style={{ color: hitRateColor }}>
                        {b.hitRate != null ? `${b.hitRate}%` : '---'}
                      </div>
                      <span className="kpi-subtext text-slate-500">
                        {b.resolvedCount} / {b.count} mẫu
                      </span>
                    </div>

                    <div className="bucket-kpi-col">
                      <span className="kpi-micro-label">MEDIAN RETURN</span>
                      <div className={`kpi-micro-val ${b.medianReturn != null && b.medianReturn > 0 ? 'text-emerald' : b.medianReturn != null && b.medianReturn < 0 ? 'text-rose' : 'text-slate-400'}`}>
                        {b.medianReturn != null ? `${b.medianReturn >= 0 ? '+' : ''}${b.medianReturn}%` : '---'}
                      </div>
                      <span className="kpi-subtext text-slate-500">
                        IQR: {b.iqr != null ? `±${(b.iqr / 2).toFixed(1)}%` : '---'}
                      </span>
                    </div>
                  </div>

                  {/* Range Spread Metrics (P25 - P75 & Min - Max) */}
                  <div className="bucket-spread-box">
                    <div className="spread-row">
                      <span className="spread-label text-slate-400">P25 – P75 (IQR):</span>
                      <span className="spread-val text-contrast">
                        {b.p25 != null ? `[${b.p25 >= 0 ? '+' : ''}${b.p25}%, ${b.p75 >= 0 ? '+' : ''}${b.p75}%]` : '---'}
                      </span>
                    </div>
                    <div className="spread-row">
                      <span className="spread-label text-slate-400">Min – Max:</span>
                      <span className="spread-val text-slate-300">
                        {b.min != null ? `[${b.min >= 0 ? '+' : ''}${b.min}%, ${b.max >= 0 ? '+' : ''}${b.max}%]` : '---'}
                      </span>
                    </div>
                  </div>

                  {/* Visual IQR Spread Bar */}
                  {hasSamples && (
                    <div className="bucket-visual-bar-wrap">
                      <div className="visual-bar-track">
                        <div
                          className="visual-bar-fill"
                          style={{
                            backgroundColor: b.medianReturn >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
                            borderColor: b.color,
                            width: `${Math.min(100, Math.max(10, (b.hitRate ?? 50)))}%`,
                          }}
                        />
                      </div>
                      <div className="visual-bar-meta text-slate-500">
                        <span>Min {b.min}%</span>
                        <span style={{ color: b.color, fontWeight: 'bold' }}>Med {b.medianReturn}%</span>
                        <span>Max {b.max}%</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Footer Guidance & Axis Legend ─────────────────────────────── */}
      <div className="bias-comp-footer">
        <div className="axis-hint-group">
          <span className="axis-hint text-sky-400">
            ● Trục Trái: Giá Bitcoin ($ USD)
          </span>
          <span className="axis-hint text-emerald-400">
            ● Trục Phải: Market Bias Score (-100 đến +100)
          </span>
          {showReturnBars && activeTab === 'chart' && (
            <span className="axis-hint text-emerald">
              ■ Cột Return: Realized Forward Return (+{returnHorizon})
            </span>
          )}
          <span className="axis-hint text-slate-400">
            --- Đường Zero Baseline (0: Điểm cân bằng)
          </span>
        </div>

        <div className="provenance-hint text-slate-500">
          {timeframe === 'realtime'
            ? '🛡 Dữ liệu Realtime Provenance Snapshot thực tế'
            : `🛡 Dữ liệu Daily Checkpoint ${timeframe.toUpperCase()} đồng bộ nến ngày (No-Look-Ahead)`}
        </div>
      </div>
    </div>
  );
}

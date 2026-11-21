import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { estimateBtcProductionCostRange } from '../services/api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: '#94a3b8',
        font: { family: 'monospace', size: 10 }
      }
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      titleColor: '#e2e8f0',
      bodyColor: '#cbd5e1',
      borderColor: '#334155',
      borderWidth: 1,
      titleFont: { family: 'monospace' },
      bodyFont: { family: 'monospace' }
    }
  },
  scales: {
    x: {
      ticks: { color: '#64748b', font: { family: 'monospace', size: 9 }, maxTicksLimit: 8 },
      grid: { color: 'rgba(51, 65, 85, 0.3)' }
    },
    y: {
      ticks: { color: '#64748b', font: { family: 'monospace', size: 10 } },
      grid: { color: 'rgba(51, 65, 85, 0.3)' }
    }
  }
};

/** 1. Chart Lịch sử Giá vs CVD (7d/30d CVD Divergence) */
export function CvdChart({ cvdData }) {
  const points = Array.isArray(cvdData) ? cvdData : (Array.isArray(cvdData?.points) ? cvdData.points : []);
  if (points.length === 0) return null;
  
  const step = Math.max(1, Math.floor(points.length / 50));
  const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const data = {
    labels: sampled.map(d => {
      const dt = new Date(d.timestamp || d.time);
      return `${dt.getDate()}/${dt.getMonth()+1} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }),
    datasets: [
      {
        label: 'Giá BTC ($)',
        data: sampled.map(d => parseFloat(d.price)),
        borderColor: '#e2e8f0',
        backgroundColor: 'transparent',
        yAxisID: 'yPrice',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1
      },
      {
        label: 'CVD Taker Flow (BTC)',
        data: sampled.map(d => parseFloat(d.cvd || 0)),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        yAxisID: 'yCvd',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.1
      }
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '📈 GIÁ BTC VS CUMULATIVE VOLUME DELTA (CVD DIVERGENCE)', color: '#f59e0b', font: { family: 'monospace', size: 11 } }
    },
    scales: {
      x: commonOptions.scales.x,
      yPrice: {
        type: 'linear',
        display: true,
        position: 'left',
        ticks: { color: '#e2e8f0', font: { family: 'monospace', size: 10 } },
        grid: { color: 'rgba(51, 65, 85, 0.3)' }
      },
      yCvd: {
        type: 'linear',
        display: true,
        position: 'right',
        ticks: {
          color: (context) => {
            if (context.tick && context.tick.value === 0) return '#ffffff';
            return '#f59e0b';
          },
          font: (context) => {
            if (context.tick && context.tick.value === 0) return { family: 'monospace', size: 10, weight: 'bold' };
            return { family: 'monospace', size: 10 };
          }
        },
        grid: {
          drawOnChartArea: true,
          color: (context) => {
            if (context.tick && context.tick.value === 0) return 'rgba(245, 158, 11, 0.45)';
            return 'transparent';
          },
          lineWidth: (context) => {
            if (context.tick && context.tick.value === 0) return 1.5;
            return 0;
          }
        }
      }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '240px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Line data={data} options={options} />
    </div>
  );
}

/** 2. Chart Funding Rate & Open Interest (OI) */
export function FundingOiChart({ oiHistory, fundingHistory }) {
  if (!oiHistory || oiHistory.length === 0) return null;

  const settlements = Array.isArray(fundingHistory)
    ? fundingHistory
        .map((row) => ({ ts: Number(row.fundingTime), rate: parseFloat(row.fundingRate) }))
        .filter((row) => Number.isFinite(row.ts) && Number.isFinite(row.rate))
        .sort((a, b) => a.ts - b.ts)
    : [];
  const fundingSeries = oiHistory.map((row) => {
    const ts = new Date(row.timestamp).getTime();
    let rate = null;
    for (const settlement of settlements) {
      if (settlement.ts <= ts) rate = settlement.rate;
      else break;
    }
    return rate === null ? null : rate * 100;
  });
  const hasFunding = settlements.length > 0 && fundingSeries.some((value) => value !== null);

  const data = {
    labels: oiHistory.map(d => {
      const dt = new Date(d.timestamp);
      return `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }),
    datasets: [
      {
        type: 'line',
        label: 'Open Interest (BTC)',
        data: oiHistory.map(d => parseFloat(d.sumOpenInterest || 0)),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        yAxisID: 'yOi',
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.1
      },
      ...(hasFunding ? [{
        type: 'line',
        label: 'Funding (%/8h)',
        data: fundingSeries,
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        yAxisID: 'yFunding',
        borderWidth: 1.5,
        pointRadius: 0,
        stepped: true,
        tension: 0
      }] : [])
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '⚡ OPEN INTEREST & FUNDING RATE', color: '#3b82f6', font: { family: 'monospace', size: 11 } }
    },
    scales: {
      x: commonOptions.scales.x,
      yOi: {
        type: 'linear',
        display: true,
        position: 'left',
        ticks: { color: '#3b82f6', font: { family: 'monospace', size: 10 } },
        grid: { color: 'rgba(51, 65, 85, 0.3)' }
      },
      ...(hasFunding ? {
        yFunding: {
          type: 'linear',
          display: true,
          position: 'right',
          ticks: { color: '#f59e0b', font: { family: 'monospace', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      } : {})
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '230px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Line data={data} options={options} />
    </div>
  );
}

/** 3. Chart US BTC Spot ETF Net Flows */
export function EtfChart({ etfHistory }) {
  if (!etfHistory || etfHistory.length === 0) return null;
  const flows = [...etfHistory].slice(-10);
  const data = {
    labels: flows.map(f => f.date),
    datasets: [
      {
        label: 'Net Flow ($M)',
        data: flows.map(f => parseFloat(f.flow || 0)),
        backgroundColor: flows.map(f => parseFloat(f.flow || 0) >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(244, 63, 94, 0.7)'),
        borderColor: flows.map(f => parseFloat(f.flow || 0) >= 0 ? '#10b981' : '#f43f5e'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '🏦 US SPOT BITCOIN ETF NET FLOWS (7-10 PHIÊN GẦN NHẤT)', color: '#10b981', font: { family: 'monospace', size: 11 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '220px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

/** 4. Chart Vị thế CME COT (Commitment of Traders) */
export function CotChart({ cotData }) {
  if (!cotData) return null;
  
  const groups = [
    { label: 'Asset Manager (Quỹ)', net: cotData.assetManager?.net || 0, wow: cotData.analytics?.deltas?.amWoW ?? cotData.assetManager?.netChange },
    { label: 'Leveraged Funds (Đòn bẩy)', net: cotData.leveragedFunds?.net || 0, wow: cotData.analytics?.deltas?.lfWoW ?? cotData.leveragedFunds?.netChange },
    { label: 'Dealer Intermediary', net: cotData.dealerIntermediary?.net || 0, wow: cotData.analytics?.deltas?.dealerWoW },
    { label: 'Other Reportables', net: cotData.otherReportables?.net || 0, wow: null },
    { label: 'Non-Reportable (Cá nhân)', net: cotData.nonReportable?.net || 0, wow: cotData.analytics?.deltas?.retailWoW }
  ];

  const data = {
    labels: groups.map(g => g.label),
    datasets: [
      {
        label: 'Vị thế Ròng Net Contracts (Long - Short)',
        data: groups.map(g => g.net),
        backgroundColor: groups.map(g => g.net >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)'),
        borderColor: groups.map(g => g.net >= 0 ? '#10b981' : '#ef4444'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const amIndex = cotData.analytics?.amCotIndex ?? (cotData.cotIndex ?? null);
  const regimeLabel = cotData.regime?.label || 'PHÂN TÍCH VỊ THẾ CME';

  const options = {
    ...commonOptions,
    indexAxis: 'y', // Horizontal Bar Chart
    plugins: {
      ...commonOptions.plugins,
      title: {
        display: true,
        text: `🏛️ CME COT POSITIONING (AS OF ${cotData.date || 'LATEST'}) • ${regimeLabel}`,
        color: '#8b5cf6',
        font: { family: 'monospace', size: 11 }
      },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const group = groups[ctx.dataIndex];
            return group?.wow != null ? ` Thay đổi tuần (WoW): ${group.wow >= 0 ? '+' : ''}${group.wow.toLocaleString()} hđ` : '';
          }
        }
      }
    }
  };

  return (
    <div className="summary-chart-container" style={{ minHeight: '240px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <div style={{ height: '200px' }}>
        <Bar data={data} options={options} />
      </div>
      {amIndex != null && (
        <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '8px', display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-panel)', paddingTop: '6px' }}>
          <span>COT Index Thể Chế (26W): <strong style={{ color: '#10b981' }}>{amIndex}%</strong></span>
          <span>Open Interest: <strong>{cotData.openInterest ? cotData.openInterest.toLocaleString() : '---'}</strong> hđ</span>
        </div>
      )}
    </div>
  );
}

/** 5. Chart Định giá On-chain: BTC Price vs Production Cost Line Chart (180D / Fallback) */
export function OnChainValuationChart({ mvrv, nupl, btcPrice, productionCost, priceHistory, difficultyHistory }) {
  const mvrvVal = parseFloat(mvrv || 0);
  const priceVal = parseFloat(btcPrice || 0);
  const candles = Array.isArray(priceHistory)
    ? priceHistory
        .map((c) => ({
          ts: new Date(c?.time).getTime(),
          close: parseFloat(c?.close),
        }))
        .filter((c) => Number.isFinite(c.ts) && Number.isFinite(c.close) && c.close > 0)
        .sort((a, b) => a.ts - b.ts)
        .slice(-180)
    : [];

  if (!priceVal && candles.length === 0) return null;

  const sortedDiff = Array.isArray(difficultyHistory)
    ? difficultyHistory
        .map((d) => ({ ts: Number(d?.ts), difficulty: Number(d?.difficulty) }))
        .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.difficulty) && d.difficulty > 0)
        .sort((a, b) => a.ts - b.ts)
    : [];
  const hasDiffHistory = sortedDiff.length > 0;
  const fallbackEndTs = hasDiffHistory ? sortedDiff[sortedDiff.length - 1].ts : 0;

  // Build timeline points (prefer 180d daily closes; sync final point to live btcPrice if available)
  const points = candles.length >= 2
    ? candles.map((c, idx) => (idx === candles.length - 1 && priceVal > 0 ? { ...c, close: priceVal } : c))
    : [
        { ts: fallbackEndTs - 86400000, close: priceVal },
        { ts: fallbackEndTs, close: priceVal },
      ];

  const fallbackLow = productionCost?.low != null ? parseFloat(productionCost.low) : null;
  const fallbackMid = productionCost?.mid != null ? parseFloat(productionCost.mid) : null;
  const fallbackHigh = productionCost?.high != null ? parseFloat(productionCost.high) : null;

  const resolveCostAtTs = (ts) => {
    if (!hasDiffHistory) {
      return { low: fallbackLow, mid: fallbackMid, high: fallbackHigh };
    }
    let active = sortedDiff[0];
    for (let i = 0; i < sortedDiff.length; i += 1) {
      if (sortedDiff[i].ts <= ts) active = sortedDiff[i];
      else break;
    }
    const range = estimateBtcProductionCostRange(active.difficulty);
    return range || { low: fallbackLow, mid: fallbackMid, high: fallbackHigh };
  };

  const costSeries = points.map((pt) => resolveCostAtTs(pt.ts));
  const hasCostBand = costSeries.some((c) => Number.isFinite(c.mid) || Number.isFinite(c.low) || Number.isFinite(c.high));

  const labels = candles.length >= 2
    ? points.map((pt) => {
        const dt = new Date(pt.ts);
        return `${dt.getDate()}/${dt.getMonth() + 1}`;
      })
    : ['Prior', 'Current'];

  const datasets = [
    {
      label: 'BTC Price ($)',
      data: points.map((pt) => pt.close),
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      fill: false,
      order: 1,
    },
    ...(hasCostBand ? [
      {
        label: 'Cost High ($)',
        data: costSeries.map((c) => c.high),
        borderColor: 'rgba(16, 185, 129, 0.5)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        stepped: hasDiffHistory ? 'before' : false,
        tension: 0,
        fill: false,
        order: 3,
      },
      {
        label: 'Cost Mid ($)',
        data: costSeries.map((c) => c.mid),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        borderWidth: 1.75,
        pointRadius: 0,
        stepped: hasDiffHistory ? 'before' : false,
        tension: 0,
        fill: '-1',
        order: 2,
      },
      {
        label: 'Cost Low ($)',
        data: costSeries.map((c) => c.low),
        borderColor: 'rgba(16, 185, 129, 0.5)',
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        borderWidth: 1,
        borderDash: [4, 4],
        pointRadius: 0,
        stepped: hasDiffHistory ? 'before' : false,
        tension: 0,
        fill: '-1',
        order: 4,
      },
    ] : []),
  ];

  const data = { labels, datasets };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: {
        display: true,
        labels: {
          color: '#94a3b8',
          font: { family: 'monospace', size: 9 },
          boxWidth: 12,
          padding: 8,
        },
      },
      title: {
        display: true,
        text: `🔗 BTC PRICE vs PRODUCTION COST (MVRV: ${mvrvVal || 'N/A'})`,
        color: '#a855f7',
        font: { family: 'monospace', size: 11 },
      },
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed?.y;
            return Number.isFinite(v) ? ` ${ctx.dataset.label}: $${Math.round(v).toLocaleString('en-US')}` : '';
          },
        },
      },
    },
    scales: {
      x: commonOptions.scales.x,
      y: {
        ...commonOptions.scales.y,
        beginAtZero: false,
        ticks: {
          ...commonOptions.scales.y.ticks,
          callback: (val) => `$${Math.round(Number(val) / 1000)}k`,
        },
      },
    },
  };

  const costBandLabel = Number.isFinite(fallbackLow) && Number.isFinite(fallbackHigh)
    ? `Cost: $${Math.round(fallbackLow / 1000)}k–$${Math.round(fallbackHigh / 1000)}k${Number.isFinite(fallbackMid) ? ` (Mid $${Math.round(fallbackMid / 1000)}k)` : ''}`
    : 'Production cost: model estimate';

  return (
    <div className="summary-chart-container" style={{ minHeight: '235px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <div style={{ height: '195px' }}>
        <Line data={data} options={options} />
      </div>
      <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '8px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', borderTop: '1px dashed var(--border-panel)', paddingTop: '6px' }}>
        <span>MVRV: <strong style={{ color: '#a855f7' }}>{mvrvVal || 'N/A'}</strong></span>
        <span>NUPL: <strong>{nupl || 'N/A'}</strong></span>
        <span>{costBandLabel}</span>
      </div>
    </div>
  );
}

/** 6. Chart Thanh khoản Vĩ mô (stat tiles đơn vị gốc + % thay đổi ngày) */
export function MacroLiquidityChart({ data: macroData }) {
  if (!macroData) return null;

  const tiles = [
    { label: 'Net Liquidity', value: macroData.netLiquidity != null ? `$${Number(macroData.netLiquidity).toLocaleString('en-US', { maximumFractionDigits: 0 })}B` : 'N/A', color: '#0ea5e9' },
    { label: 'DXY', value: macroData.dxy != null ? Number(macroData.dxy).toFixed(2) : 'N/A', color: '#f59e0b' },
    { label: 'S&P 500', value: macroData.sp500?.price != null ? Number(macroData.sp500.price).toFixed(0) : 'N/A', color: '#10b981' },
    { label: 'VIX', value: macroData.vix?.price != null ? Number(macroData.vix.price).toFixed(2) : 'N/A', color: '#f43f5e' },
  ];

  const changes = [
    { label: 'S&P 500', value: parseFloat(macroData.sp500?.changePercent) },
    { label: 'QQQ', value: parseFloat(macroData.qqq?.changePercent) },
  ].filter((row) => Number.isFinite(row.value));

  const changeData = {
    labels: changes.map((row) => row.label),
    datasets: [
      {
        label: 'Daily change (%)',
        data: changes.map((row) => row.value),
        backgroundColor: changes.map((row) => row.value >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(244, 63, 94, 0.7)'),
        borderColor: changes.map((row) => row.value >= 0 ? '#10b981' : '#f43f5e'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const changeOptions = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: { display: false },
      title: { display: true, text: '📊 EQUITY DAILY CHANGE (%)', color: '#0ea5e9', font: { family: 'monospace', size: 10 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ minHeight: '210px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
        {tiles.map((tile) => (
          <div key={tile.label} style={{ border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '8px', background: 'var(--bg-slate-950)' }}>
            <div className="font-mono" style={{ fontSize: '0.58rem', color: 'var(--text-slate-400)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{tile.label}</div>
            <div className="font-mono" style={{ fontSize: '0.9rem', fontWeight: 700, color: tile.color }}>{tile.value}</div>
          </div>
        ))}
      </div>
      {changes.length > 0 && (
        <div style={{ height: '120px', marginTop: '12px' }}>
          <Bar data={changeData} options={changeOptions} />
        </div>
      )}
    </div>
  );
}

/** 7. Chart Thanh lý Long vs Short (5m & 1h) */
export function LiquidationChart({ liqStats5m, liqStats1h }) {
  const windows = [
    { label: '5m', stats: liqStats5m },
    { label: '1h', stats: liqStats1h },
  ].filter((row) => row.stats);
  if (windows.length === 0) return null;

  const toMillions = (value) => (Number.isFinite(Number(value)) ? Number(value) / 1e6 : 0);
  const hasNonZeroLiq = windows.some(
    (row) => toMillions(row.stats.longLiqUsd) > 0 || toMillions(row.stats.shortLiqUsd) > 0
  );
  const data = {
    labels: windows.map((row) => row.label),
    datasets: [
      {
        label: 'Long liquidated ($M)',
        data: windows.map((row) => toMillions(row.stats.longLiqUsd)),
        backgroundColor: 'rgba(244, 63, 94, 0.7)',
        borderColor: '#f43f5e',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Short liquidated ($M)',
        data: windows.map((row) => toMillions(row.stats.shortLiqUsd)),
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 4,
      },
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '💥 LIQUIDATIONS — BINANCE BTCUSDT (USD, SESSION WINDOW)', color: '#f43f5e', font: { family: 'monospace', size: 11 } },
      tooltip: {
        ...commonOptions.plugins.tooltip,
        callbacks: {
          afterLabel: (ctx) => {
            const stats = windows[ctx.dataIndex]?.stats;
            if (!stats) return '';
            return ` Events: ${ctx.datasetIndex === 0 ? stats.longLiqCount ?? 'N/A' : stats.shortLiqCount ?? 'N/A'} | Dominance: ${stats.dominanceLabel || 'N/A'}`;
          }
        }
      }
    }
  };

  return (
    <div className="summary-chart-container" style={{ minHeight: '200px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <div style={{ height: hasNonZeroLiq ? '170px' : '150px' }}>
        <Bar data={data} options={options} />
      </div>
      {!hasNonZeroLiq && (
        <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginTop: '6px', textAlign: 'center', borderTop: '1px dashed var(--border-panel)', paddingTop: '5px' }}>
          Chưa ghi nhận lệnh thanh lý trong cửa sổ phiên hiện tại (0 USD)
        </div>
      )}
    </div>
  );
}

/** 8. Chart Deribit Options — Call/Put OI theo strike, highlight Max Pain */
export function OptionsStrikeChart({ options }) {
  const distribution = options?.strikeDistribution;
  if (!Array.isArray(distribution) || distribution.length === 0) return null;

  const spot = Number(options?.meta?.underlyingPrice) || null;
  const inRange = spot
    ? distribution.filter((row) => Math.abs(row.strike - spot) / spot <= 0.2)
    : distribution;
  const strikes = (inRange.length > 0 ? inRange : distribution)
    .slice()
    .sort((a, b) => (b.callOI + b.putOI) - (a.callOI + a.putOI))
    .slice(0, 8)
    .sort((a, b) => a.strike - b.strike);

  const maxPainStrike = options?.maxPain?.maxPainPrice ?? null;
  const formatStrike = (value) => `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;

  const data = {
    labels: strikes.map((row) => formatStrike(row.strike)),
    datasets: [
      {
        label: 'Call OI',
        data: strikes.map((row) => row.callOI),
        backgroundColor: strikes.map((row) => row.strike === maxPainStrike ? 'rgba(245, 158, 11, 0.95)' : 'rgba(16, 185, 129, 0.7)'),
        borderColor: strikes.map((row) => row.strike === maxPainStrike ? '#f59e0b' : '#10b981'),
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Put OI',
        data: strikes.map((row) => row.putOI),
        backgroundColor: 'rgba(244, 63, 94, 0.65)',
        borderColor: '#f43f5e',
        borderWidth: 1,
        borderRadius: 4,
      },
    ]
  };

  const wallText = [
    options?.callWall?.strike != null ? `CALL WALL $${Number(options.callWall.strike).toLocaleString('en-US')}` : null,
    options?.putWall?.strike != null ? `PUT WALL $${Number(options.putWall.strike).toLocaleString('en-US')}` : null,
    maxPainStrike != null ? `MAX PAIN $${Number(maxPainStrike).toLocaleString('en-US')}` : null,
  ].filter(Boolean).join(' · ');

  const options_ = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: `🎯 DERIBIT BTC OPTIONS — ${wallText || 'STRIKE OPEN INTEREST'}`, color: '#8b5cf6', font: { family: 'monospace', size: 10 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '220px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={data} options={options_} />
    </div>
  );
}

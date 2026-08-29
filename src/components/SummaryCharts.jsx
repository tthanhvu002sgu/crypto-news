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
export function FundingOiChart({ oiHistory, fundingRates }) {
  if (!oiHistory || oiHistory.length === 0) return null;
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
      }
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '⚡ BIẾN ĐỘNG OPEN INTEREST (OI)', color: '#3b82f6', font: { family: 'monospace', size: 11 } }
    },
    scales: {
      x: commonOptions.scales.x,
      yOi: {
        type: 'linear',
        display: true,
        position: 'left',
        ticks: { color: '#3b82f6', font: { family: 'monospace', size: 10 } },
        grid: { color: 'rgba(51, 65, 85, 0.3)' }
      }
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
        label: 'Net Flow (Trạc $M)',
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
    { label: 'Asset Manager (Quỹ)', net: cotData.assetManager?.net || 0 },
    { label: 'Leveraged Funds (Đòn bẩy)', net: cotData.leveragedFunds?.net || 0 },
    { label: 'Dealer Intermediary', net: cotData.dealerIntermediary?.net || 0 },
    { label: 'Other Reportables', net: cotData.otherReportables?.net || 0 },
    { label: 'Non-Reportable', net: cotData.nonReportable?.net || 0 }
  ];

  const data = {
    labels: groups.map(g => g.label),
    datasets: [
      {
        label: 'Vị thế Ròng Net Contracts (Long - Short)',
        data: groups.map(g => g.net),
        backgroundColor: groups.map(g => g.net >= 0 ? 'rgba(59, 130, 246, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
        borderColor: groups.map(g => g.net >= 0 ? '#3b82f6' : '#ef4444'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const options = {
    ...commonOptions,
    indexAxis: 'y', // Horizontal Bar Chart
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: `🏛️ CME COT POSITIONING (AS OF ${cotData.date || 'LATEST'})`, color: '#8b5cf6', font: { family: 'monospace', size: 11 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '230px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

/** 5. Chart Định giá On-chain: BTC MVRV & Production Cost */
export function OnChainValuationChart({ mvrv, btcPrice, productionCost }) {
  const mvrvVal = parseFloat(mvrv || 0);
  const priceVal = parseFloat(btcPrice || 0);

  const data = {
    labels: ['BTC Price ($)', 'Production Cost ($k)', 'MVRV Ratio'],
    datasets: [
      {
        label: 'Chỉ số Định giá On-chain',
        data: [priceVal, (productionCost?.mid || 65000), mvrvVal * 10000],
        backgroundColor: ['rgba(245, 158, 11, 0.7)', 'rgba(16, 185, 129, 0.7)', 'rgba(139, 92, 246, 0.7)'],
        borderColor: ['#f59e0b', '#10b981', '#8b5cf6'],
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: `🔗 ON-CHAIN VALUATION (MVRV: ${mvrvVal || 'N/A'})`, color: '#a855f7', font: { family: 'monospace', size: 11 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '200px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

/** 6. Chart Thanh khoản Vĩ mô (US Net Liquidity vs DXY/VIX) */
export function MacroLiquidityChart({ data: macroData }) {
  if (!macroData) return null;

  const metrics = [
    { label: 'Net Liquidity ($B)', value: parseFloat(macroData.netLiquidity || 0) },
    { label: 'DXY Index (*10)', value: parseFloat(macroData.dxy || 0) * 10 },
    { label: 'S&P 500 (*1)', value: parseFloat(macroData.sp500?.price || 0) },
    { label: 'VIX (*100)', value: parseFloat(macroData.vix?.price || 0) * 100 },
  ];

  const chartData = {
    labels: metrics.map(m => m.label),
    datasets: [
      {
        label: 'Các chỉ số Vĩ mô Toàn cầu',
        data: metrics.map(m => m.value),
        backgroundColor: 'rgba(14, 165, 233, 0.6)',
        borderColor: '#0ea5e9',
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const options = {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      title: { display: true, text: '🌍 BỐI CẢNH THANH KHOẢN VĨ MÔ TOÀN CẦU', color: '#0ea5e9', font: { family: 'monospace', size: 11 } }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '210px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}

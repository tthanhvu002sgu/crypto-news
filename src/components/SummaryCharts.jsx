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

export function EtfChart({ etfHistory }) {
  if (!etfHistory || etfHistory.length === 0) return null;
  const flows = [...etfHistory].slice(-10); // Show last 10 days
  const data = {
    labels: flows.map(f => f.date),
    datasets: [
      {
        label: 'Net Flow (M USD)',
        data: flows.map(f => parseFloat(f.flow || 0)),
        backgroundColor: flows.map(f => parseFloat(f.flow || 0) >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)'),
        borderColor: flows.map(f => parseFloat(f.flow || 0) >= 0 ? '#10b981' : '#f43f5e'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  return (
    <div className="summary-chart-container" style={{ height: '220px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Bar data={data} options={commonOptions} />
    </div>
  );
}

export function CvdChart({ cvdData }) {
  if (!cvdData || cvdData.length === 0) return null;
  
  const step = Math.max(1, Math.floor(cvdData.length / 50));
  const sampled = cvdData.filter((_, i) => i % step === 0 || i === cvdData.length - 1);

  const data = {
    labels: sampled.map(d => {
      const dt = new Date(d.timestamp || d.time); // Handle different time keys
      return `${dt.getDate()}/${dt.getMonth()+1} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }),
    datasets: [
      {
        label: 'Price',
        data: sampled.map(d => parseFloat(d.price)),
        borderColor: '#e2e8f0',
        backgroundColor: 'transparent',
        yAxisID: 'yPrice',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1
      },
      {
        label: 'CVD (Taker Flow)',
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
        ticks: { color: '#f59e0b', font: { family: 'monospace', size: 10 } },
        grid: { drawOnChartArea: false }
      }
    }
  };

  return (
    <div className="summary-chart-container" style={{ height: '240px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Line data={data} options={options} />
    </div>
  );
}

export function OiChart({ oiHistory }) {
  if (!oiHistory || oiHistory.length === 0) return null;
  const data = {
    labels: oiHistory.map(d => {
      const dt = new Date(d.timestamp);
      return `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }),
    datasets: [
      {
        label: 'Open Interest (BTC)',
        data: oiHistory.map(d => d.sumOpenInterest),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.1
      }
    ]
  };

  return (
    <div className="summary-chart-container" style={{ height: '220px', width: '100%', marginTop: '16px', marginBottom: '16px', padding: '16px', background: 'var(--bg-panel-solid)', borderRadius: '8px', border: '1px solid var(--border-panel)' }}>
      <Line data={data} options={commonOptions} />
    </div>
  );
}

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler
} from 'chart.js';
import {
  Info,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Scale,
  Users,
  Building2,
  Calendar,
  Layers,
  HelpCircle,
  RefreshCw
} from 'lucide-react';
import ModuleMenu from './ModuleMenu';
import { COT_REGIMES, processCotData } from '../services/cotEngine';
import { getCMECot } from '../services/api';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  Filler
);

const fmtSigned = (val) => {
  if (val == null || !Number.isFinite(val)) return '---';
  return `${val > 0 ? '+' : ''}${val.toLocaleString()}`;
};

function MarkdownNarrative({ content }) {
  if (!content) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <p style={{ margin: 0, lineHeight: 1.6 }} {...props} />,
        strong: ({ node, ...props }) => <strong style={{ color: 'var(--text-contrast)', fontWeight: 'bold' }} {...props} />,
        em: ({ node, ...props }) => <em style={{ fontStyle: 'italic', color: 'var(--text-contrast)' }} {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function CmeCotCard({ cotData, theme = 'dark', moduleId = 'dash_cme_cot' }) {
  const [activeTab, setActiveTab] = useState('narrative'); // 'narrative' | 'chart_net' | 'chart_oi' | 'table'
  const [chartWeeks, setChartWeeks] = useState(26); // 12 | 26 | 52
  const [showGuide, setShowGuide] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Tự động enrich nếu cotData truyền từ props bị thiếu history (ví dụ từ cache cũ của browser)
  const currentCot = useMemo(() => {
    const raw = liveData || cotData;
    if (!raw) return processCotData();
    if (Array.isArray(raw.history) && raw.history.length > 0 && raw.narrative) {
      return raw;
    }
    return processCotData([raw]) || processCotData();
  }, [liveData, cotData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await getCMECot();
      if (res && res.history) {
        setLiveData(res);
      }
    } catch (err) {
      console.error('CME COT manual refresh error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const isLight = theme === 'light';
  const textColor = isLight ? '#334155' : '#94a3b8';
  const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

  // Dữ liệu analytics & deltas
  const analytics = currentCot?.analytics;
  const history = useMemo(() => {
    if (!Array.isArray(currentCot?.history)) return [];
    return [...currentCot.history].reverse(); // Đảo ngược để vẽ biểu đồ theo thứ tự thời gian tăng dần
  }, [currentCot?.history]);

  const slicedHistory = useMemo(() => {
    if (history.length === 0) return [];
    return history.slice(Math.max(0, history.length - chartWeeks));
  }, [history, chartWeeks]);

  const regime = currentCot?.regime || COT_REGIMES.BALANCED_NEUTRAL;
  const narrative = currentCot?.narrative;
  const deltas = analytics?.deltas || {
    amWoW: currentCot?.assetManager?.netChange || 0,
    am4W: 0,
    lfWoW: currentCot?.leveragedFunds?.netChange || 0,
    lf4W: 0,
    oiWoW: currentCot?.openInterestChange || 0,
    oi4W: 0,
  };

  const amCotIndex = analytics?.amCotIndex ?? (currentCot?.assetManager?.net > 2000 ? 70 : 45);
  const lfCotIndex = analytics?.lfCotIndex ?? 50;

  // ─── Biểu đồ 1: Vị thế Ròng Lịch Sử (Net History Chart) ──────────────────────
  const netChartData = useMemo(() => {
    const labels = slicedHistory.map(h => h.date.replace('/20', '/'));
    const amNets = slicedHistory.map(h => h.assetManager?.net ?? 0);
    const lfNets = slicedHistory.map(h => h.leveragedFunds?.net ?? 0);
    const retailNets = slicedHistory.map(h => h.nonReportable?.net ?? 0);

    return {
      labels,
      datasets: [
        {
          label: 'Asset Managers (Quỹ Thể Chế)',
          data: amNets,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: slicedHistory.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Leveraged Funds (Hedge Funds)',
          data: lfNets,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: slicedHistory.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Retail / Non-Reportable (Cá Nhân)',
          data: retailNets,
          borderColor: '#f59e0b',
          borderDash: [4, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          borderWidth: 1.5,
          pointRadius: slicedHistory.length > 30 ? 0 : 2,
          pointHoverRadius: 4,
        }
      ]
    };
  }, [slicedHistory]);

  const netChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: textColor,
          font: { family: 'monospace', size: 10 },
          boxWidth: 12,
        }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const val = context.parsed.y;
            return ` ${context.dataset.label}: ${val >= 0 ? '+' : ''}${val.toLocaleString()} contracts`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: textColor, font: { family: 'monospace', size: 9 }, maxRotation: 45 }
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          font: { family: 'monospace', size: 9 },
          callback: (v) => `${v >= 0 ? '+' : ''}${v}`
        }
      }
    }
  }), [textColor, gridColor]);

  // ─── Biểu đồ 2: Open Interest & COT Index ──────────────────────────────────
  const oiChartData = useMemo(() => {
    const labels = slicedHistory.map(h => h.date.replace('/20', '/'));
    const ois = slicedHistory.map(h => h.openInterest ?? 0);

    return {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Open Interest (Hợp đồng mở)',
          data: ois,
          backgroundColor: 'rgba(59, 130, 246, 0.45)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 3,
          yAxisID: 'y'
        }
      ]
    };
  }, [slicedHistory]);

  const oiChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { color: textColor, font: { family: 'monospace', size: 10 }, boxWidth: 12 }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` OI: ${ctx.parsed.y.toLocaleString()} contracts`
        }
      }
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: textColor, font: { family: 'monospace', size: 9 } }
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          font: { family: 'monospace', size: 9 },
          callback: (v) => v.toLocaleString()
        }
      }
    }
  }), [textColor, gridColor]);

  if (!currentCot) {
    return (
      <div className="glass-panel whale-panel" style={{ padding: '20px', textAlign: 'center' }}>
        <span className="font-mono text-slate-500">Đang tải dữ liệu CME Bitcoin Futures COT...</span>
      </div>
    );
  }

  const am = currentCot.assetManager || { long: 0, short: 0, net: 0, netChange: 0 };
  const lf = currentCot.leveragedFunds || { long: 0, short: 0, net: 0, netChange: 0 };
  const retail = currentCot.nonReportable || { long: 0, short: 0, net: 0, netChange: 0 };

  return (
    <div className="fng-cot-row">
      <div className="glass-panel whale-panel" style={{ height: '100%', overflow: 'hidden', padding: '16px' }}>
        
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 className="chart-title font-mono text-amber" style={{ margin: 0, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="dot dot-amber" /> CME BITCOIN FUTURES COT
              </h3>
              <span className="font-mono text-slate-400" style={{ fontSize: '0.68rem', backgroundColor: 'var(--bg-panel-solid, rgba(0,0,0,0.2))', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-panel)' }}>
                AS OF {currentCot.date || 'LATEST'}
              </span>
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 600,
                color: regime.color,
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: `1px solid ${regime.color}`,
                padding: '2px 8px',
                borderRadius: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span>{regime.icon}</span> {regime.label}
              </span>
            </div>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.6rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>CFTC TFF Report • Độ trễ ~3-7 ngày (Thứ 6 phát hành số liệu phiên Thứ 3)</span>
              <button
                type="button"
                onClick={() => setShowGuide(prev => !prev)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-amber-500)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                  padding: 0,
                  fontSize: '0.6rem'
                }}
              >
                <HelpCircle size={11} /> {showGuide ? 'Đóng hướng dẫn' : 'Ý nghĩa các nhóm'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Làm mới trực tiếp từ CFTC Socrata API"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-panel)',
                borderRadius: '4px',
                padding: '3px 8px',
                color: 'var(--text-contrast)',
                cursor: isRefreshing ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.62rem',
                fontFamily: 'monospace'
              }}
            >
              <RefreshCw size={11} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
              <span>{isRefreshing ? 'Đang tải...' : 'Làm mới CFTC'}</span>
            </button>
            <ModuleMenu moduleId={moduleId} />
          </div>
        </div>

        {/* Cẩm nang giải thích nhanh (Collapsible Guide) */}
        {showGuide && (
          <div style={{
            backgroundColor: 'var(--bg-panel-solid, rgba(15,23,42,0.6))',
            border: '1px solid var(--border-panel)',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '14px',
            fontSize: '0.68rem',
            lineHeight: 1.5,
            color: 'var(--text-contrast)'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px', color: 'var(--color-amber-500)' }}>
              📘 Ý NGHĨA CÁC NHÓM NHÀ ĐẦU TƯ CFTC TFF:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
              <div>
                <strong style={{ color: '#10b981' }}>• Asset Managers (Smart Money):</strong> Quỹ ETF, quản lý tài sản, hưu trí. Thường Long dài hạn.
              </div>
              <div>
                <strong style={{ color: '#ef4444' }}>• Leveraged Funds (Hedge Funds):</strong> Quỹ đầu cơ đòn bẩy. Thường Short phòng hộ Basis Trade (ăn lãi chênh lệch).
              </div>
              <div>
                <strong style={{ color: '#3b82f6' }}>• Dealer Intermediary:</strong> Nhà tạo lập thị trường, cân bằng thanh khoản giữa các bên.
              </div>
              <div>
                <strong style={{ color: '#f59e0b' }}>• Non-Reportable (Retail):</strong> Nhà đầu tư cá nhân nhỏ lẻ (chỉ báo tâm lý đám đông).
              </div>
            </div>
          </div>
        )}

        {/* Thanh Chỉ Số Tổng Quan (Executive Metrics Ribbon) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '10px',
          marginBottom: '14px'
        }}>
          {/* Card 1: Open Interest */}
          <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Layers size={12} /> TỔNG OPEN INTEREST
            </div>
            <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '4px', color: 'var(--text-contrast)' }}>
              {currentCot.openInterest ? currentCot.openInterest.toLocaleString() : '---'} <span style={{ fontSize: '0.62rem', fontWeight: 'normal', color: 'var(--text-slate-500)' }}>hđ</span>
            </div>
            <div className="font-mono" style={{ fontSize: '0.6rem', marginTop: '4px', display: 'flex', gap: '6px' }}>
              <span style={{ color: deltas.oiWoW >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                WoW: {fmtSigned(deltas.oiWoW)}
              </span>
              {deltas.oi4W !== 0 && (
                <span style={{ color: deltas.oi4W >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                  4W: {fmtSigned(deltas.oi4W)}
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Asset Managers */}
          <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={12} color="#10b981" /> ASSET MANAGERS (QUỸ)</span>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>{amCotIndex}% COT Idx</span>
            </div>
            <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '4px', color: '#10b981' }}>
              {am.net >= 0 ? `+${am.net.toLocaleString()}` : am.net.toLocaleString()} <span style={{ fontSize: '0.62rem', fontWeight: 'normal', color: 'var(--text-slate-500)' }}>Net</span>
            </div>
            <div className="font-mono" style={{ fontSize: '0.6rem', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: deltas.amWoW >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                WoW: {fmtSigned(deltas.amWoW)}
              </span>
              <span style={{ color: deltas.am4W >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                4W: {fmtSigned(deltas.am4W)}
              </span>
            </div>
            {/* Visual Gauge Bar */}
            <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${amCotIndex}%`, height: '100%', backgroundColor: '#10b981', borderRadius: '2px' }} />
            </div>
          </div>

          {/* Card 3: Leveraged Funds */}
          <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Scale size={12} color="#ef4444" /> LEVERAGED (HEDGE FUNDS)</span>
              <span style={{ color: '#ef4444' }}>Basis Arb</span>
            </div>
            <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '4px', color: '#ef4444' }}>
              {lf.net.toLocaleString()} <span style={{ fontSize: '0.62rem', fontWeight: 'normal', color: 'var(--text-slate-500)' }}>Net</span>
            </div>
            <div className="font-mono" style={{ fontSize: '0.6rem', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: deltas.lfWoW >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                WoW: {fmtSigned(deltas.lfWoW)}
              </span>
              <span style={{ color: deltas.lf4W >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                4W: {fmtSigned(deltas.lf4W)}
              </span>
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${lfCotIndex}%`, height: '100%', backgroundColor: '#ef4444', borderRadius: '2px' }} />
            </div>
          </div>

          {/* Card 4: Retail Non-Reportable */}
          <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Users size={12} color="#f59e0b" /> RETAIL (CÁ NHÂN)</span>
              <span style={{ color: retail.net >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                {retail.net >= 0 ? 'Long Bias' : 'Short Bias'}
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '4px', color: retail.net >= 0 ? '#10b981' : '#ef4444' }}>
              {retail.net >= 0 ? `+${retail.net.toLocaleString()}` : retail.net.toLocaleString()} <span style={{ fontSize: '0.62rem', fontWeight: 'normal', color: 'var(--text-slate-500)' }}>Net</span>
            </div>
            <div className="font-mono" style={{ fontSize: '0.6rem', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: deltas.retailWoW >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                WoW: {fmtSigned(deltas.retailWoW)}
              </span>
              <span style={{ color: 'var(--text-slate-500)' }}>
                {retail.long + retail.short > 0 ? `${((retail.long / (retail.long + retail.short)) * 100).toFixed(0)}% Long` : '---'}
              </span>
            </div>
            <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
              <div style={{ width: `${analytics?.retailCotIndex ?? 50}%`, height: '100%', backgroundColor: '#f59e0b', borderRadius: '2px' }} />
            </div>
          </div>
        </div>

        {/* Tab Switcher & Sub-Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-panel)', paddingBottom: '8px', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('narrative')}
              className="tab-btn"
              style={{
                padding: '5px 10px',
                fontSize: '0.68rem',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: activeTab === 'narrative' ? 'var(--color-amber-500)' : 'var(--border-panel)',
                backgroundColor: activeTab === 'narrative' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: activeTab === 'narrative' ? 'var(--color-amber-500)' : 'var(--text-contrast)',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              🧠 DIỄN GIẢI CHIẾN LƯỢC
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chart_net')}
              className="tab-btn"
              style={{
                padding: '5px 10px',
                fontSize: '0.68rem',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: activeTab === 'chart_net' ? 'var(--color-amber-500)' : 'var(--border-panel)',
                backgroundColor: activeTab === 'chart_net' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: activeTab === 'chart_net' ? 'var(--color-amber-500)' : 'var(--text-contrast)',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              📈 BIỂU ĐỒ LỊCH SỬ VỊ THẾ
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chart_oi')}
              className="tab-btn"
              style={{
                padding: '5px 10px',
                fontSize: '0.68rem',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: activeTab === 'chart_oi' ? 'var(--color-amber-500)' : 'var(--border-panel)',
                backgroundColor: activeTab === 'chart_oi' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: activeTab === 'chart_oi' ? 'var(--color-amber-500)' : 'var(--text-contrast)',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              📊 XU HƯỚNG OPEN INTEREST
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className="tab-btn"
              style={{
                padding: '5px 10px',
                fontSize: '0.68rem',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: activeTab === 'table' ? 'var(--color-amber-500)' : 'var(--border-panel)',
                backgroundColor: activeTab === 'table' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: activeTab === 'table' ? 'var(--color-amber-500)' : 'var(--text-contrast)',
                cursor: 'pointer',
                fontFamily: 'monospace'
              }}
            >
              📑 BẢNG CHI TIẾT CFTC
            </button>
          </div>

          {(activeTab === 'chart_net' || activeTab === 'chart_oi') && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span className="font-mono text-slate-500" style={{ fontSize: '0.6rem' }}>Khung:</span>
              {[12, 26, 52].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setChartWeeks(w)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '0.58rem',
                    borderRadius: '3px',
                    border: '1px solid',
                    borderColor: chartWeeks === w ? 'var(--color-emerald-500)' : 'var(--border-panel)',
                    backgroundColor: chartWeeks === w ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    color: chartWeeks === w ? '#10b981' : 'var(--text-slate-500)',
                    cursor: 'pointer',
                    fontFamily: 'monospace'
                  }}
                >
                  {w}W ({Math.round(w / 4)}M)
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── TAB 1: DIỄN GIẢI CHIẾN LƯỢC (NARRATIVE) ───────────────────────── */}
        {activeTab === 'narrative' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Executive Synthesis Banner */}
            <div style={{
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              borderLeft: '3px solid var(--color-amber-500)',
              padding: '10px 14px',
              borderRadius: '0 6px 6px 0',
              fontSize: '0.74rem',
              lineHeight: 1.6,
              color: 'var(--text-contrast)'
            }}>
              <strong style={{ color: 'var(--color-amber-500)', display: 'block', marginBottom: '2px' }}>
                💡 TỔNG QUAN PHÁI SINH THỂ CHẾ:
              </strong>
              <MarkdownNarrative content={narrative?.overview || 'Cấu trúc vị thế CME phản ánh phân tầng rõ nét: Asset Managers giữ Long chủ đạo, trong khi Hedge Funds mở Short để phòng hộ Basis Arbitrage.'} />
            </div>

            {/* Deep-dive 3 Pillars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              
              {/* Pillar 1: Smart Money */}
              <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '12px 14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#10b981', fontWeight: 'bold', fontSize: '0.72rem' }}>
                  <Building2 size={14} /> 1. SMART MONEY (ASSET MANAGERS)
                </div>
                <div style={{ fontSize: '0.7rem', lineHeight: 1.6, color: 'var(--text-contrast)' }}>
                  <MarkdownNarrative content={narrative?.smartMoney || `Asset Managers nắm giữ vị thế ròng **+${am.net.toLocaleString()} hđ**, tiếp tục duy trì tích lũy dài hạn.`} />
                </div>
                <div className="font-mono text-slate-500" style={{ fontSize: '0.62rem', marginTop: '8px', borderTop: '1px dashed var(--border-panel)', paddingTop: '6px' }}>
                  Biên độ 26 tuần: {analytics?.amRange26W?.min?.toLocaleString() || '---'} ~ {analytics?.amRange26W?.max?.toLocaleString() || '---'} hđ
                </div>
              </div>

              {/* Pillar 2: Hedge Funds */}
              <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '12px 14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#ef4444', fontWeight: 'bold', fontSize: '0.72rem' }}>
                  <Scale size={14} /> 2. HEDGE FUNDS (LEVERAGED)
                </div>
                <div style={{ fontSize: '0.7rem', lineHeight: 1.6, color: 'var(--text-contrast)' }}>
                  <MarkdownNarrative content={narrative?.hedgeFunds || `Leveraged Funds nắm giữ Short ròng **${lf.net.toLocaleString()} hđ**, chủ yếu phục vụ Basis Trade ăn chênh lệch.`} />
                </div>
                <div className="font-mono text-slate-500" style={{ fontSize: '0.62rem', marginTop: '8px', borderTop: '1px dashed var(--border-panel)', paddingTop: '6px' }}>
                  Biên độ 26 tuần: {analytics?.lfRange26W?.min?.toLocaleString() || '---'} ~ {analytics?.lfRange26W?.max?.toLocaleString() || '---'} hđ
                </div>
              </div>

              {/* Pillar 3: Retail Sentiment */}
              <div style={{ background: 'var(--bg-panel-solid, rgba(0,0,0,0.15))', padding: '12px 14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#f59e0b', fontWeight: 'bold', fontSize: '0.72rem' }}>
                  <Users size={14} /> 3. RETAIL (NON-REPORTABLE)
                </div>
                <div style={{ fontSize: '0.7rem', lineHeight: 1.6, color: 'var(--text-contrast)' }}>
                  <MarkdownNarrative content={narrative?.retail || `Cá nhân nhỏ lẻ nắm giữ Net **${retail.net >= 0 ? '+' : ''}${retail.net.toLocaleString()} hđ**, đóng vai trò thước đo tâm lý đám đông.`} />
                </div>
                <div className="font-mono text-slate-500" style={{ fontSize: '0.62rem', marginTop: '8px', borderTop: '1px dashed var(--border-panel)', paddingTop: '6px' }}>
                  Tỷ lệ L/S: {retail.long.toLocaleString()} / {retail.short.toLocaleString()} ({((retail.long / ((retail.long + retail.short) || 1)) * 100).toFixed(1)}% Long)
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ─── TAB 2: BIỂU ĐỒ LỊCH SỬ VỊ THẾ RÒNG (NET HISTORY) ──────────────── */}
        {activeTab === 'chart_net' && (
          <div style={{ height: '300px', width: '100%', position: 'relative' }}>
            {history.length > 0 ? (
              <Line data={netChartData} options={netChartOptions} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-slate-500)', fontSize: '0.75rem' }}>
                Đang nạp dữ liệu lịch sử vị thế đa tuần từ CFTC...
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 3: BIỂU ĐỒ OPEN INTEREST (OI HISTORY) ─────────────────────── */}
        {activeTab === 'chart_oi' && (
          <div style={{ height: '300px', width: '100%', position: 'relative' }}>
            {history.length > 0 ? (
              <Bar data={oiChartData} options={oiChartOptions} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-slate-500)', fontSize: '0.75rem' }}>
                Đang nạp dữ liệu lịch sử Open Interest...
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 4: BẢNG CHI TIẾT CFTC (TABLE) ─────────────────────────────── */}
        {activeTab === 'table' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="whale-table font-mono" style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Nhóm Nhà Đầu Tư</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Long</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Short</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Vị Thế Net</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Thay Đổi Tuần</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Thay Đổi 4W</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>% Tổng OI</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}># Traders</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Asset Manager / Institutional', key: 'assetManager', icon: '🏛️', deltaKey: 'am' },
                  { label: 'Leveraged Funds', key: 'leveragedFunds', icon: '⚡', deltaKey: 'lf' },
                  { label: 'Dealer Intermediary', key: 'dealerIntermediary', icon: '🏦', deltaKey: 'dealer' },
                  { label: 'Nonreportable Positions (Retail)', key: 'nonReportable', icon: '👥', deltaKey: 'retail' },
                  { label: 'Other Reportables', key: 'otherReportables', icon: '📋', deltaKey: null },
                ].map(row => {
                  const rData = currentCot[row.key];
                  if (!rData) return null;

                  const wowChange = rData.netChange != null ? rData.netChange : (row.deltaKey ? deltas[`${row.deltaKey}WoW`] : null);
                  const fourWeekChange = row.deltaKey ? deltas[`${row.deltaKey}4W`] : null;

                  return (
                    <tr key={row.key} style={{ borderBottom: '1px solid var(--border-panel)', backgroundColor: row.key === 'nonReportable' ? 'rgba(0,0,0,0.1)' : 'transparent' }}>
                      <td style={{ padding: '8px 4px', color: 'var(--text-contrast)', fontWeight: 'bold' }}>
                        <span style={{ marginRight: '4px' }}>{row.icon}</span> {row.label}
                      </td>
                      
                      {/* Long */}
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        <div>{rData.long.toLocaleString()}</div>
                        {rData.longChange !== 0 && rData.longChange != null && (
                          <div style={{ fontSize: '0.55rem', color: rData.longChange > 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)' }}>
                            {rData.longChange > 0 ? '+' : ''}{rData.longChange.toLocaleString()}
                          </div>
                        )}
                      </td>

                      {/* Short */}
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        <div>{rData.short.toLocaleString()}</div>
                        {rData.shortChange !== 0 && rData.shortChange != null && (
                          <div style={{ fontSize: '0.55rem', color: rData.shortChange > 0 ? 'var(--color-rose-500)' : 'var(--color-emerald-500)' }}>
                            {rData.shortChange > 0 ? '+' : ''}{rData.shortChange.toLocaleString()}
                          </div>
                        )}
                      </td>

                      {/* Net */}
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 'bold', color: rData.net >= 0 ? '#10b981' : '#ef4444' }}>
                        {rData.net >= 0 ? `+${rData.net.toLocaleString()}` : rData.net.toLocaleString()}
                      </td>

                      {/* WoW */}
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        {wowChange != null ? (
                          <span style={{
                            padding: '1px 4px',
                            borderRadius: '2px',
                            fontSize: '0.58rem',
                            color: 'white',
                            backgroundColor: wowChange > 0 ? 'var(--color-emerald-500)' : wowChange < 0 ? 'var(--color-rose-500)' : 'var(--text-slate-500)'
                          }}>
                            {fmtSigned(wowChange)}
                          </span>
                        ) : '---'}
                      </td>

                      {/* 4W */}
                      <td style={{ padding: '8px 4px', textAlign: 'right', color: fourWeekChange > 0 ? 'var(--color-emerald-500)' : fourWeekChange < 0 ? 'var(--color-rose-500)' : 'inherit' }}>
                        {fourWeekChange != null ? fmtSigned(fourWeekChange) : '---'}
                      </td>

                      {/* % OI */}
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        {typeof rData.longOi === 'number' && typeof rData.shortOi === 'number'
                          ? `L: ${rData.longOi.toFixed(1)}% / S: ${rData.shortOi.toFixed(1)}%`
                          : '---'}
                      </td>

                      {/* Traders */}
                      <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-slate-500)' }}>
                        {rData.longTraders != null && rData.shortTraders != null
                          ? `${rData.longTraders}L / ${rData.shortTraders}S`
                          : '---'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--border-panel)' }}>
          <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem' }}>
            Nguồn: CFTC Public Reporting API • Phân hệ: Overview &amp; Institutional Positioning
          </div>
          <div className="font-mono text-slate-500" style={{ fontSize: '0.55rem' }}>
            Dữ liệu lịch sử lưu trữ: {history.length} tuần gần nhất
          </div>
        </div>

      </div>
    </div>
  );
}

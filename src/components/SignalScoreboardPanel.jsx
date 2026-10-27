import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  Award, Activity, ChevronDown, ChevronUp, HelpCircle,
  ShieldCheck, Database, Sparkles, Compass
} from 'lucide-react';
import ModuleMenu from './ModuleMenu';
import { generateSignalScoreboard, SCOREBOARD_HORIZONS } from '../services/signalScoreboardService';
import { getBiasSnapshots } from '../services/biasSnapshotStore';
import { loadMovePreview, queryMoveEvents } from '../services/moveEventStore';

export default function SignalScoreboardPanel({
  data,
  etfHistory = [],
  moduleId = 'dash_signal_scoreboard',
}) {
  const [selectedHorizon, setSelectedHorizon] = useState('1D'); // '1D' | '3D' | '7D'
  const [activeCategory, setActiveCategory] = useState('ALL'); // 'ALL' | 'biasRegime' | 'capitalFlow' | 'scannerRank' | 'moveTracker'
  const [expandedSignalId, setExpandedSignalId] = useState(null);
  const [liveSnapshots] = useState(() => getBiasSnapshots(100));
  const [moveEvents, setMoveEvents] = useState(() => loadMovePreview());

  // Tải đầy đủ chuỗi sự kiện IndexedDB MoveTracker (đến 90 ngày) thay vì chỉ preview 20 item
  useEffect(() => {
    let isMounted = true;
    queryMoveEvents({ limit: 500 }).then((events) => {
      if (isMounted && Array.isArray(events) && events.length > 0) {
        setMoveEvents(events);
      }
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const scannerDataProp = data?.scannerData;

  // Lấy scanner snapshot từ data hoặc localStorage cache nếu có
  const activeScannerData = useMemo(() => {
    if (scannerDataProp) return scannerDataProp;
    if (typeof localStorage !== 'undefined') {
      try {
        const manifestStr = localStorage.getItem('crypto_scanner_v9_manifest');
        if (manifestStr) {
          const manifest = JSON.parse(manifestStr);
          const latestDate = manifest?.snapshots?.[0]?.date;
          if (latestDate) {
            const cachedSnapStr = localStorage.getItem(`crypto_scanner_v9_snapshot_${latestDate}`);
            if (cachedSnapStr) {
              return JSON.parse(cachedSnapStr);
            }
          }
        }
      } catch {
        // Ignore localStorage parsing issues
      }
    }
    return null;
  }, [scannerDataProp]);

  const scoreboard = useMemo(() => {
    return generateSignalScoreboard({
      dashboardData: data,
      etfHistory,
      liveSnapshots,
      moveEvents,
      scannerData: activeScannerData,
      selectedHorizon,
    });
  }, [data, etfHistory, liveSnapshots, moveEvents, activeScannerData, selectedHorizon]);

  const { summary, categories, signals } = scoreboard;

  // Lọc tín hiệu theo category tab
  const filteredSignals = useMemo(() => {
    if (activeCategory === 'ALL') return signals;
    return signals.filter((s) => s.category === activeCategory);
  }, [signals, activeCategory]);

  const categoryTabs = [
    { id: 'ALL', label: 'TẤT CẢ (ALL)' },
    { id: 'biasRegime', label: 'BIAS REGIME' },
    { id: 'capitalFlow', label: 'CAPITAL FLOW' },
    { id: 'scannerRank', label: 'SCANNER RANK' },
    { id: 'moveTracker', label: 'MOVE TRACKER' },
  ];

  return (
    <div className="signal-scoreboard-panel font-mono">
      {/* ── Header Toolbar ────────────────────────────────────────────── */}
      <div className="scoreboard-header">
        <div className="scoreboard-header-left">
          <div className="scoreboard-title-group">
            <Award size={16} className="text-amber-400" />
            <h3 className="scoreboard-title">
              SIGNAL SCOREBOARD — KIỂM CHỨNG "EDGE" &amp; BACKTEST TỰ ĐỘNG ⭐
            </h3>
          </div>
          <span className="scoreboard-subtitle text-slate-400">
            Thống kê Hit-Rate, Median Forward Return &amp; IQR thực tế (No-Look-Ahead) trên lịch sử klines &amp; live snapshots
          </span>
        </div>

        <div className="scoreboard-header-right">
          {/* Horizon Selection Buttons */}
          <div className="scoreboard-horizon-switcher">
            <span className="horizon-label text-slate-400">KỲ HẠN:</span>
            {SCOREBOARD_HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                className={`horizon-btn ${selectedHorizon === h ? 'is-active' : ''}`}
                onClick={() => setSelectedHorizon(h)}
              >
                +{h}
              </button>
            ))}
          </div>

          <ModuleMenu moduleId={moduleId} />
        </div>
      </div>

      {/* ── Top Summary KPI Cards (Bento Grid) ─────────────────────────── */}
      <div className="scoreboard-kpi-grid">
        {/* KPI 1: Overall Hit-Rate */}
        <div className="scoreboard-kpi-card">
          <div className="kpi-tag-row">
            <span className="kpi-label">HIT-RATE TRUNG BÌNH</span>
            <Activity size={12} className="text-emerald" />
          </div>
          <div className="kpi-value text-emerald">
            {summary.overallHitRate != null ? `${summary.overallHitRate}%` : '---'}
          </div>
          <span className="kpi-footnote text-slate-400">
            Đo trên {summary.totalResolvedSamples} setup đã kết thúc kỳ hạn (+{selectedHorizon})
          </span>
        </div>

        {/* KPI 2: Top Edge Signal */}
        <div className="scoreboard-kpi-card top-edge-card">
          <div className="kpi-tag-row">
            <span className="kpi-label text-amber-400">EDGE MẠNH NHẤT (+{selectedHorizon})</span>
            <Sparkles size={12} className="text-amber-400" />
          </div>
          <div className="kpi-value text-contrast" style={{ fontSize: '0.95rem', fontWeight: 700 }}>
            {summary.topEdgeSignal?.name || 'Đang cập nhật'}
          </div>
          <div className="kpi-sub-row">
            <span className="text-emerald">Hit {summary.topEdgeSignal?.hitRate ?? '---'}%</span>
            <span className="text-slate-400">·</span>
            <span className={Number(summary.topEdgeSignal?.medianReturn) >= 0 ? 'text-emerald' : 'text-rose'}>
              Med {Number(summary.topEdgeSignal?.medianReturn) >= 0 ? '+' : ''}{summary.topEdgeSignal?.medianReturn ?? '0'}%
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">N={summary.topEdgeSignal?.sampleSize ?? 0}</span>
          </div>
        </div>

        {/* KPI 3: Sample Size & Engine Provenance */}
        <div className="scoreboard-kpi-card">
          <div className="kpi-tag-row">
            <span className="kpi-label">MẪU ĐỊNH LƯỢNG (N)</span>
            <ShieldCheck size={12} className="text-sky-400" />
          </div>
          <div className="kpi-value text-contrast">
            {summary.totalResolvedSamples} <span style={{ fontSize: '0.75rem', color: 'var(--text-slate-400)' }}>mẫu</span>
          </div>
          <span className="kpi-footnote text-slate-400">
            {summary.totalSignalsCount} chiến lược · {summary.provenance.historicalKlinesCount} nến ngày walk-forward
          </span>
        </div>

        {/* KPI 4: Governance Guarantee */}
        <div className="scoreboard-kpi-card">
          <div className="kpi-tag-row">
            <span className="kpi-label">BẢO CHỨNG ZERO-LEAKAGE</span>
            <Database size={12} className="text-indigo-400" />
          </div>
          <div className="kpi-value text-emerald" style={{ fontSize: '0.95rem' }}>
            NO-LOOK-AHEAD
          </div>
          <span className="kpi-footnote text-slate-400">
            Snapshot ngày $t$ chỉ dùng dữ liệu $\le t$, kiểm tra forward sau khi bar hoàn thành
          </span>
        </div>
      </div>

      {/* ── Category Filter Tabs ───────────────────────────────────────── */}
      <div className="scoreboard-filter-bar">
        <div className="filter-tab-group">
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`scoreboard-tab-btn ${activeCategory === tab.id ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="scoreboard-stats-meta text-slate-500">
          Hiển thị <strong>{filteredSignals.length}</strong> nhóm tín hiệu · Kỳ hạn <strong>+{selectedHorizon}</strong>
        </div>
      </div>

      {/* ── Main Scoreboard Table / Cards Grid ─────────────────────────── */}
      <div className="scoreboard-signals-table-wrap">
        <div className="scoreboard-table-header">
          <span className="col-code">MÃ</span>
          <span className="col-name">TÊN TÍN HIỆU / PHÂN HỆ</span>
          <span className="col-dir">HƯỚNG KỲ VỌNG</span>
          <span className="col-n">MẪU (N)</span>
          <span className="col-hit">HIT-RATE (+{selectedHorizon})</span>
          <span className="col-med">MEDIAN RETURN</span>
          <span className="col-iqr">IQR [P25 .. P75]</span>
          <span className="col-pf">PROFIT FACTOR</span>
          <span className="col-verdict">ĐỊNH LƯỢNG EDGE</span>
          <span className="col-expand">CHI TIẾT</span>
        </div>

        <div className="scoreboard-table-body">
          {filteredSignals.map((sig) => {
            const stats = sig.horizons?.[selectedHorizon];
            const isExpanded = expandedSignalId === sig.id;
            const hitRate = stats?.hitRate;
            const hitColor = hitRate == null ? '#94a3b8' : hitRate >= 60 ? '#10b981' : hitRate >= 50 ? '#34d399' : '#f43f5e';
            const medRet = stats?.medianReturn;
            const verdict = stats?.verdict;

            return (
              <Fragment key={sig.id}>
                <div
                  className={`scoreboard-row ${isExpanded ? 'is-expanded' : ''}`}
                  onClick={() => setExpandedSignalId(isExpanded ? null : sig.id)}
                >
                  <span className="col-code font-bold text-slate-400">{sig.code}</span>
                  
                  <div className="col-name">
                    <span className="sig-name-text text-contrast">{sig.name}</span>
                    <span className="sig-cat-badge">{categories[sig.category]?.title || sig.category}</span>
                  </div>

                  <span className={`col-dir font-bold ${sig.expectedDirection === 'LONG' ? 'text-emerald' : sig.expectedDirection === 'SHORT' ? 'text-rose' : 'text-slate-400'}`}>
                    {sig.directionLabel}
                  </span>

                  <span className="col-n text-contrast font-semibold">
                    {stats?.sampleSize ?? 0}
                  </span>

                  <div className="col-hit">
                    <strong style={{ color: hitColor }}>
                      {hitRate != null ? `${hitRate}%` : '---'}
                    </strong>
                    {hitRate != null && (
                      <div className="hit-progress-track">
                        <div
                          className="hit-progress-bar"
                          style={{ width: `${Math.min(100, Math.max(0, hitRate))}%`, backgroundColor: hitColor }}
                        />
                      </div>
                    )}
                  </div>

                  <span className={`col-med font-bold ${medRet != null && medRet > 0 ? 'text-emerald' : medRet != null && medRet < 0 ? 'text-rose' : 'text-slate-400'}`}>
                    {medRet != null ? `${medRet >= 0 ? '+' : ''}${medRet}%` : '---'}
                  </span>

                  <span className="col-iqr text-slate-400" style={{ fontSize: '0.75rem' }}>
                    {stats?.p25 != null ? `[${stats.p25 >= 0 ? '+' : ''}${stats.p25}%, ${stats.p75 >= 0 ? '+' : ''}${stats.p75}%]` : '---'}
                  </span>

                  <span className="col-pf font-semibold text-contrast">
                    {stats?.profitFactor != null ? `${stats.profitFactor}x` : '---'}
                  </span>

                  <div className="col-verdict">
                    <span
                      className="verdict-pill"
                      style={{
                        backgroundColor: verdict?.bg || 'rgba(148,163,184,0.1)',
                        color: verdict?.badgeColor || '#94a3b8',
                        borderColor: verdict?.border || 'rgba(148,163,184,0.3)',
                      }}
                      title={verdict?.desc}
                    >
                      {verdict?.shortLabel || 'CHỜ MẪU'}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="col-expand-btn text-slate-400 hover:text-contrast"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedSignalId(isExpanded ? null : sig.id);
                    }}
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {/* ── Expanded Multi-Horizon Breakdown ───────────────────── */}
                {isExpanded && (
                  <div className="scoreboard-expanded-pane">
                    <div className="expanded-title-bar">
                      <Compass size={12} className="text-emerald" />
                      <span>ĐỐI SOÁT ĐA KỲ HẠN: +1D (24H), +3D (72H) &amp; +7D CHO <strong>{sig.name}</strong></span>
                    </div>

                    <div className="expanded-horizons-grid">
                      {SCOREBOARD_HORIZONS.map((h) => {
                        const hStats = sig.horizons?.[h];
                        const hHitColor = hStats?.hitRate == null ? '#94a3b8' : hStats.hitRate >= 60 ? '#10b981' : hStats.hitRate >= 50 ? '#34d399' : '#f43f5e';

                        return (
                          <div key={h} className="expanded-horizon-card">
                            <div className="eh-header">
                              <span className="eh-tag">KỲ HẠN +{h}</span>
                              <span className="eh-n text-slate-500">Mẫu: {hStats?.sampleSize ?? 0}</span>
                            </div>

                            <div className="eh-metrics">
                              <div className="eh-item">
                                <span className="eh-label text-slate-400">HIT-RATE:</span>
                                <strong style={{ color: hHitColor }}>{hStats?.hitRate != null ? `${hStats.hitRate}%` : '---'}</strong>
                              </div>
                              <div className="eh-item">
                                <span className="eh-label text-slate-400">MEDIAN:</span>
                                <strong className={hStats?.medianReturn >= 0 ? 'text-emerald' : 'text-rose'}>
                                  {hStats?.medianReturn != null ? `${hStats.medianReturn >= 0 ? '+' : ''}${hStats.medianReturn}%` : '---'}
                                </strong>
                              </div>
                              <div className="eh-item">
                                <span className="eh-label text-slate-400">IQR (P25–P75):</span>
                                <span className="text-slate-300">
                                  {hStats?.p25 != null ? `[${hStats.p25}%, ${hStats.p75}%]` : '---'}
                                </span>
                              </div>
                              <div className="eh-item">
                                <span className="eh-label text-slate-400">MIN / MAX:</span>
                                <span className="text-slate-300">
                                  {hStats?.min != null ? `[${hStats.min}%, ${hStats.max}%]` : '---'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Footer Methodology Note ─────────────────────────────────────── */}
      <div className="scoreboard-footer">
        <HelpCircle size={13} className="text-slate-400" />
        <span className="text-slate-400">
          <strong>Nguyên tắc No-Look-Ahead:</strong> Thống kê phản ánh kết quả thực nghiệm thuần túy từ chuỗi nến lịch sử và provenance snapshot. Tín hiệu tại ngày $t$ không được phép tiếp cận giá hay dữ liệu sau ngày $t$. Kết quả backtest là cơ sở xác thực thống kê, không cấu thành lời khuyên đầu tư tài chính.
        </span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { getBTCMacroKlines } from '../services/api';
import { readCacheValue } from '../utils/cache';
import {
  applyLivePriceToMacroCandles,
  calculateMacroDashboard,
  CHART_RANGES,
  chartBarsForRange,
  ENGINE_MODES,
  evaluateSopAction,
  MACRO_DASHBOARD_DEFAULTS,
  MACRO_SOP_PRESET,
  normalizeMacroCandles,
} from '../services/macroDashboardEngine';
import ModuleMenu from './ModuleMenu';
import DataOriginBadge from './DataOriginBadge';

const SETTINGS_KEY = 'macro-dashboard-v3-settings';
const SOP_CALC_KEY = 'macro-dashboard-sop-calc-v1';
const HISTORY_LIMIT = 10000;

const zoneColors = {
  GIFT: '#00e676',
  CHEAP: '#81c784',
  FAIR: '#90a4ae',
  EXP: '#ff9800',
  BUBBLE: '#f44336',
};

const decisionColor = (result) => {
  if (!result) return zoneColors.FAIR;
  if (result.divergence) return '#ffee58';
  if (result.composite >= 3) return zoneColors.GIFT;
  if (result.composite >= 1) return zoneColors.CHEAP;
  if (result.composite <= -3) return zoneColors.BUBBLE;
  if (result.composite <= -1) return zoneColors.EXP;
  return zoneColors.FAIR;
};

const loadSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return saved && typeof saved === 'object'
      ? { ...MACRO_SOP_PRESET, ...saved }
      : { ...MACRO_SOP_PRESET };
  } catch {
    return { ...MACRO_SOP_PRESET };
  }
};

const loadSopCalc = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SOP_CALC_KEY));
    if (saved && typeof saved === 'object') {
      return {
        weeklyBudget: Number.isFinite(Number(saved.weeklyBudget)) ? Number(saved.weeklyBudget) : 1000,
        cashReserve: Number.isFinite(Number(saved.cashReserve)) ? Number(saved.cashReserve) : 10000,
        selectedRule: saved.selectedRule === 'rule1' ? 'rule1' : 'rule2',
      };
    }
  } catch {
    // ignore storage errors
  }
  return { weeklyBudget: 1000, cashReserve: 10000, selectedRule: 'rule2' };
};

const fmtSigned = (value, digits = 1) => {
  if (!Number.isFinite(value)) return '---';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
};

const fmtNumber = (value, digits = 2) => (Number.isFinite(value)
  ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '---');

const fmtUsd = (value) => (Number.isFinite(value)
  ? `$${Math.round(value).toLocaleString('en-US')}`
  : '---');

const fmtDate = (date) => (date instanceof Date && !Number.isNaN(date.getTime())
  ? date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '---');

const getNextMondayCheckLabel = () => {
  const now = new Date();
  const dayUtc = now.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMon = ((8 - dayUtc) % 7) || 7;
  const nextMonUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMon,
    0,
    0,
    0,
  ));
  return `${nextMonUtc.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })} · 07:00 VN (00:00 UTC)`;
};

const readCachedCandlesForTf = (timeframe) => {
  const intervalMap = { D: '1d', W: '1w', M: '1M' };
  const interval = intervalMap[timeframe] || '1w';
  const targetLimit = Math.max(2, Math.min(Math.trunc(HISTORY_LIMIT), 10000));
  const cached = readCacheValue(`btcMacroKlines_BTCUSDT_${interval}_${targetLimit}`);
  return normalizeMacroCandles(cached);
};

function ZoneText({ zone, suffix = '' }) {
  return <span style={{ color: zoneColors[zone] || zoneColors.FAIR }}>{zone || '---'}{suffix}</span>;
}

function SettingSelect({ label, value, options, onChange, disabled = false }) {
  return (
    <label className={`macro-setting-field${disabled ? ' is-disabled' : ''}`}>
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const optValue = typeof option === 'string' ? option : option.value;
          const optLabel = typeof option === 'string' ? option : option.label;
          return <option key={optValue} value={optValue}>{optLabel}</option>;
        })}
      </select>
    </label>
  );
}

export default function MacroDashboardCard({ livePrice, theme, moduleId = 'dash_macro_valuator' }) {
  const [settings, setSettings] = useState(loadSettings);
  const [sopCalc, setSopCalc] = useState(loadSopCalc);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'sop'
  const [candlesState, setCandlesState] = useState(() => ({
    timeframe: settings.timeframe,
    rows: readCachedCandlesForTf(settings.timeframe),
  }));
  const [status, setStatus] = useState(() => (
    candlesState.rows.length > 0 ? 'ready' : 'loading'
  ));
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [chartRange, setChartRange] = useState('ALL');
  const [reloadKey, setReloadKey] = useState(0);
  const [throttledLivePrice, setThrottledLivePrice] = useState(() => (
    Number.isFinite(Number(livePrice)) ? Number(livePrice) : null
  ));
  const lastLiveUpdateRef = useRef({ time: 0, price: null });

  useEffect(() => {
    const nextPrice = Number(livePrice);
    if (!Number.isFinite(nextPrice) || nextPrice <= 0) return undefined;
    const now = Date.now();
    const { time: lastTime, price: lastPrice } = lastLiveUpdateRef.current;
    const relMove = lastPrice && lastPrice > 0 ? Math.abs(nextPrice - lastPrice) / lastPrice : Infinity;
    const elapsed = now - lastTime;

    if (lastPrice === null || elapsed >= 5000 || relMove >= 0.0015) {
      lastLiveUpdateRef.current = { time: now, price: nextPrice };
      setThrottledLivePrice(nextPrice);
      return undefined;
    }

    const timer = setTimeout(() => {
      lastLiveUpdateRef.current = { time: Date.now(), price: nextPrice };
      setThrottledLivePrice(nextPrice);
    }, Math.max(250, 5000 - elapsed));

    return () => clearTimeout(timer);
  }, [livePrice]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings persistence is optional.
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(SOP_CALC_KEY, JSON.stringify(sopCalc));
    } catch {
      // Calculator persistence is optional.
    }
  }, [sopCalc]);

  useEffect(() => {
    let cancelled = false;
    const tf = settings.timeframe;
    const cached = readCachedCandlesForTf(tf);
    const lastCached = cached.at(-1);
    const cacheHasExpiredClose = Boolean(
      lastCached
      && Number.isFinite(lastCached.closeTime)
      && lastCached.closeTime < Date.now()
      && reloadKey === 0,
    );
    const forceFetch = reloadKey > 0 || cacheHasExpiredClose;

    getBTCMacroKlines('BTCUSDT', tf, HISTORY_LIMIT, forceFetch).then((rows) => {
      if (cancelled) return;
      const normalized = normalizeMacroCandles(rows);
      if (normalized.length > 0) {
        setCandlesState({ timeframe: tf, rows: normalized });
        setStatus('ready');
        setError('');
      } else {
        setCandlesState((prev) => {
          const hasRowsForTf = prev.timeframe === tf && prev.rows.length > 0;
          setStatus(hasRowsForTf ? 'ready' : 'error');
          setError('Không tải được lịch sử Binance Spot.');
          return prev;
        });
      }
    });
    return () => { cancelled = true; };
  }, [settings.timeframe, reloadKey]);

  const activeCandles = candlesState.timeframe === settings.timeframe ? candlesState.rows : [];

  const effectiveCandles = useMemo(
    () => applyLivePriceToMacroCandles(activeCandles, throttledLivePrice),
    [activeCandles, throttledLivePrice],
  );

  const dashboard = useMemo(
    () => calculateMacroDashboard(effectiveCandles, settings),
    [effectiveCandles, settings],
  );

  const sopAction = useMemo(
    () => evaluateSopAction(dashboard, sopCalc),
    [dashboard, sopCalc],
  );

  const updateSetting = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  const changeTimeframe = (value) => {
    const cached = readCachedCandlesForTf(value);
    setCandlesState({ timeframe: value, rows: cached });
    setStatus(cached.length > 0 ? 'ready' : 'loading');
    setError('');
    updateSetting('timeframe', value);
  };
  const applySopPreset = () => {
    if (settings.timeframe !== MACRO_SOP_PRESET.timeframe) {
      const cached = readCachedCandlesForTf(MACRO_SOP_PRESET.timeframe);
      setCandlesState({ timeframe: MACRO_SOP_PRESET.timeframe, rows: cached });
      setStatus(cached.length > 0 ? 'ready' : 'loading');
      setError('');
    }
    setSettings({ ...MACRO_SOP_PRESET });
  };
  const applyPineV2Preset = () => {
    if (settings.timeframe !== MACRO_DASHBOARD_DEFAULTS.timeframe) {
      const cached = readCachedCandlesForTf(MACRO_DASHBOARD_DEFAULTS.timeframe);
      setCandlesState({ timeframe: MACRO_DASHBOARD_DEFAULTS.timeframe, rows: cached });
      setStatus(cached.length > 0 ? 'ready' : 'loading');
      setError('');
    }
    setSettings({ ...MACRO_DASHBOARD_DEFAULTS });
  };
  const reloadHistory = () => {
    setStatus('loading');
    setError('');
    setReloadKey((value) => value + 1);
  };

  const isMathV3 = (settings.engineMode || ENGINE_MODES.PINE_V2) === ENGINE_MODES.MATH_V3;
  const current = dashboard.current;
  const previous = dashboard.previous;
  const currentColor = decisionColor(current);
  const visibleBars = chartBarsForRange(chartRange, settings.timeframe);
  const visibleSeries = Number.isFinite(visibleBars)
    ? dashboard.series.slice(-visibleBars)
    : dashboard.series;
  const isLight = theme === 'light';

  const sopToneColor = sopAction.tone === 'buy'
    ? '#22c55e'
    : sopAction.tone === 'sell'
      ? '#ef4444'
      : '#38bdf8';

  const sopPillLabel = sopAction.status === 'GREEN_BUBBLE_BUY'
    ? `SOP: MUA · GB #${sopAction.gbStreak}`
    : sopAction.status === 'RED_BUBBLE_TAKE_PROFIT'
      ? `SOP: RED BUBBLE · CY-4`
      : 'SOP: CHỜ · TÍCH QUỸ R';

  const chartData = useMemo(() => ({
    labels: visibleSeries.map((row) => row.time.toLocaleDateString('vi-VN', { month: '2-digit', year: '2-digit' })),
    datasets: [
      {
        label: 'BTC',
        data: visibleSeries.map((row) => row.price),
        borderColor: isLight ? '#0f172a' : '#e2e8f0',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.12,
      },
      {
        label: 'Fair Value',
        data: visibleSeries.map((row) => row.fairValue),
        borderColor: '#42a5f5',
        borderWidth: 1.6,
        pointRadius: 0,
        tension: 0.12,
      },
      {
        label: '+1σ',
        data: visibleSeries.map((row) => row.bandUpper),
        borderColor: 'rgba(66,165,245,.35)',
        backgroundColor: 'rgba(66,165,245,.08)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1',
        tension: 0.12,
      },
      {
        label: '-1σ',
        data: visibleSeries.map((row) => row.bandLower),
        borderColor: 'rgba(66,165,245,.35)',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.12,
      },
      {
        label: 'Green Bubble (Strong Accum)',
        data: visibleSeries.map((row) => (
          row.composite >= 3 && !row.divergence ? row.price : null
        )),
        showLine: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: isLight ? '#14532d' : '#bbf7d0',
        pointBorderWidth: 1.25,
      },
      {
        label: 'Red Bubble (Overbought)',
        data: visibleSeries.map((row) => (
          row.composite <= -3 && !row.divergence ? row.price : null
        )),
        showLine: false,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#ef4444',
        pointBorderColor: isLight ? '#7f1d1d' : '#fecaca',
        pointBorderWidth: 1.25,
      },
    ],
  }), [visibleSeries, isLight]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: isLight ? '#475569' : '#94a3b8', boxWidth: 10, boxHeight: 2, font: { size: 9 } },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            if (context.dataset.label.startsWith('Green Bubble') || context.dataset.label.startsWith('Red Bubble')) {
              const score = visibleSeries[context.dataIndex]?.composite;
              const signedScore = score > 0 ? `+${score}` : score;
              return `${context.dataset.label} · BTC $${fmtNumber(context.raw, 0)} · score ${signedScore}`;
            }
            return `${context.dataset.label}: $${fmtNumber(context.raw, 0)}`;
          },
        },
      },
    },
    scales: {
      x: { display: false, grid: { display: false } },
      y: {
        position: 'right',
        grid: { color: isLight ? 'rgba(15,23,42,.07)' : 'rgba(148,163,184,.07)' },
        ticks: {
          color: '#64748b',
          font: { size: 9 },
          callback: (value) => `$${Number(value).toLocaleString('en-US', { notation: 'compact' })}`,
        },
      },
    },
  }), [isLight, visibleSeries]);

  const selectedRuleObj = sopCalc.selectedRule === 'rule1' ? sopAction.rule1 : sopAction.rule2;

  return (
    <section className="glass-panel macro-dashboard-card">
      <header className="macro-dashboard-header">
        <div>
          <div className="macro-dashboard-title-row">
            <Activity size={15} style={{ color: currentColor }} />
            <h3 className="font-mono">MACRO DASHBOARD {isMathV3 ? 'v3' : 'v2'}</h3>
            <span className={`macro-engine-badge font-mono ${isMathV3 ? 'is-v3' : 'is-v2'}`}>
              {isMathV3 ? 'MathClean v3' : 'Pine v2'}
            </span>
            <span className="macro-source-badge font-mono">BINANCE:BTCUSDT · {settings.timeframe}</span>
            <DataOriginBadge origin="history" label="LỊCH SỬ KLINES" compact />
          </div>
          <p>
            Valuator + PnL Matrix ·{' '}
            {isMathV3
              ? 'MathClean v3 (MAD 4Y · Disjoint Cohorts 1-4Y · RVWAP Anti-Wash)'
              : 'Pine v2 parity mode'}
          </p>
        </div>
        <div className="macro-dashboard-actions">
          <button
            type="button"
            className="macro-sop-pill"
            style={{ '--sop-tone': sopToneColor }}
            onClick={() => setActiveTab('sop')}
            title="Mở tab SOP & Hành động gợi ý"
          >
            <span className="macro-sop-dot" />
            {sopPillLabel}
          </button>
          <button type="button" onClick={reloadHistory} title="Tải lại dữ liệu">
            <RefreshCw size={13} className={status === 'loading' ? 'macro-spin' : ''} />
          </button>
          <button type="button" onClick={() => setShowSettings((value) => !value)} className={showSettings ? 'active' : ''}>
            <Settings2 size={13} /> CẤU HÌNH
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </header>

      <nav className="macro-card-tabs font-mono" role="tablist" aria-label="Macro Dashboard Views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          <Activity size={12} />
          VALUATOR &amp; PNL MATRIX
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sop'}
          className={activeTab === 'sop' ? 'active' : ''}
          onClick={() => setActiveTab('sop')}
        >
          <ClipboardList size={12} />
          SOP &amp; HÀNH ĐỘNG GỢI Ý
          {!sopAction.compliance.isCompliant && (
            <span className="macro-tab-warn" title="Cấu hình hiện tại khác chuẩn SOP">!</span>
          )}
        </button>
      </nav>

      {showSettings && (
        <div className="macro-settings font-mono">
          <SettingSelect
            label="Engine"
            value={settings.engineMode || ENGINE_MODES.PINE_V2}
            options={[
              { value: ENGINE_MODES.MATH_V3, label: 'math_v3 (MathClean v3)' },
              { value: ENGINE_MODES.PINE_V2, label: 'pine_v2 (Pine parity)' },
            ]}
            onChange={(value) => updateSetting('engineMode', value)}
          />
          <SettingSelect label="Locked TF" value={settings.timeframe} options={['D', 'W', 'M']} onChange={changeTimeframe} />
          <SettingSelect
            label="Cost Basis"
            value={settings.costMethod}
            options={[
              { value: 'VWAP', label: isMathV3 ? 'VWAP (RVWAP)' : 'VWAP' },
              { value: 'SMA', label: 'SMA' },
              { value: 'Median HL', label: 'Median HL' },
              { value: 'EMA', label: 'EMA' },
            ]}
            onChange={(value) => updateSetting('costMethod', value)}
          />
          <SettingSelect label="Cohort Weight" value={settings.weightScheme} options={['Equal', 'Short-heavy', 'Long-heavy']} onChange={(value) => updateSetting('weightScheme', value)} />
          <SettingSelect label="PnL Zone" value={settings.zoneMethod} options={['Percentile', 'Convergence']} onChange={(value) => updateSetting('zoneMethod', value)} />
          <SettingSelect
            label={isMathV3 ? 'Z Mode (v3)' : 'Z Mode'}
            value={isMathV3 ? 'Structural' : settings.zMode}
            options={isMathV3 ? [{ value: 'Structural', label: 'Structural (MAD 4Y)' }] : ['Structural', 'Adaptive']}
            disabled={isMathV3}
            onChange={(value) => updateSetting('zMode', value)}
          />
          <SettingSelect
            label={isMathV3 ? 'Scale (v3)' : 'Sigma'}
            value={isMathV3 ? 'MAD 4Y' : settings.sigmaMethod}
            options={isMathV3 ? ['MAD 4Y'] : ['EWMA D²', 'Rolling Std']}
            disabled={isMathV3}
            onChange={(value) => updateSetting('sigmaMethod', value)}
          />
          <label className="macro-setting-check">
            <input type="checkbox" checked={settings.useDualWindow} onChange={(event) => updateSetting('useDualWindow', event.target.checked)} /> Dual confirm
          </label>
          <label className="macro-setting-check">
            <input type="checkbox" checked={settings.useHysteresis} onChange={(event) => updateSetting('useHysteresis', event.target.checked)} /> Hysteresis
          </label>
          <div className="macro-preset-btns">
            <button type="button" className="macro-reset-btn is-primary" onClick={applySopPreset}>CHUẨN SOP (v3)</button>
            <button type="button" className="macro-reset-btn" onClick={applyPineV2Preset}>PINE v2</button>
          </div>
        </div>
      )}

      {status === 'error' && <div className="macro-dashboard-state font-mono">{error}</div>}
      {status === 'loading' && !current && <div className="macro-dashboard-state font-mono">ĐANG TẢI LỊCH SỬ D/W/M…</div>}

      {current && activeTab === 'overview' && (
        <>
          <div className="macro-decision-strip" style={{ '--macro-action': currentColor }}>
            <div className="macro-decision-primary">
              <span className="font-mono">CURRENT DECISION</span>
              <strong>{current.decision}</strong>
              <em className="font-mono">SCORE {current.composite > 0 ? '+' : ''}{current.composite}</em>
            </div>
            <div className="macro-decision-metrics">
              <div><span>BTC NOW</span><strong>${fmtNumber(current.price, 0)}</strong></div>
              <div><span>FAIR VALUE</span><strong>${fmtNumber(current.fairValue, 0)}</strong></div>
              <div><span>VS FAIR VALUE</span><strong>{fmtSigned(current.versusFairValue)}</strong></div>
              {isMathV3 && Number.isFinite(current.convictionScore) && (
                <div>
                  <span>CONVICTION</span>
                  <strong>{current.convictionScore > 0 ? '+' : ''}{current.convictionScore.toFixed(2)}</strong>
                </div>
              )}
              <div><span>DIVERGENCE</span><strong className={current.divergence ? 'warning' : ''}>{current.divergence ? 'YES ⚠' : 'NO'}</strong></div>
            </div>
          </div>

          <div className="macro-zone-grid">
            <article style={{ '--zone-color': zoneColors[current.pnlZone] }}>
              <span className="macro-zone-index font-mono">
                01 / PNL MATRIX {isMathV3 ? '· DISJOINT 1-4Y' : ''}
              </span>
              <div className="macro-zone-name"><ZoneText zone={current.pnlZone} /></div>
              <p>Weighted ROI <strong>{fmtSigned(current.weightedAverage)}</strong> · percentile <strong>{current.percentile.toFixed(1)}%</strong></p>
              <div className="macro-zone-sub font-mono">
                UNDERWATER {current.underwater.toFixed(0)}% · MIN ROI {fmtSigned(current.roiMin)}
                {isMathV3 && settings.costMethod === 'VWAP' ? ' · RVWAP' : ''}
              </div>
            </article>
            <article style={{ '--zone-color': zoneColors[current.valZone] }}>
              <span className="macro-zone-index font-mono">
                02 / VALUATOR {isMathV3 ? '· MAD 4Y' : ''}
              </span>
              <div className="macro-zone-name"><ZoneText zone={current.valZone} /></div>
              <p>Z long <strong>{current.valZLong > 0 ? '+' : ''}{current.valZLong.toFixed(2)}</strong> · Z short <strong>{current.valZShort > 0 ? '+' : ''}{current.valZShort.toFixed(2)}</strong></p>
              <div className="macro-zone-sub font-mono">
                IMPLIED CAGR {fmtSigned(current.impliedCagr)} · σ {current.sigma.toFixed(3)}
              </div>
            </article>
            <div className="macro-fv-chart">
              <div className="macro-chart-ranges font-mono" aria-label="Phạm vi biểu đồ">
                {CHART_RANGES.map((range) => (
                  <button
                    type="button"
                    key={range}
                    className={chartRange === range ? 'active' : ''}
                    onClick={() => setChartRange(range)}
                  >
                    {range}
                  </button>
                ))}
              </div>
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>

          <button type="button" className="macro-details-toggle font-mono" onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showDetails ? 'ẨN MA TRẬN CHI TIẾT' : 'XEM MA TRẬN CURRENT / PREVIOUS'}
          </button>

          {showDetails && (
            <div className="macro-table-wrap">
              <table className="macro-dashboard-table font-mono">
                <thead><tr><th>METRIC</th><th>CURRENT</th><th>PREVIOUS</th></tr></thead>
                <tbody>
                  <tr><td>Decision</td><td style={{ color: currentColor }}>{current.decision} ({current.composite})</td><td style={{ color: decisionColor(previous) }}>{previous?.decision || '---'} ({previous?.composite ?? '—'})</td></tr>
                  <tr><td>Divergence</td><td>{current.divergence ? 'YES ⚠' : 'No'}</td><td>{previous?.divergence ? 'YES ⚠' : 'No'}</td></tr>
                  {isMathV3 && Number.isFinite(current.convictionScore) && (
                    <tr>
                      <td>Conviction Score</td>
                      <td>{current.convictionScore > 0 ? '+' : ''}{current.convictionScore.toFixed(2)}</td>
                      <td>{Number.isFinite(previous?.convictionScore) ? `${previous.convictionScore > 0 ? '+' : ''}${previous.convictionScore.toFixed(2)}` : '---'}</td>
                    </tr>
                  )}
                  <tr><td>PnL Zone</td><td><ZoneText zone={current.pnlZone} suffix={` (${current.percentile.toFixed(1)}%ile)`} /></td><td><ZoneText zone={previous?.pnlZone} suffix={previous ? ` (${previous.percentile.toFixed(1)}%ile)` : ''} /></td></tr>
                  <tr><td>PnL wAvg ROI</td><td>{fmtSigned(current.weightedAverage)}</td><td>{fmtSigned(previous?.weightedAverage)}</td></tr>
                  <tr><td>% Underwater</td><td>{current.underwater.toFixed(1)}% · min {fmtSigned(current.roiMin)}</td><td>{previous ? `${previous.underwater.toFixed(1)}% · min ${fmtSigned(previous.roiMin)}` : '---'}</td></tr>
                  <tr><td>Rel Spread</td><td>{current.relativeSpread.toFixed(2)} [{fmtSigned(current.roiMin)}…{fmtSigned(current.roiMax)}]</td><td>{previous?.relativeSpread.toFixed(2) ?? '---'}</td></tr>
                  <tr><td>ROI 1/2/3/4Y</td><td>{current.rois.map((value) => value.toFixed(0)).join('/')}%</td><td>{settings.weightScheme}{isMathV3 ? ' (Disjoint)' : ''}</td></tr>
                  <tr><td>Val Zone</td><td><ZoneText zone={current.valZone} suffix={` (Z ${current.valZLong > 0 ? '+' : ''}${current.valZLong.toFixed(2)})`} /></td><td><ZoneText zone={previous?.valZone} suffix={previous ? ` (Z ${previous.valZLong > 0 ? '+' : ''}${previous.valZLong.toFixed(2)})` : ''} /></td></tr>
                  <tr><td>Z Short / Long</td><td>{current.valZShort.toFixed(2)} / {current.valZLong.toFixed(2)}</td><td>{previous ? `${previous.valZShort.toFixed(2)} / ${previous.valZLong.toFixed(2)}` : '---'}</td></tr>
                  <tr><td>vs Fair Value</td><td>{fmtSigned(current.versusFairValue)} · FV ${fmtNumber(current.fairValue, 0)}</td><td>{fmtSigned(previous?.versusFairValue)}</td></tr>
                  <tr><td>Impl. CAGR</td><td>{fmtSigned(current.impliedCagr)} [{isMathV3 ? 'MAD 4Y' : settings.zMode}]</td><td>{settings.costMethod} · {settings.zoneMethod}</td></tr>
                  <tr><td>Bars in Zone</td><td>PnL {current.pnlBarsInZone} · Val {current.valBarsInZone}</td><td>minAlert {settings.minBarsAlert}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <footer className="macro-dashboard-footer font-mono">
            <span>
              {effectiveCandles.length} BARS · {effectiveCandles[0]?.time.toLocaleDateString('vi-VN')} → {current.time.toLocaleDateString('vi-VN')} · {current.isClosed ? 'CLOSED CANDLE' : 'LIVE CANDLE W0'}
            </span>
            <span>{isMathV3 ? 'MATHCLEAN v3 · STRICTLY CAUSAL · ANTI-OVERFIT' : 'PRICE-PATH PROXY · NOT ON-CHAIN REALIZED PRICE'}</span>
          </footer>
        </>
      )}

      {current && activeTab === 'sop' && (
        <div className="macro-sop-panel">
          {/* 1. Config Compliance Banner */}
          {sopAction.compliance.isCompliant ? (
            <div className="macro-sop-compliance is-ok font-mono">
              <CheckCircle2 size={14} />
              <span>
                ĐANG CHẠY ĐÚNG CẤU HÌNH CHUẨN SOP: <strong>MathClean v3 · W · VWAP (RVWAP) · Equal · Percentile · Structural · Dual ON · Hysteresis ON</strong>
              </span>
            </div>
          ) : (
            <div className="macro-sop-compliance is-warn font-mono">
              <div className="macro-sop-compliance-text">
                <AlertTriangle size={14} />
                <span>
                  Cấu hình hiện tại lệch chuẩn SOP ({sopAction.compliance.mismatches.map((m) => `${m.label}: ${m.displayActual} → ${m.displayExpected}`).join(' · ')}).
                </span>
              </div>
              <button type="button" className="macro-sop-apply-btn" onClick={applySopPreset}>
                ÁP DỤNG CẤU HÌNH CHUẨN SOP
              </button>
            </div>
          )}

          {/* 2. Dynamic Action Recommendation Hero */}
          <div className="macro-sop-hero" style={{ '--sop-tone': sopToneColor }}>
            <div className="macro-sop-hero-top">
              <span className="macro-sop-kicker font-mono">
                <ShieldCheck size={13} />
                HÀNH ĐỘNG GỢI Ý THEO SOP · NẾN ĐÓNG ({settings.timeframe === 'W' ? 'W-1' : settings.timeframe}) NGÀY {fmtDate(sopAction.signalBar?.time)}
              </span>
              <span className="macro-sop-clock font-mono">
                <Clock size={12} />
                KIỂM TRA TIẾP THEO: {getNextMondayCheckLabel()}
              </span>
            </div>

            <h4 className="macro-sop-headline">{sopAction.headline}</h4>
            <p className="macro-sop-summary">{sopAction.summary}</p>

            {sopAction.isLiveDeveloping && sopAction.liveBar && (
              <div className="macro-sop-live-note font-mono">
                <AlertTriangle size={12} />
                <span>
                  Nến hiện tại (W0) đang chạy: <strong>{sopAction.liveBar.decision}</strong> (Score {sopAction.liveBar.composite > 0 ? '+' : ''}{sopAction.liveBar.composite}, BTC ${fmtNumber(sopAction.liveBar.price, 0)}).
                  {' '}Theo SOP: <strong>KHÔNG nhìn nến đang chạy giữa tuần</strong> — chỉ ra quyết định lúc <strong>07:00 sáng Thứ Hai (VN)</strong> sau khi nến Tuần đóng cửa hoàn toàn.
                </span>
              </div>
            )}

            {/* Interactive Reserve & Action Calculator */}
            <div className="macro-sop-calc">
              <div className="macro-sop-calc-inputs font-mono">
                <label>
                  <span>NGÂN SÁCH / TUẦN ($X)</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={sopCalc.weeklyBudget}
                    onChange={(e) => setSopCalc((prev) => ({ ...prev, weeklyBudget: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                </label>
                <label>
                  <span>QUỸ DỰ PHÒNG HIỆN CÓ (R)</span>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={sopCalc.cashReserve}
                    onChange={(e) => setSopCalc((prev) => ({ ...prev, cashReserve: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                </label>
                <div className="macro-sop-rule-toggle">
                  <span>QUY TẮC ÁP DỤNG</span>
                  <div>
                    <button
                      type="button"
                      className={sopCalc.selectedRule === 'rule1' ? 'active' : ''}
                      onClick={() => setSopCalc((prev) => ({ ...prev, selectedRule: 'rule1' }))}
                    >
                      QUY TẮC 1 (100% R)
                    </button>
                    <button
                      type="button"
                      className={sopCalc.selectedRule === 'rule2' ? 'active' : ''}
                      onClick={() => setSopCalc((prev) => ({ ...prev, selectedRule: 'rule2' }))}
                    >
                      QUY TẮC 2 (50% R)
                    </button>
                  </div>
                </div>
              </div>

              {selectedRuleObj && (
                <div className="macro-sop-calc-output">
                  <div className="macro-sop-action-box is-selected">
                    <span className="font-mono">{selectedRuleObj.label} ({selectedRuleObj.code})</span>
                    <strong>{selectedRuleObj.action}</strong>
                    <div className="macro-sop-action-nums font-mono">
                      <span>GIẢI NGÂN TUẦN NÀY: <b>{fmtUsd(selectedRuleObj.spendUsd)}</b></span>
                      <span>CÒN LẠI TRONG R: <b>{fmtUsd(selectedRuleObj.remainingReserveUsd)}</b></span>
                      <span>NẠP ĐỊNH KỲ: <b>+{fmtUsd(selectedRuleObj.nextDepositUsd)}/tuần</b></span>
                    </div>
                  </div>
                  <div className={`macro-sop-action-box${sopAction.cy4?.active ? ' is-cy4-active' : ''}`}>
                    <span className="font-mono">BIẾN THỂ XOAY VÒNG CHU KỲ (CY-4 · RED BUBBLE)</span>
                    <strong>{sopAction.cy4?.action}</strong>
                    <div className="macro-sop-action-nums font-mono">
                      <span>ĐIỀU KIỆN: <b>Score &lt;= -3 &amp; Divergence = NO</b></span>
                      <span>TRẠNG THÁI: <b>{sopAction.cy4?.active ? `RED BUBBLE #${sopAction.rbStreak}` : 'CHỜ'}</b></span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Historical Bubble Telemetry Strip */}
          <div className="macro-sop-stats font-mono">
            <div>
              <span>CHUỖI GREEN BUBBLE HIỆN TẠI</span>
              <strong style={{ color: sopAction.gbStreak > 0 ? '#22c55e' : 'var(--text-contrast)' }}>
                {sopAction.gbStreak > 0 ? `${sopAction.gbStreak} TUẦN LIÊN TIẾP` : '0 TUẦN (CHỜ)'}
              </strong>
            </div>
            <div>
              <span>TỔNG SỐ TUẦN BONG BÓNG</span>
              <strong>
                <span style={{ color: '#22c55e' }}>{sopAction.totalGreenBubbles} GB</span>
                {' / '}
                <span style={{ color: '#ef4444' }}>{sopAction.totalRedBubbles} RB</span>
              </strong>
            </div>
            <div>
              <span>GREEN BUBBLE GẦN NHẤT</span>
              <strong>
                {sopAction.lastGreenBubble
                  ? `${fmtDate(sopAction.lastGreenBubble.time)} ($${fmtNumber(sopAction.lastGreenBubble.price, 0)})`
                  : 'Chưa có'}
              </strong>
            </div>
            <div>
              <span>RED BUBBLE GẦN NHẤT</span>
              <strong>
                {sopAction.lastRedBubble
                  ? `${fmtDate(sopAction.lastRedBubble.time)} ($${fmtNumber(sopAction.lastRedBubble.price, 0)})`
                  : 'Chưa có'}
              </strong>
            </div>
          </div>

          {/* 4. SOP Playbook Content (from sop.md) */}
          <div className="macro-sop-section">
            <h5 className="font-mono">01 // CHUẨN BỊ CHUNG (BẮT BUỘC CHO CẢ 2 QUY TẮC)</h5>
            <div className="macro-sop-prep-grid">
              <article>
                <span className="font-mono">BƯỚC 1 · GIỜ KIỂM TRA CỐ ĐỊNH</span>
                <p>
                  Sáng <strong>Thứ Hai 07:00 (giờ VN, tức 00:00 UTC)</strong> ngay khi nến Tuần (<code>W</code>) trên Binance đóng cửa hoàn toàn.
                  <strong> Không nhìn nến đang chạy giữa tuần</strong> để tránh nhiễu và repaint.
                </p>
              </article>
              <article>
                <span className="font-mono">BƯỚC 2 · ĐIỀU KIỆN VÀO LỆNH DUY NHẤT</span>
                <p>
                  Trên biểu đồ hiện <strong>chấm tròn xanh (Green Bubble / Strong Accum)</strong>: <code>Score &gt;= +3</code> và <code>Divergence = NO</code>.
                  Nếu không có chấm xanh (dù là <code>ACCUMULATE +1/+2</code> hay <code>MIXED / WAIT</code>): <strong>Tuyệt đối KHÔNG mua BTC</strong>.
                </p>
              </article>
              <article>
                <span className="font-mono">BƯỚC 3 · QUẢN LÝ QUỸ DỰ PHÒNG (R)</span>
                <p>
                  Hàng tuần trích đúng ngân sách cố định (VD: <code>$1,000/tuần</code>) vào <strong>Quỹ dự phòng tiền mặt R</strong>.
                  Gửi kênh sinh lời an toàn (Stablecoin Earn / T-Bill ~<code>4% APY</code>) để triệt tiêu <em>Cash Drag</em> trong 2–3 năm chờ đáy.
                </p>
              </article>
            </div>
          </div>

          <div className="macro-sop-section">
            <h5 className="font-mono">02 // SO SÁNH 2 QUY TẮC THỰC THI (SOP MATHCLEAN v3)</h5>
            <div className="macro-sop-rules-grid">
              <article className={`macro-sop-rule-card${sopCalc.selectedRule === 'rule1' ? ' is-active' : ''}`}>
                <header>
                  <span className="font-mono">QUY TẮC 1 · HIỆU SUẤT TỐT NHẤT</span>
                  <h6>GB-7: All-In 100% Reserve on Green Bubble</h6>
                </header>
                <p className="macro-sop-goal">
                  <strong>Mục tiêu:</strong> Đạt giá vốn thấp nhất, ROI &amp; XIRR cao nhất bằng cách dồn toàn bộ hỏa lực tiền mặt ngay tại tuần đầu tiên hệ thống xác nhận đáy đầu hàng.
                </p>
                <ol>
                  <li><strong>Tích lũy quỹ:</strong> Mỗi tuần nạp đều <code>$X</code> vào Quỹ dự phòng <code>R</code>.</li>
                  <li><strong>Kiểm tra 07:00 Thứ Hai VN:</strong> Không có Green Bubble → giữ 100% tiền trong <code>R</code> hưởng lãi an toàn. Có Green Bubble → sang Bước 3.</li>
                  <li><strong>Giải ngân 100%:</strong> Đặt lệnh <strong>Market Buy</strong> (hoặc Limit <code>-1% đến -2%</code> trong ngày Thứ Hai, khớp bù cuối ngày) bằng <strong>100% tiền trong R</strong>. Các tuần GB kế tiếp → mua 100% phần <code>$X</code> mới nạp.</li>
                  <li><strong>Nắm giữ:</strong> Hết cụm Green Bubble → chuyển BTC về ví lạnh/hold dài hạn và lặp lại Bước 1.</li>
                </ol>
                <div className="macro-sop-backtest font-mono">
                  <div><span>2021–2026 ($1k/tuần)</span><b>Avg Cost $16,331 (Equal DCA: $43,072)</b></div>
                  <div><span>ROI / Giá trị cuối (11/2026)</span><b>+84.4% ($534,904) | +93.3% ($560,481 @ 4% APY)</b></div>
                  <div><span>Hiệu quả vốn</span><b>XIRR +24.2%/năm · Sharpe 0.89</b></div>
                  <div><span>Tại đỉnh 09/2025 ($123k)</span><b>ROI +252.8% · MaxDD -20.9% · Sharpe 1.37</b></div>
                  <div><span>Đa chu kỳ 8.3 năm (2018–2026)</span><b>Avg $12,502 · ROI +208.2% (+226.1% @ 4% APY) · Sharpe 0.87</b></div>
                </div>
              </article>

              <article className={`macro-sop-rule-card${sopCalc.selectedRule === 'rule2' ? ' is-active' : ''}`}>
                <header>
                  <span className="font-mono">QUY TẮC 2 · CÂN BẰNG TOÀN DIỆN (KHUYẾN NGHỊ)</span>
                  <h6>GB-6: Fractional 50% Reserve / Green Bubble Week</h6>
                </header>
                <p className="macro-sop-goal">
                  <strong>Mục tiêu:</strong> Lợi nhuận tiệm cận tối đa (~96% hiệu suất Quy tắc 1) nhưng loại bỏ rủi ro dồn hết 100% vào cây nến đầu tiên nếu thị trường gấu còn rơi tiếp.
                </p>
                <ol>
                  <li><strong>Tích lũy quỹ:</strong> Mỗi tuần nạp đều <code>$X</code> vào Quỹ dự phòng <code>R</code>.</li>
                  <li><strong>Kiểm tra 07:00 Thứ Hai VN:</strong> Chưa có Green Bubble → giữ nguyên tiền trong <code>R</code>.</li>
                  <li><strong>Giải ngân chia lớp 50%:</strong> Mỗi tuần có Green Bubble → giải ngân đúng <strong>50% tiền mặt hiện có trong R</strong> (<code>Spend = 0.50 × R</code>). Cụm 4–5 tuần tự rải theo cấp số nhân (<code>50% → 25% → 12.5% → 6.25% → 3.1%</code>), giải ngân ~94–97% quỹ.</li>
                  <li><strong>Tùy chọn xoay vòng (Biến thể CY-4):</strong> Khi cụm <strong>Red Bubble (Score &lt;= -3 &amp; !div)</strong> đầu tiên xuất hiện → <strong>bán 50% BTC đang giữ đúng 1 lần duy nhất</strong> về <code>R</code> (4% APY), giữ 50% Core Hold ăn trọn sóng bull kéo dài.</li>
                </ol>
                <div className="macro-sop-backtest font-mono">
                  <div><span>2021–2026 ($1k/tuần)</span><b>Avg Cost $16,472 (chỉ chênh $141 so với All-In)</b></div>
                  <div><span>ROI / Giá trị cuối (11/2026)</span><b>+81.2% ($525,592) | +90.2% ($551,705 @ 4% APY)</b></div>
                  <div><span>Hiệu quả vốn</span><b>XIRR +23.6%/năm · Sharpe 0.88 · MaxDD -41.4%</b></div>
                  <div><span>Tại đỉnh 09/2025 ($123k)</span><b>ROI +243.6% · MaxDD -20.7% · Sharpe 1.36</b></div>
                  <div><span>Đa chu kỳ 8.3 năm (2018–2026)</span><b>Avg $12,868 · ROI +197.0% (+215.5% @ 4% APY) · Sharpe 0.89 (CY-4)</b></div>
                </div>
              </article>
            </div>
          </div>

          <div className="macro-sop-quick-choice">
            <div className="macro-sop-choice-copy">
              <strong className="font-mono">TÓM TẮT LỰA CHỌN NHANH</strong>
              <ul>
                <li><strong>Chọn Quy tắc 1 (100% Reserve)</strong> nếu bạn kỷ luật tuyệt đối, tin tưởng bộ lọc đáy <code>MathClean v3</code> và muốn tối ưu từng % lợi nhuận trên số vốn giải ngân.</li>
                <li><strong>Chọn Quy tắc 2 (50% Reserve / tuần GB)</strong> nếu bạn ưu tiên an toàn tâm lý &amp; phân bổ rủi ro: giữ <code>96%</code> hiệu suất Quy tắc 1 (<code>+90.2%</code> vs <code>+93.3%</code>) nhưng vẫn còn tiền mặt dự phòng nếu thị trường có nhịp rũ bỏ thêm.</li>
              </ul>
            </div>
            <div className="macro-sop-config-checklist font-mono">
              <span>ĐỐI CHIẾU CẤU HÌNH CHUẨN</span>
              <div>
                {sopAction.compliance.checks.map((item) => (
                  <div key={item.key} className={`macro-sop-check-row ${item.ok ? 'ok' : 'diff'}`}>
                    <span>{item.label}</span>
                    <b>{item.ok ? `✓ ${item.displayExpected}` : `⚠ ${item.displayActual} → ${item.displayExpected}`}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

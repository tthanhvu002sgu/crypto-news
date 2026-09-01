import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Activity, ChevronDown, ChevronUp, RefreshCw, Settings2 } from 'lucide-react';
import { getBTCMacroKlines } from '../services/api';
import { readCacheValue } from '../utils/cache';
import {
  calculateMacroDashboard,
  MACRO_DASHBOARD_DEFAULTS,
  CHART_RANGES,
  chartBarsForRange,
} from '../services/macroDashboardEngine';
import ModuleMenu from './ModuleMenu';

const SETTINGS_KEY = 'macro-dashboard-v2-settings';
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
    return saved && typeof saved === 'object' ? { ...MACRO_DASHBOARD_DEFAULTS, ...saved } : { ...MACRO_DASHBOARD_DEFAULTS };
  } catch {
    return { ...MACRO_DASHBOARD_DEFAULTS };
  }
};

const fmtSigned = (value, digits = 1) => {
  if (!Number.isFinite(value)) return '---';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
};

const fmtNumber = (value, digits = 2) => Number.isFinite(value)
  ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '---';

function ZoneText({ zone, suffix = '' }) {
  return <span style={{ color: zoneColors[zone] || zoneColors.FAIR }}>{zone || '---'}{suffix}</span>;
}

function SettingSelect({ label, value, options, onChange }) {
  return (
    <label className="macro-setting-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default function MacroDashboardCard({ livePrice, theme, moduleId = 'dash_macro_valuator' }) {
  const [settings, setSettings] = useState(loadSettings);
  const [candles, setCandles] = useState(() => {
    const intervalMap = { D: '1d', W: '1w', M: '1M' };
    const interval = intervalMap[settings.timeframe] || '1w';
    const targetLimit = Math.max(2, Math.min(Math.trunc(HISTORY_LIMIT), 10000));
    const cached = readCacheValue(`btcMacroKlines_BTCUSDT_${interval}_${targetLimit}`);
    return Array.isArray(cached) ? cached : [];
  });
  const [status, setStatus] = useState(() => {
    const intervalMap = { D: '1d', W: '1w', M: '1M' };
    const interval = intervalMap[settings.timeframe] || '1w';
    const targetLimit = Math.max(2, Math.min(Math.trunc(HISTORY_LIMIT), 10000));
    const cached = readCacheValue(`btcMacroKlines_BTCUSDT_${interval}_${targetLimit}`);
    return Array.isArray(cached) && cached.length > 0 ? 'ready' : 'loading';
  });
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [chartRange, setChartRange] = useState('ALL');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings persistence is optional.
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    getBTCMacroKlines('BTCUSDT', settings.timeframe, HISTORY_LIMIT, reloadKey > 0).then((rows) => {
      if (cancelled) return;
      if (Array.isArray(rows) && rows.length > 0) {
        setCandles(rows);
        setStatus('ready');
      } else {
        if (candles.length === 0) {
          setStatus('error');
          setError('Không tải được lịch sử Binance Spot.');
        }
      }
    });
    return () => { cancelled = true; };
  }, [settings.timeframe, reloadKey]);

  const effectiveCandles = useMemo(() => {
    if (candles.length === 0 || !Number.isFinite(Number(livePrice))) return candles;
    const rows = candles.slice();
    rows[rows.length - 1] = { ...rows.at(-1), close: Number(livePrice) };
    return rows;
  }, [candles, livePrice]);

  const dashboard = useMemo(
    () => calculateMacroDashboard(effectiveCandles, settings),
    [effectiveCandles, settings],
  );

  const updateSetting = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  const changeTimeframe = (value) => {
    setStatus('loading');
    setError('');
    updateSetting('timeframe', value);
  };
  const reloadHistory = () => {
    setStatus('loading');
    setError('');
    setReloadKey((value) => value + 1);
  };
  const current = dashboard.current;
  const previous = dashboard.previous;
  const currentColor = decisionColor(current);
  const visibleBars = chartBarsForRange(chartRange, settings.timeframe);
  const visibleSeries = Number.isFinite(visibleBars)
    ? dashboard.series.slice(-visibleBars)
    : dashboard.series;
  const isLight = theme === 'light';

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
        label: 'Strong Accum',
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
        label: 'Overbought',
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
            if (context.dataset.label === 'Strong Accum' || context.dataset.label === 'Overbought') {
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
          color: isLight ? '#64748b' : '#64748b',
          font: { size: 9 },
          callback: (value) => `$${Number(value).toLocaleString('en-US', { notation: 'compact' })}`,
        },
      },
    },
  }), [isLight, visibleSeries]);

  return (
    <section className="glass-panel macro-dashboard-card">
      <header className="macro-dashboard-header">
        <div>
          <div className="macro-dashboard-title-row">
            <Activity size={15} style={{ color: currentColor }} />
            <h3 className="font-mono">MACRO DASHBOARD v2</h3>
            <span className="macro-source-badge font-mono">BINANCE:BTCUSDT · {settings.timeframe}</span>
          </div>
          <p>Valuator + PnL Matrix · Pine parity mode</p>
        </div>
        <div className="macro-dashboard-actions">
          <button type="button" onClick={reloadHistory} title="Tải lại dữ liệu">
            <RefreshCw size={13} className={status === 'loading' ? 'macro-spin' : ''} />
          </button>
          <button type="button" onClick={() => setShowSettings((value) => !value)} className={showSettings ? 'active' : ''}>
            <Settings2 size={13} /> CẤU HÌNH
          </button>
          <ModuleMenu moduleId={moduleId} />
        </div>
      </header>

      {showSettings && (
        <div className="macro-settings font-mono">
          <SettingSelect label="Locked TF" value={settings.timeframe} options={['D', 'W', 'M']} onChange={changeTimeframe} />
          <SettingSelect label="Cost Basis" value={settings.costMethod} options={['SMA', 'VWAP', 'Median HL', 'EMA']} onChange={(value) => updateSetting('costMethod', value)} />
          <SettingSelect label="Cohort Weight" value={settings.weightScheme} options={['Equal', 'Short-heavy', 'Long-heavy']} onChange={(value) => updateSetting('weightScheme', value)} />
          <SettingSelect label="PnL Zone" value={settings.zoneMethod} options={['Percentile', 'Convergence']} onChange={(value) => updateSetting('zoneMethod', value)} />
          <SettingSelect label="Z Mode" value={settings.zMode} options={['Structural', 'Adaptive']} onChange={(value) => updateSetting('zMode', value)} />
          <SettingSelect label="Sigma" value={settings.sigmaMethod} options={['EWMA D²', 'Rolling Std']} onChange={(value) => updateSetting('sigmaMethod', value)} />
          <label className="macro-setting-check">
            <input type="checkbox" checked={settings.useDualWindow} onChange={(event) => updateSetting('useDualWindow', event.target.checked)} /> Dual confirm
          </label>
          <label className="macro-setting-check">
            <input type="checkbox" checked={settings.useHysteresis} onChange={(event) => updateSetting('useHysteresis', event.target.checked)} /> Hysteresis
          </label>
          <button type="button" className="macro-reset-btn" onClick={() => setSettings({ ...MACRO_DASHBOARD_DEFAULTS })}>RESET DEFAULT</button>
        </div>
      )}

      {status === 'error' && <div className="macro-dashboard-state font-mono">{error}</div>}
      {status === 'loading' && !current && <div className="macro-dashboard-state font-mono">ĐANG TẢI LỊCH SỬ D/W/M…</div>}

      {current && (
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
              <div><span>DIVERGENCE</span><strong className={current.divergence ? 'warning' : ''}>{current.divergence ? 'YES ⚠' : 'NO'}</strong></div>
            </div>
          </div>

          <div className="macro-zone-grid">
            <article style={{ '--zone-color': zoneColors[current.pnlZone] }}>
              <span className="macro-zone-index font-mono">01 / PNL MATRIX</span>
              <div className="macro-zone-name"><ZoneText zone={current.pnlZone} /></div>
              <p>Weighted ROI <strong>{fmtSigned(current.weightedAverage)}</strong> · percentile <strong>{current.percentile.toFixed(1)}%</strong></p>
              <div className="macro-zone-sub font-mono">UNDERWATER {current.underwater.toFixed(0)}% · MIN ROI {fmtSigned(current.roiMin)}</div>
            </article>
            <article style={{ '--zone-color': zoneColors[current.valZone] }}>
              <span className="macro-zone-index font-mono">02 / VALUATOR</span>
              <div className="macro-zone-name"><ZoneText zone={current.valZone} /></div>
              <p>Z long <strong>{current.valZLong > 0 ? '+' : ''}{current.valZLong.toFixed(2)}</strong> · Z short <strong>{current.valZShort > 0 ? '+' : ''}{current.valZShort.toFixed(2)}</strong></p>
              <div className="macro-zone-sub font-mono">IMPLIED CAGR {fmtSigned(current.impliedCagr)} · σ {current.sigma.toFixed(3)}</div>
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
                  <tr><td>PnL Zone</td><td><ZoneText zone={current.pnlZone} suffix={` (${current.percentile.toFixed(1)}%ile)`} /></td><td><ZoneText zone={previous?.pnlZone} suffix={previous ? ` (${previous.percentile.toFixed(1)}%ile)` : ''} /></td></tr>
                  <tr><td>PnL wAvg ROI</td><td>{fmtSigned(current.weightedAverage)}</td><td>{fmtSigned(previous?.weightedAverage)}</td></tr>
                  <tr><td>% Underwater</td><td>{current.underwater.toFixed(1)}% · min {fmtSigned(current.roiMin)}</td><td>{previous ? `${previous.underwater.toFixed(1)}% · min ${fmtSigned(previous.roiMin)}` : '---'}</td></tr>
                  <tr><td>Rel Spread</td><td>{current.relativeSpread.toFixed(2)} [{fmtSigned(current.roiMin)}…{fmtSigned(current.roiMax)}]</td><td>{previous?.relativeSpread.toFixed(2) ?? '---'}</td></tr>
                  <tr><td>ROI 1/2/3/4Y</td><td>{current.rois.map((value) => value.toFixed(0)).join('/')}%</td><td>{settings.weightScheme}</td></tr>
                  <tr><td>Val Zone</td><td><ZoneText zone={current.valZone} suffix={` (Z ${current.valZLong > 0 ? '+' : ''}${current.valZLong.toFixed(2)})`} /></td><td><ZoneText zone={previous?.valZone} suffix={previous ? ` (Z ${previous.valZLong > 0 ? '+' : ''}${previous.valZLong.toFixed(2)})` : ''} /></td></tr>
                  <tr><td>Z Short / Long</td><td>{current.valZShort.toFixed(2)} / {current.valZLong.toFixed(2)}</td><td>{previous ? `${previous.valZShort.toFixed(2)} / ${previous.valZLong.toFixed(2)}` : '---'}</td></tr>
                  <tr><td>vs Fair Value</td><td>{fmtSigned(current.versusFairValue)} · FV ${fmtNumber(current.fairValue, 0)}</td><td>{fmtSigned(previous?.versusFairValue)}</td></tr>
                  <tr><td>Impl. CAGR</td><td>{fmtSigned(current.impliedCagr)} [{settings.zMode}]</td><td>{settings.costMethod} · {settings.zoneMethod}</td></tr>
                  <tr><td>Bars in Zone</td><td>PnL {current.pnlBarsInZone} · Val {current.valBarsInZone}</td><td>minAlert {settings.minBarsAlert}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <footer className="macro-dashboard-footer font-mono">
            <span>
              {effectiveCandles.length} BARS · {effectiveCandles[0]?.time.toLocaleDateString('vi-VN')} → {current.time.toLocaleDateString('vi-VN')} · {current.isClosed ? 'CLOSED CANDLE' : 'LIVE CANDLE W0'}
            </span>
            <span>PRICE-PATH PROXY · NOT ON-CHAIN REALIZED PRICE</span>
          </footer>
        </>
      )}
    </section>
  );
}

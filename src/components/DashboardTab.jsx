import { useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import MarketBiasCard from './MarketBiasCard';
import MacroDashboardCard from './MacroDashboardCard';
import PolymarketWhales from './PolymarketWhales';
import EconomicCalendarPanel from './EconomicCalendarPanel';
import CascadeTab from './CascadeTab';
import OptionsRegimePanel from './OptionsRegimePanel';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import SortableModuleItem from './SortableModuleItem';
import DataOriginBadge, { DataOriginLegend } from './DataOriginBadge';
import CmeCotCard from './CmeCotCard';
import CorrelationMatrixPanel from './CorrelationMatrixPanel';
import { formatEtfFlowM } from '../utils/etfFlows';

const isPlausibleCpiYoY = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= -20 && number <= 50;
};

export default function DashboardTab({
  data,
  theme,
  newsSliderRef,
  etfHoldings,
  fmt,
  fmtB,
  btcDisplay,
  fund,
  CASCADE_KEY_MAP,
  METRIC_METADATA,
  etfHistory,
  aumChangeStats,
  etfChartType,
  setEtfChartType,
  etfAumTimeframe,
  setEtfAumTimeframe,
  etfFlowChartData,
  etfFlowChartOpts,
  etfWeeklyHistory = [],
  etfFlowWeeklyChartData,
  etfFlowWeeklyChartOpts,
  etfAumChartData,
  etfAumChartOpts,
}) {
  const { isModuleHidden, getGroupOrder, MODULES_CONFIG } = useModuleVisibility();
  const [etfFlowTimeframe, setEtfFlowTimeframe] = useState('D');

  const hasSection1 = !isModuleHidden('dash_macro') || !isModuleHidden('dash_correlation_matrix') || !isModuleHidden('dash_calendar') || !isModuleHidden('tab_cascade');
  const hasSection2 = !isModuleHidden('dash_etf_holdings') || !isModuleHidden('dash_etf_flows') || !isModuleHidden('dash_cme_cot') || !isModuleHidden('dash_macro_valuator');
  const hasSection3 = (!isModuleHidden('dash_news') && data?.news && data.news.length > 0) || !isModuleHidden('dash_polymarket');

  // Helper to safely get macro values
  const getMacroValue = (key, fallback = '---') => {
    if (!data) return fallback;
    const val = data[key];
    if (val == null) return fallback;
    if (typeof val === 'object' && val.price != null) return val.price.toFixed(1);
    if (typeof val === 'number') return val.toFixed(2);
    return val;
  };

  return (
    <div className="dashboard-layout">
      {/* ── HERO: Market Bias Engine Card ── */}
      {!isModuleHidden('dash_bias') && (
        <MarketBiasCard data={data} etfHistory={etfHistory} btcDisplay={btcDisplay} theme={theme} moduleId="dash_bias" />
      )}

      {(() => {
        const visibleSectionIds = getGroupOrder('dash_sections').filter((secId) => {
          if (secId === 'dash_sec1') return hasSection1;
          if (secId === 'dash_options_regime') return !isModuleHidden('dash_options_regime');
          if (secId === 'dash_sec2') return hasSection2;
          if (secId === 'dash_sec3') return hasSection3;
          return false;
        });

        return visibleSectionIds.map((secId) => {
          if (secId === 'dash_sec1') {
            return (
              <SortableModuleItem key={secId} groupKey="dash_sections" itemId={secId} label="Nhóm: Vĩ Mô & Thác Thanh Khoản" className="dashboard-layout">
                <div className="overview-section-header">
                  <h2 className="overview-section-title">Vĩ mô &amp; Thác thanh khoản</h2>
                  <span className="overview-section-desc">Chu kỳ kinh tế, van thanh khoản vĩ mô và lịch sự kiện</span>
                </div>

                {getGroupOrder('dash_sec1').map((id) => {
        if (id === 'dash_macro') {
          if (isModuleHidden('dash_macro')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec1" itemId={id} label={MODULES_CONFIG[id]?.label}>
        <div className="glass-panel panel-padded">
          <div className="panel-top-bar">
            <div className="panel-title-group">
              <h3 className="chart-title" style={{ margin: 0 }}>
                Macro Pulse
              </h3>
              <DataOriginBadge origin="history" label="Lịch sử API" compact />
            </div>
            <ModuleMenu moduleId="dash_macro" />
          </div>

          <div className="hairline-bento-grid">
            <div className="hairline-cell">
              <div className="hairline-cell-label">DXY</div>
              <div className="hairline-cell-val">{getMacroValue('dxy')}</div>
              <div className="hairline-cell-sub" style={{ color: data?.dxy > 104 ? 'var(--color-rose-400)' : 'var(--color-emerald-400)' }}>
                {data?.dxy > 104 ? 'Risk Off ↑' : data?.dxy < 100 ? 'Risk On ↓' : 'Neutral'}
              </div>
            </div>

            <div className="hairline-cell">
              <div className="hairline-cell-label">VIX</div>
              <div className="hairline-cell-val">{getMacroValue('vix')}</div>
              <div className="hairline-cell-sub" style={{ color: data?.vix?.price < 18 ? 'var(--color-emerald-400)' : data?.vix?.price > 28 ? 'var(--color-rose-400)' : 'var(--text-slate-400)' }}>
                {data?.vix?.price < 18 ? 'Biến động thấp' : data?.vix?.price > 28 ? 'Hoảng loạn cao' : 'Bình thường'}
              </div>
            </div>

            <div className="hairline-cell">
              <div className="hairline-cell-label">10Y Yield / Lãi suất thực</div>
              <div className="hairline-cell-val">
                {data?.tenYearYield ? `${data.tenYearYield}%` : '---'}
                {data?.fedFundsRate != null && isPlausibleCpiYoY(data?.cpi) && (
                  <span className="text-slate-400" style={{ fontSize: 'var(--text-body)', fontWeight: 500 }}> / {(data.fedFundsRate - data.cpi).toFixed(1)}%</span>
                )}
              </div>
              <div className="hairline-cell-sub text-slate-400">
                Fed Funds trừ CPI YoY
              </div>
            </div>

            <div className="hairline-cell">
              <div className="hairline-cell-label">Fear &amp; Greed</div>
              <div className="hairline-cell-val">{data?.fngData?.value ?? '---'}</div>
              <div className="hairline-cell-sub" style={{ color: data?.fngData?.value >= 75 ? 'var(--color-rose-400)' : data?.fngData?.value <= 25 ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' }}>
                {data?.fngData?.sentiment || 'Neutral'}
              </div>
            </div>

            <div className="hairline-cell">
              <div className="hairline-cell-label">S&amp;P 500</div>
              <div className="hairline-cell-val">
                {data?.sp500?.price ? data.sp500.price.toFixed(0) : '---'}
                {data?.sp500?.change != null && (
                  <span style={{ fontSize: 'var(--text-sm)', marginLeft: '6px', color: data.sp500.change >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)' }}>
                    {data.sp500.change >= 0 ? '+' : ''}{data.sp500.change.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="hairline-cell-sub text-slate-400">Chứng khoán Mỹ</div>
            </div>

            <div className="hairline-cell">
              <div className="hairline-cell-label">BTC Dominance</div>
              <div className="hairline-cell-val">
                {data?.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---'}
              </div>
              <div className="hairline-cell-sub text-slate-400">
                Cấu trúc vốn hóa
              </div>
            </div>
          </div>
        </div>
            </SortableModuleItem>
          );
        }
        if (id === 'dash_correlation_matrix') {
          if (isModuleHidden('dash_correlation_matrix')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec1" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <CorrelationMatrixPanel moduleId="dash_correlation_matrix" />
            </SortableModuleItem>
          );
        }
        if (id === 'dash_calendar') {
          if (isModuleHidden('dash_calendar')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec1" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <EconomicCalendarPanel theme={theme} />
            </SortableModuleItem>
          );
        }
        if (id === 'tab_cascade') {
          if (isModuleHidden('tab_cascade')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec1" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <CascadeTab
                data={data}
                fmt={fmt}
                fmtB={fmtB}
                btcDisplay={btcDisplay}
                fund={fund}
                CASCADE_KEY_MAP={CASCADE_KEY_MAP}
                METRIC_METADATA={METRIC_METADATA}
              />
            </SortableModuleItem>
          );
        }
        return null;
                })}
              </SortableModuleItem>
            );
          }

          if (secId === 'dash_options_regime') {
            return (
              <SortableModuleItem key={secId} groupKey="dash_sections" itemId={secId} label={MODULES_CONFIG[secId]?.label} className="dashboard-layout">
                <div className="overview-section-header">
                  <h2 className="overview-section-title">Options &amp; Gamma Exposure</h2>
                  <span className="overview-section-desc">Call/Put Wall, GEX Flip, Max Pain và Gamma Regime từ Deribit</span>
                </div>
                <OptionsRegimePanel moduleId="dash_options_regime" />
              </SortableModuleItem>
            );
          }

          if (secId === 'dash_sec2') {
            return (
              <SortableModuleItem key={secId} groupKey="dash_sections" itemId={secId} label="Nhóm: Tổ Chức TradFi & Định Giá Chu Kỳ" className="dashboard-layout">
                <div className="overview-section-header">
                  <h2 className="overview-section-title">Tổ chức TradFi &amp; Định giá chu kỳ</h2>
                  <span className="overview-section-desc">Dòng vốn Spot ETF, vị thế phái sinh CME COT và mô hình định giá chu kỳ</span>
                </div>

                {getGroupOrder('dash_sec2').map((id) => {
        if (id === 'dash_etf_pair') {
          if (isModuleHidden('dash_etf_holdings') && isModuleHidden('dash_etf_flows')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec2" itemId={id} label="Cụm US Spot Bitcoin ETFs (Holdings & Flows)">
              <div className="whales-row">
                {getGroupOrder('dash_etf_pair').map((pairId) => {
                  if (pairId === 'dash_etf_holdings') {
                    if (isModuleHidden('dash_etf_holdings')) return null;
                    return (
                      <SortableModuleItem key={pairId} groupKey="dash_etf_pair" itemId={pairId} isHorizontal label={MODULES_CONFIG[pairId]?.label} style={{ minWidth: 0 }}>
            <div className="glass-panel whale-panel">
              <div className="panel-top-bar">
                <div className="panel-title-group">
                  <h3 className="chart-title" style={{ margin: 0 }}>
                    US Spot Bitcoin ETFs ({fmt(etfHoldings.total, 0)} BTC)
                  </h3>
                  <DataOriginBadge origin="history" label="Lịch sử ETF" compact />
                </div>
                <ModuleMenu moduleId="dash_etf_holdings" />
              </div>
              <div className="etf-summary">
                <div className="etf-sum-card">
                  <span className="etf-sum-label">Tổng AUM</span>
                  <span className="etf-sum-val text-emerald">${fmt((etfHoldings.total * (btcDisplay?.price || 60000)) / 1e9, 2)}B</span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">Dòng ròng 24h</span>
                  <span className={`etf-sum-val ${etfHistory[etfHistory.length - 1]?.flow >= 0 ? 'text-emerald' : 'text-rose'}`}>
                    {etfHistory[etfHistory.length - 1]?.flow >= 0 ? '+' : ''}{etfHistory[etfHistory.length - 1]?.flow}M
                  </span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">Tỷ lệ cung nắm giữ</span>
                  <span className="etf-sum-val text-slate-200">
                    ~{((etfHoldings.total / (data.node?.circulatingSupply || 20039293.75)) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">Xu hướng AUM ({aumChangeStats.oldestDate} → nay)</span>
                  <span className={`etf-sum-val ${aumChangeStats.direction === 'up' ? 'text-emerald' : aumChangeStats.direction === 'down' ? 'text-rose' : 'text-slate-200'}`}>
                    {aumChangeStats.direction === 'up' ? '▲' : aumChangeStats.direction === 'down' ? '▼' : ''} {Math.abs(aumChangeStats.diffPct).toFixed(1)}%
                    <span className="etf-sum-delta">
                      ({aumChangeStats.diffUsd >= 0 ? '+' : ''}{aumChangeStats.diffUsd.toFixed(2)}B)
                    </span>
                  </span>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="whale-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Quỹ ETF</th>
                      <th style={{ textAlign: 'right' }}>Nắm giữ</th>
                      <th style={{ textAlign: 'right' }}>Giá trị</th>
                      <th style={{ textAlign: 'right' }}>Thị phần</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etfHoldings.funds.map((e, idx) => (
                      <tr key={idx}>
                        <td style={{ color: 'var(--text-contrast)', fontWeight: 500 }}>{e.name}</td>
                        <td style={{ textAlign: 'right' }}>{e.holdings.toLocaleString()} BTC</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-contrast)', fontWeight: 600 }}>${fmt((e.holdings * (btcDisplay?.price || 60000)) / 1e9, 2)}B</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-slate-400)' }}>{e.marketShare}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
                      </SortableModuleItem>
                    );
                  }
                  if (pairId === 'dash_etf_flows') {
                    if (isModuleHidden('dash_etf_flows')) return null;
                    return (
                      <SortableModuleItem key={pairId} groupKey="dash_etf_pair" itemId={pairId} isHorizontal label={MODULES_CONFIG[pairId]?.label} style={{ minWidth: 0 }}>
            <div className="glass-panel whale-panel">
              <div className="chart-header panel-top-bar">
                <div className="panel-title-group">
                  <h3 className="chart-title" style={{ margin: 0 }}>
                    {etfChartType === 'flows' ? 'Lịch sử dòng tiền ròng ETF' : 'Xu hướng tổng tài sản AUM'}
                  </h3>
                  <DataOriginBadge origin="history" label="Lịch sử ETF" compact />
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {etfChartType === 'flows' && (
                    <div className="segmented-control">
                      {[
                        { key: 'D', title: 'Theo ngày' },
                        { key: 'W', title: 'Theo tuần' },
                      ].map(tf => (
                        <button
                          key={tf.key}
                          type="button"
                          onClick={() => setEtfFlowTimeframe(tf.key)}
                          className={`segmented-btn ${etfFlowTimeframe === tf.key ? 'is-active' : ''}`}
                          title={tf.title}
                        >
                          {tf.key}
                        </button>
                      ))}
                    </div>
                  )}
                  {etfChartType === 'aum' && (
                    <div className="segmented-control">
                      {['30D', '90D', 'ALL'].map(tf => (
                        <button
                          key={tf}
                          type="button"
                          onClick={() => setEtfAumTimeframe(tf)}
                          className={`segmented-btn ${etfAumTimeframe === tf ? 'is-active' : ''}`}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="segmented-control">
                    <button
                      type="button"
                      onClick={() => setEtfChartType('flows')}
                      className={`segmented-btn ${etfChartType === 'flows' ? 'is-active' : ''}`}
                    >
                      Dòng tiền
                    </button>
                    <button
                      type="button"
                      onClick={() => setEtfChartType('aum')}
                      className={`segmented-btn ${etfChartType === 'aum' ? 'is-active' : ''}`}
                    >
                      Xu hướng AUM
                    </button>
                  </div>
                  <ModuleMenu moduleId="dash_etf_flows" />
                </div>
              </div>
              {etfHistory.length > 0 ? (
                etfChartType === 'flows' ? (
                  <div className="etf-flow-subpanel">
                    <div className="etf-flow-subpanel-header">
                      <span className="etf-flow-tf-badge">
                        {etfFlowTimeframe === 'D' ? 'Theo ngày' : 'Theo tuần'}
                      </span>
                      {(() => {
                        const latestItem = etfFlowTimeframe === 'D'
                          ? etfHistory[etfHistory.length - 1]
                          : etfWeeklyHistory[etfWeeklyHistory.length - 1];
                        if (!latestItem) return null;
                        const val = Number(latestItem.flow);
                        const label = etfFlowTimeframe === 'D' ? latestItem.date : latestItem.label;
                        return (
                          <span className={`etf-flow-latest ${val >= 0 ? 'text-emerald' : 'text-rose'}`}>
                            {label}: {formatEtfFlowM(val)}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="etf-flow-chart-wrap" style={{ height: '220px' }}>
                      {etfFlowTimeframe === 'D' ? (
                        <Bar data={etfFlowChartData} options={etfFlowChartOpts} />
                      ) : etfFlowWeeklyChartData?.labels?.length > 0 ? (
                        <Bar data={etfFlowWeeklyChartData} options={etfFlowWeeklyChartOpts} />
                      ) : (
                        <div className="chart-empty font-mono">Chưa có dữ liệu tuần</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="chart-body" style={{ height: '220px' }}>
                    <Line data={etfAumChartData} options={etfAumChartOpts} />
                  </div>
                )
              ) : (
                <div className="chart-body" style={{ height: '220px' }}>
                  <div className="chart-empty font-mono">Đang tải biểu đồ...</div>
                </div>
              )}
            </div>
                      </SortableModuleItem>
                    );
                  }
                  return null;
                })}
              </div>
            </SortableModuleItem>
          );
        }
        if (id === 'dash_cme_cot') {
          if (isModuleHidden('dash_cme_cot')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec2" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <CmeCotCard cotData={data.cotData} theme={theme} moduleId="dash_cme_cot" />
            </SortableModuleItem>
          );
        }
        if (id === 'dash_macro_valuator') {
          if (isModuleHidden('dash_macro_valuator')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec2" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <MacroDashboardCard livePrice={btcDisplay?.price} theme={theme} moduleId="dash_macro_valuator" />
            </SortableModuleItem>
          );
        }
        return null;
                })}
              </SortableModuleItem>
            );
          }

          if (secId === 'dash_sec3') {
            return (
              <SortableModuleItem key={secId} groupKey="dash_sections" itemId={secId} label="Nhóm: Tin Tức & Dự Báo Phi Tập Trung" className="dashboard-layout">
                <div className="overview-section-header">
                  <h2 className="overview-section-title">Tin tức &amp; Dự báo phi tập trung</h2>
                  <span className="overview-section-desc">Dòng tin tức thị trường và thị trường dự báo Polymarket</span>
                </div>

                {getGroupOrder('dash_sec3').map((id) => {
        if (id === 'dash_news') {
          if (isModuleHidden('dash_news') || !data.news || data.news.length === 0) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec3" itemId={id} label={MODULES_CONFIG[id]?.label}>
        <div className="news-slider-wrapper glass-panel" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }}>
            <ModuleMenu moduleId="dash_news" />
          </div>
          <div className="news-slider" ref={newsSliderRef}>
            {data.news.map((item, idx) => {
              const catColor = item.cat === 'macro' ? 'var(--color-amber-400)' : 'var(--color-emerald-400)';
              const catBg = item.cat === 'macro' ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)';
              const catBorder = item.cat === 'macro' ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)';
              return (
                <div key={idx} className="news-slide-item" onDragStart={(e) => e.preventDefault()}>
                  <div className="news-slide-meta font-mono">
                    <span className="news-tag" style={{ color: catColor, background: catBg, borderColor: catBorder }}>{item.tag}</span>
                    <span className="news-time">{item.timeStr}</span>
                  </div>
                  <a href={item.link} target="_blank" rel="noreferrer" className="news-link">
                    <p className="news-slide-title">{item.title}</p>
                    {item.snippet && <p className="news-slide-snippet">{item.snippet}</p>}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
            </SortableModuleItem>
          );
        }
        if (id === 'dash_polymarket') {
          if (isModuleHidden('dash_polymarket')) return null;
          return (
            <SortableModuleItem key={id} groupKey="dash_sec3" itemId={id} label={MODULES_CONFIG[id]?.label}>
              <PolymarketWhales moduleId="dash_polymarket" fmt={fmt} />
            </SortableModuleItem>
          );
        }
        return null;
                })}
              </SortableModuleItem>
            );
          }

          return null;
        });
      })()}
    </div>
  );
}

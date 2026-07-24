import { Line, Bar } from 'react-chartjs-2';
import MarketBiasCard from './MarketBiasCard';
import PolymarketWhales from './PolymarketWhales';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';

const isPlausibleCpiYoY = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= -20 && number <= 50;
};

export default function DashboardTab({
  data,
  theme,
  newsSliderRef,
  btcChartData,
  getChartOpts,
  currentLS,
  lsChartData,
  oiChartData,
  etfHoldings,
  fmt,
  btcDisplay,
  etfHistory,
  aumChangeStats,
  etfChartType,
  setEtfChartType,
  etfAumTimeframe,
  setEtfAumTimeframe,
  etfFlowChartData,
  etfFlowChartOpts,
  etfAumChartData,
  etfAumChartOpts,
}) {
  const { isModuleHidden } = useModuleVisibility();

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
      {/* Market Bias Engine Card */}
      {!isModuleHidden('dash_bias') && (
        <MarketBiasCard data={data} etfHistory={etfHistory} moduleId="dash_bias" />
      )}
      {/* News Slider */}
      {!isModuleHidden('dash_news') && data.news && data.news.length > 0 && (
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
      )}

      {/* NEW: Macro Pulse Panel */}
      {!isModuleHidden('dash_macro') && (
        <div className="glass-panel" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 className="chart-title font-mono text-emerald" style={{ margin: 0, fontSize: '0.95rem' }}>
              <span className="dot dot-emerald" /> MACRO PULSE
            </h3>
            <ModuleMenu moduleId="dash_macro" />
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', 
            gap: '10px' 
          }}>
            {/* DXY */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>DXY</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {getMacroValue('dxy')}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: data?.dxy > 104 ? 'var(--color-rose-400)' : 'var(--color-emerald-400)' }}>
                {data?.dxy > 104 ? 'Risk Off ↑' : data?.dxy < 100 ? 'Risk On ↓' : 'Neutral'}
              </div>
            </div>

            {/* VIX */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>VIX</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {getMacroValue('vix')}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: data?.vix?.price < 18 ? 'var(--color-emerald-400)' : data?.vix?.price > 28 ? 'var(--color-rose-400)' : 'var(--text-slate-400)' }}>
                {data?.vix?.price < 18 ? 'Low Volatility' : data?.vix?.price > 28 ? 'High Fear' : 'Normal'}
              </div>
            </div>

            {/* 10Y Yield + Real Rate */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>10Y Yield / Real Rate</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {data?.tenYearYield ? `${data.tenYearYield}%` : '---'}
                {data?.fedFundsRate != null && isPlausibleCpiYoY(data?.cpi) && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-slate-400)' }}> / {(data.fedFundsRate - data.cpi).toFixed(1)}%</span>
                )}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                Proxy lãi suất thực = Fed - CPI YoY
              </div>
            </div>

            {/* Fear & Greed */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>Fear & Greed</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {data?.fngData?.value ?? '---'}
              </div>
              <div style={{ 
                fontSize: '0.6rem', 
                marginTop: '2px', 
                color: data?.fngData?.value >= 75 ? 'var(--color-rose-400)' : data?.fngData?.value <= 25 ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' 
              }}>
                {data?.fngData?.sentiment || 'Neutral'}
              </div>
            </div>

            {/* S&P 500 */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>S&P 500</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {data?.sp500?.price ? data.sp500.price.toFixed(0) : '---'}
                {data?.sp500?.change != null && (
                  <span style={{ fontSize: '0.7rem', marginLeft: '4px', color: data.sp500.change >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)' }}>
                    {data.sp500.change >= 0 ? '+' : ''}{data.sp500.change.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* BTC Dominance */}
            <div style={{ 
              background: 'var(--bg-slate-950)', 
              border: '1px solid var(--border-panel)', 
              borderRadius: '6px', 
              padding: '10px 12px' 
            }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)', marginBottom: '4px' }}>BTC Dominance</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-contrast)' }}>
                {data?.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---'}
              </div>
              <div style={{ fontSize: '0.6rem', marginTop: '2px', color: 'var(--text-slate-400)' }}>
                Market Structure
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Polymarket Whales Tracker */}
      <PolymarketWhales moduleId="dash_polymarket" fmt={fmt} />

      {/* L/S Ratio & OI Charts */}
      {(!isModuleHidden('dash_ls_chart') || !isModuleHidden('dash_oi_chart')) && (
        <div className="charts-row">
          {!isModuleHidden('dash_ls_chart') && (
            <div className="glass-panel chart-panel">
              <div className="chart-header">
                <h3 className="chart-title font-mono text-emerald">
                  <span className="dot dot-emerald" /> LONG/SHORT RATIO — 24H
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="chart-badge font-mono">
                    {currentLS ? parseFloat(currentLS.longShortRatio).toFixed(3) : '---'}
                  </span>
                  <ModuleMenu moduleId="dash_ls_chart" />
                </div>
              </div>
              <div className="chart-body">
                {data.lsHistory.length > 0
                  ? <Line data={lsChartData} options={getChartOpts(theme)} />
                  : <div className="chart-empty font-mono">Đang tải...</div>
                }
              </div>
            </div>
          )}

          {!isModuleHidden('dash_oi_chart') && (
            <div className="glass-panel chart-panel">
              <div className="chart-header">
                <h3 className="chart-title font-mono text-amber">
                  <span className="dot dot-amber" /> OPEN INTEREST — 24H (BTC)
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="chart-badge font-mono">
                    {data.openInterest ? `${(data.openInterest / 1000).toFixed(1)}K BTC` : '---'}
                  </span>
                  <ModuleMenu moduleId="dash_oi_chart" />
                </div>
              </div>
              <div className="chart-body">
                {data.oiHistory.length > 0
                  ? <Bar data={oiChartData} options={getChartOpts(theme)} />
                  : <div className="chart-empty font-mono">Đang tải...</div>
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* US Spot Bitcoin ETFs Row */}
      {(!isModuleHidden('dash_etf_holdings') || !isModuleHidden('dash_etf_flows')) && (
        <div className="whales-row">
          {/* Spot ETFs Holdings Panel */}
          {!isModuleHidden('dash_etf_holdings') && (
            <div className="glass-panel whale-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="chart-title font-mono text-emerald" style={{ margin: 0 }}>
                  <span className="dot dot-emerald" /> US SPOT BITCOIN ETFS (TOTAL: {fmt(etfHoldings.total, 0)} BTC)
                </h3>
                <ModuleMenu moduleId="dash_etf_holdings" />
              </div>
              <div className="etf-summary font-mono">
                <div className="etf-sum-card">
                  <span className="etf-sum-label">TOTAL AUM</span>
                  <span className="etf-sum-val text-emerald">${fmt((etfHoldings.total * (btcDisplay?.price || 60000)) / 1e9, 2)}B</span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">NET FLOWS (24H)</span>
                  <span className={`etf-sum-val ${etfHistory[etfHistory.length - 1]?.flow >= 0 ? 'text-emerald' : 'text-rose'}`}>
                    {etfHistory[etfHistory.length - 1]?.flow >= 0 ? '+' : ''}{etfHistory[etfHistory.length - 1]?.flow}M
                  </span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">% SUPPLY HELD</span>
                  <span className="etf-sum-val text-slate-300">
                    ~{((etfHoldings.total / (data.node?.circulatingSupply || 20039293.75)) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="etf-sum-card">
                  <span className="etf-sum-label">AUM TREND ({aumChangeStats.oldestDate} → NAY)</span>
                  <span className={`etf-sum-val ${aumChangeStats.direction === 'up' ? 'text-emerald' : aumChangeStats.direction === 'down' ? 'text-rose' : 'text-slate-300'}`}>
                    {aumChangeStats.direction === 'up' ? '▲' : aumChangeStats.direction === 'down' ? '▼' : ''} {Math.abs(aumChangeStats.diffPct).toFixed(1)}% 
                    <span style={{ fontSize: '0.55rem', marginLeft: '4px', fontWeight: 'normal', color: 'var(--text-slate-500)' }}>
                      ({aumChangeStats.diffUsd >= 0 ? '+' : ''}{aumChangeStats.diffUsd.toFixed(2)}B)
                    </span>
                  </span>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="whale-table font-mono" style={{ width: '100%', fontSize: '0.62rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>ETF FUND</th>
                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>HOLDINGS</th>
                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>VALUE</th>
                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>SHARE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etfHoldings.funds.map((e, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-panel)' }}>
                        <td style={{ padding: '8px 4px', color: 'var(--text-contrast)' }}>{e.name}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{e.holdings.toLocaleString()} BTC</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-contrast)' }}>${fmt((e.holdings * (btcDisplay?.price || 60000)) / 1e9, 2)}B</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-slate-400)' }}>{e.marketShare}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Spot ETFs Net Flow History Chart Panel */}
          {!isModuleHidden('dash_etf_flows') && (
            <div className="glass-panel whale-panel">
              <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="chart-title font-mono text-emerald" style={{ margin: 0 }}>
                  <span className="dot dot-emerald" /> {etfChartType === 'flows' ? 'LỊCH Sử DÒNG TIỀN RÒNG (NET FLOWS)' : 'XU HƯỚNG TỔNG TÀI SẢN (AUM TREND)'}
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {etfChartType === 'aum' && (
                    <div className="etf-timeframe-toggle font-mono">
                      {['30D', '90D', 'ALL'].map(tf => (
                        <button
                          key={tf}
                          onClick={() => setEtfAumTimeframe(tf)}
                          className={`toggle-btn ${etfAumTimeframe === tf ? 'active' : ''}`}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="etf-chart-toggle font-mono">
                    <button 
                      onClick={() => setEtfChartType('flows')} 
                      className={`toggle-btn ${etfChartType === 'flows' ? 'active' : ''}`}
                    >
                      DÒNG TIỀN
                    </button>
                    <button 
                      onClick={() => setEtfChartType('aum')} 
                      className={`toggle-btn ${etfChartType === 'aum' ? 'active' : ''}`}
                    >
                      XU HƯỚNG AUM
                    </button>
                  </div>
                  <ModuleMenu moduleId="dash_etf_flows" />
                </div>
              </div>
              <div className="chart-body" style={{ height: '220px' }}>
                {etfHistory.length > 0 ? (
                  etfChartType === 'flows' ? (
                    <Bar data={etfFlowChartData} options={etfFlowChartOpts} />
                  ) : (
                    <Line data={etfAumChartData} options={etfAumChartOpts} />
                  )
                ) : (
                  <div className="chart-empty font-mono">Đang tải biểu đồ...</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CME COT Table Row */}
      {!isModuleHidden('dash_cme_cot') && (
        <div className="fng-cot-row">
          <div className="glass-panel whale-panel" style={{ height: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="chart-title font-mono text-amber" style={{ margin: 0 }}>
                  <span className="dot dot-amber" /> CME BITCOIN FUTURES COT (AS OF {data.cotData?.date || 'N/A'})
              </h3>
              <ModuleMenu moduleId="dash_cme_cot" />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="whale-table font-mono" style={{ width: '100%', fontSize: '0.62rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}></th>
                    <th colSpan="3" style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Long</th>
                    <th colSpan="3" style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Short</th>
                    <th colSpan="3" style={{ textAlign: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Spread</th>
                  </tr>
                  <tr style={{ color: 'var(--text-contrast)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}></th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Positions</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Open Int</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}># Traders</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Positions</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Open Int</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}># Traders</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Positions</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}>Open Int</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid var(--border-panel)' }}># Traders</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Dealer Intermediary', key: 'dealerIntermediary' },
                    { label: 'Asset Manager/ Institutional', key: 'assetManager' },
                    { label: 'Leveraged Funds', key: 'leveragedFunds' },
                    { label: 'Other Reportables', key: 'otherReportables' },
                    { label: 'Nonreportable Positions', key: 'nonReportable' }
                  ].map(row => {
                    const rData = data.cotData?.[row.key];
                    if (!rData) return null;
                    
                    const renderCell = (pos, change) => {
                      if (pos == null) return '---';
                      if (pos === 0 && change === 0) return '0';
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <span>{pos.toLocaleString()}</span>
                          {change !== 0 && change != null && (
                            <span style={{ 
                              color: 'white', 
                              backgroundColor: change > 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)', 
                              padding: '1px 3px', 
                              borderRadius: '2px', 
                              fontSize: '0.55rem' 
                            }}>
                              {change > 0 ? '+' : ''}{change.toLocaleString()}
                            </span>
                          )}
                        </div>
                      );
                    };

                    return (
                      <tr key={row.key} style={{ borderBottom: '1px solid var(--border-panel)', backgroundColor: row.key === 'nonReportable' ? 'rgba(0,0,0,0.1)' : 'transparent' }}>
                        <td style={{ padding: '8px 4px', color: 'var(--text-contrast)', fontWeight: 'bold' }}>{row.label}</td>
                        
                        {/* Long */}
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{renderCell(rData.long, rData.longChange)}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{typeof rData.longOi === 'number' ? `${rData.longOi.toFixed(1)}%` : '---'}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{rData.longTraders != null ? rData.longTraders : '---'}</td>
                        
                        {/* Short */}
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{renderCell(rData.short, rData.shortChange)}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{typeof rData.shortOi === 'number' ? `${rData.shortOi.toFixed(1)}%` : '---'}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{rData.shortTraders != null ? rData.shortTraders : '---'}</td>
                        
                        {/* Spread */}
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{row.key !== 'nonReportable' ? renderCell(rData.spread, rData.spreadChange) : ''}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{row.key !== 'nonReportable' ? (typeof rData.spreadOi === 'number' ? `${rData.spreadOi.toFixed(1)}%` : '---') : ''}</td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>{row.key !== 'nonReportable' ? (rData.spreadTraders != null ? rData.spreadTraders : '---') : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="font-mono text-slate-500" style={{ fontSize: '0.52rem', marginTop: '10px', textAlign: 'right' }}>
              Open Interest: {data.cotData?.openInterest ? data.cotData.openInterest.toLocaleString() : '---'} contracts
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Fragment } from 'react';
import { motion } from 'framer-motion';
import Tooltip from './Tooltip';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import DataOriginBadge from './DataOriginBadge';

const isPlausibleCpiYoY = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= -20 && number <= 50;
};

export default function CascadeTab({
  data,
  fmt,
  fmtB,
  btcDisplay,
  fund,
  CASCADE_KEY_MAP,
  METRIC_METADATA,
}) {
  const { isModuleHidden } = useModuleVisibility();
  if (isModuleHidden('tab_cascade')) return null;

  return (
    <motion.div 
      className="cascade-layout"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="glass-panel panel-section">
        <div className="panel-top-bar">
          <div className="panel-title-group">
            <h3 className="chart-title" style={{ margin: 0 }}>
              Thác thanh khoản vĩ mô
            </h3>
            <DataOriginBadge origin="history" label="Lịch sử API" compact />
          </div>
          <ModuleMenu moduleId="tab_cascade" />
        </div>
        <p className="text-xs text-slate-400" style={{ lineHeight: 1.6, marginBottom: '18px' }}>
          Dòng tiền khởi nguồn từ FED và lưu chuyển qua các tầng tài sản theo thứ tự ưu tiên rủi ro.
        </p>

        <div className="cascade-flow">
          {[
            {
              tier: 'Tầng 0',
              label: 'Thượng nguồn vĩ mô',
              desc: 'FED & Chu kỳ kinh tế',
              status: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? 'Thắt chặt' : 'Nới lỏng') : 'Thắt chặt',
              statusColor: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? 'var(--color-rose-400)' : 'var(--color-emerald-400)') : 'var(--color-rose-400)',
              items: [
                { k: 'Economic Cycle Phase', v: data.fedFundsRate > 4.0 ? (isPlausibleCpiYoY(data.cpi) && data.cpi > 3.5 ? 'Thắt chặt tiền tệ' : 'Lãi suất cao / Quan sát') : (data.fedFundsRate < 2.5 ? 'Nới lỏng tiền tệ' : 'Tăng trưởng kinh tế'), note: '4 giai đoạn dòng tiền' },
                { k: 'Fed Funds Rate', v: data.fedFundsRate ? `${data.fedFundsRate}%` : '4.25–4.50%', note: 'Lãi suất điều hành' },
                { k: 'CPI Inflation YoY', v: isPlausibleCpiYoY(data.cpi) ? `${Number(data.cpi).toFixed(2)}%` : '---', note: 'Lạm phát so với cùng kỳ' },
                { k: 'Unemployment Rate', v: data.unrate ? `${data.unrate}%` : '---', note: 'Tỷ lệ thất nghiệp' },
                { k: 'M2 Supply (Billion $)', v: data.m2Supply ? `$${fmt(data.m2Supply, 0)}` : '---', note: 'Tổng cung tiền M2' },
                { k: 'US Net Liquidity (Billion $)', v: data.netLiquidity ? `$${fmt(data.netLiquidity, 0)}B` : '---', note: 'WALCL - TGA - RRP' },
              ],
              color: 'var(--color-tier-0)',
            },
            {
              tier: 'Tầng 1',
              label: 'Chi phí vốn & USD',
              desc: 'Van thanh khoản',
              status: data.dxy > 103 ? 'Thắt chặt' : 'Nới lỏng',
              statusColor: data.dxy > 103 ? 'var(--color-rose-400)' : 'var(--color-emerald-400)',
              items: [
                { k: 'DXY (Dollar Index)', v: data.dxy ? fmt(data.dxy, 2) : '---', note: 'Sức mạnh USD' },
                { k: '10Y Treasury Yield', v: data.tenYearYield ? `${data.tenYearYield}%` : '---', note: 'Lợi suất TP 10 năm' },
                { k: 'VIX Volatility', v: data.vix ? `${fmt(data.vix.price, 2)}` : '---', note: 'Chỉ số biến động' },
              ],
              color: 'var(--color-tier-1)',
            },
            {
              tier: 'Tầng 2',
              label: 'Tài sản rủi ro',
              desc: 'Dòng vốn Equity & Credit',
              status: data.sp500?.changePercent > 0 ? 'Mở rộng' : 'Thu hẹp',
              statusColor: data.sp500?.changePercent > 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)',
              items: [
                { k: 'S&P 500 Index', v: data.sp500 ? `${fmt(data.sp500.price, 2)} (${data.sp500.changePercent >= 0 ? '+' : ''}${data.sp500.changePercent.toFixed(2)}%)` : '---', note: 'Chứng khoán Mỹ' },
                { k: 'Nasdaq 100 Index', v: data.qqq ? `${fmt(data.qqq.price, 2)} (${data.qqq.changePercent >= 0 ? '+' : ''}${data.qqq.changePercent.toFixed(2)}%)` : '---', note: 'Cổ phiếu công nghệ' },
                { k: 'High Yield Credit', v: data.highYield ? `${data.highYield}%` : '---', note: 'Rủi ro tín dụng' },
              ],
              color: 'var(--color-tier-2)',
            },
            {
              tier: 'Tầng 3',
              label: 'Hạ nguồn Crypto',
              desc: 'On-chain & Phái sinh',
              status: btcDisplay?.change >= 0 ? 'Dòng tiền vào' : 'Dòng tiền ra',
              statusColor: btcDisplay?.change >= 0 ? 'var(--color-emerald-400)' : 'var(--color-rose-400)',
              items: [
                { k: 'Stablecoin Supply', v: data.stablecoins ? fmtB(data.stablecoins.total) : '---', note: 'Sức mua cơ sở' },
                { k: 'BTC Dominance', v: data.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---', note: 'Dòng vốn Altcoin' },
                { k: 'Funding Rate', v: fund != null ? `${(fund * 100).toFixed(4)}%` : '---', note: 'Lệch pha phái sinh' },
                { k: 'MVRV Ratio', v: data.onChainMetrics?.mvrv || '---', note: 'Định giá On-chain' },
              ],
              color: 'var(--color-tier-3)',
            },
          ].map((tier, idx) => (
            <Fragment key={idx}>
              <motion.div 
                className="cascade-tier" 
                style={{ '--tier-color': tier.color }}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.15, duration: 0.5 }}
              >
                <div className="cascade-tier-header">
                  <span className="cascade-tier-badge font-mono" style={{ color: tier.color, borderColor: tier.color }}>{tier.tier}</span>
                  <div className="cascade-tier-label font-mono" style={{ color: tier.color }}>{tier.label}</div>
                  <div className="cascade-tier-desc font-mono">{tier.desc}</div>
                  <div className="cascade-tier-status font-mono" style={{ color: tier.statusColor, border: `1px solid ${tier.statusColor}40`, background: `${tier.statusColor}10` }}>
                    {tier.status}
                  </div>
                </div>
                <div className="tree-nodes-row">
                  {tier.items.map((item, j) => {
                    const tooltipId = CASCADE_KEY_MAP[item.k];
                    const metadata = tooltipId ? METRIC_METADATA[tooltipId] : null;
                    return (
                      <div key={j} className="tree-node font-mono">
                        {metadata ? (
                          <Tooltip content={metadata}>
                            <span className="tree-node-key" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)' }}>
                              {item.k}
                            </span>
                          </Tooltip>
                        ) : (
                          <span className="tree-node-key">{item.k}</span>
                        )}
                        <span className="tree-node-val" style={{ color: 'var(--text-contrast)' }}>{item.v}</span>
                        <span className="tree-node-note">{item.note}</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
              {idx < 3 && (
                <motion.div 
                  className="cascade-arrow" 
                  style={{ color: tier.color }}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: '40px' }}
                  transition={{ delay: idx * 0.15 + 0.1, duration: 0.4 }}
                >
                  <div className="flow-line">
                    <div className="flow-dot"></div>
                  </div>
                </motion.div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

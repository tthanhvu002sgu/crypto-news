import React from 'react';
import { motion } from 'framer-motion';
import Tooltip from './Tooltip';

export default function CascadeTab({
  data,
  fmt,
  fmtB,
  btcDisplay,
  fund,
  CASCADE_KEY_MAP,
  METRIC_METADATA,
}) {
  return (
    <motion.div 
      className="cascade-layout"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="glass-panel panel-section">
        <div className="panel-header">
          <h3 className="panel-title font-mono text-emerald">
            [BƯỚC 3] THÁC THANH KHOẢN — SƠ ĐỒ LƯU CHUYỂN
          </h3>
        </div>
        <p className="text-xs text-slate-400 mb-6" style={{ lineHeight: 1.7, textAlign: 'center' }}>
          Tiền bắt đầu từ FED → chảy vào các thị trường theo thứ tự ưu tiên rủi ro. Sơ đồ minh họa phân bổ dòng tiền cơ sở.
        </p>

        <div className="cascade-flow">
          {[
            {
              tier: 'TIER 0',
              label: 'THƯỢNG NGUỒN VĨ MÔ',
              desc: 'FED & Chu kỳ kinh tế',
              status: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? '[🔴 RESTRICTIVE]' : '[🟢 ACCOMMODATIVE]') : '[🔴 RESTRICTIVE]',
              statusColor: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? '#f43f5e' : '#10b981') : '#f43f5e',
              items: [
                { k: 'Economic Cycle Phase', v: data.fedFundsRate > 4.0 ? (data.cpi > 3.5 ? 'Thắt chặt tiền tệ' : 'Lãi suất cao / Quan sát') : (data.fedFundsRate < 2.5 ? 'Nới lỏng tiền tệ' : 'Tăng trưởng kinh tế'), note: '4 Giai đoạn dòng tiền' },
                { k: 'Fed Funds Rate', v: data.fedFundsRate ? `${data.fedFundsRate}%` : '4.25–4.50%', note: 'Lãi suất điều hành' },
                { k: 'CPI Inflation', v: data.cpi ? data.cpi.toFixed(2) : '---', note: 'Chỉ số giá tiêu dùng' },
                { k: 'Unemployment Rate', v: data.unrate ? `${data.unrate}%` : '---', note: 'Tỷ lệ thất nghiệp' },
                { k: 'M2 Supply (Billion $)', v: data.m2Supply ? `$${fmt(data.m2Supply, 0)}` : '---', note: 'Tổng cung tiền M2' },
                { k: 'US Net Liquidity (Billion $)', v: data.netLiquidity ? `$${fmt(data.netLiquidity, 0)}B` : '---', note: 'WALCL - TGA - RRP' },
              ],
              color: '#6366f1',
            },
            {
              tier: 'TIER 1',
              label: 'CHI PHÍ VỐN & USD',
              desc: 'Khóa van thanh khoản',
              status: data.dxy > 103 ? '[🔴 TIGHTENING]' : '[🟢 EASING]',
              statusColor: data.dxy > 103 ? '#f43f5e' : '#10b981',
              items: [
                { k: 'DXY (Dollar Index)', v: data.dxy ? fmt(data.dxy, 2) : '---', note: 'Sức mạnh USD' },
                { k: '10Y Treasury Yield', v: data.tenYearYield ? `${data.tenYearYield}%` : '---', note: 'Lợi suất TP 10 năm' },
                { k: 'VIX Volatility', v: data.vix ? `${fmt(data.vix.price, 2)}` : '---', note: 'Chỉ số hoảng loạn' },
              ],
              color: '#f59e0b',
            },
            {
              tier: 'TIER 2',
              label: 'TÀI SẢN RỦI RO',
              desc: 'Dòng vốn Equity & Credit',
              status: data.sp500?.changePercent > 0 ? '[🟢 EXPANDING]' : '[🔴 CONTRACTING]',
              statusColor: data.sp500?.changePercent > 0 ? '#10b981' : '#f43f5e',
              items: [
                { k: 'S&P 500 Index', v: data.sp500 ? `${fmt(data.sp500.price, 2)} (${data.sp500.changePercent >= 0 ? '+' : ''}${data.sp500.changePercent.toFixed(2)}%)` : '---', note: 'Chứng khoán Mỹ' },
                { k: 'Nasdaq 100 Index', v: data.qqq ? `${fmt(data.qqq.price, 2)} (${data.qqq.changePercent >= 0 ? '+' : ''}${data.qqq.changePercent.toFixed(2)}%)` : '---', note: 'Cổ phiếu công nghệ' },
                { k: 'High Yield Credit', v: data.highYield ? `${data.highYield}%` : '---', note: 'Rủi ro vỡ nợ' },
              ],
              color: '#10b981',
            },
            {
              tier: 'TIER 3',
              label: 'HẠ NGUỒN CRYPTO',
              desc: 'On-chain & Phái sinh',
              status: btcDisplay?.change >= 0 ? '[🟢 INFLOW]' : '[🔴 OUTFLOW]',
              statusColor: btcDisplay?.change >= 0 ? '#10b981' : '#f43f5e',
              items: [
                { k: 'Stablecoin Supply', v: data.stablecoins ? fmtB(data.stablecoins.total) : '---', note: 'Sức mua cơ sở' },
                { k: 'BTC Dominance', v: data.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---', note: 'Dòng vốn Altcoin' },
                { k: 'Funding Rate', v: fund != null ? `${(fund * 100).toFixed(4)}%` : '---', note: 'Lệch pha phái sinh' },
                { k: 'MVRV Ratio', v: data.onChainMetrics?.mvrv || '---', note: 'Định giá On-chain' },
              ],
              color: '#f43f5e',
            },
          ].map((tier, idx) => (
            <React.Fragment key={idx}>
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
            </React.Fragment>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

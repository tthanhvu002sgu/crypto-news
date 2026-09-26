// Cấu hình toàn bộ ~21+ module trên hệ thống theo 5 phân hệ chiến lược
export const MODULES_CONFIG = {
  // Sidebar
  sidebar_derivatives: { id: 'sidebar_derivatives', label: 'Phái Sinh Realtime', category: 'Sidebar' },
  sidebar_macro: { id: 'sidebar_macro', label: 'Dữ Liệu Kinh Tế Mỹ (Hàng Tháng)', category: 'Sidebar' },
  sidebar_onchain: { id: 'sidebar_onchain', label: 'BTC Network (On-chain)', category: 'Sidebar' },

  // 1. Overview & Regime
  tab_overview: { id: 'tab_overview', label: 'Tab Overview & Regime', category: 'Overview & Regime' },
  dash_bias: { id: 'dash_bias', label: 'Market Bias Engine (Công Thức Bias Total)', category: 'Overview & Regime' },
  dash_macro: { id: 'dash_macro', label: 'Macro Pulse (DXY, VIX, 10Y, S&P 500)', category: 'Overview & Regime' },
  dash_calendar: { id: 'dash_calendar', label: 'Lịch Kinh Tế Vĩ Mô (7 Ngày Trong Tuần)', category: 'Overview & Regime' },
  tab_cascade: { id: 'tab_cascade', label: 'Thác Thanh Khoản — Sơ Đồ Lưu Chuyển', category: 'Overview & Regime' },
  dash_etf_holdings: { id: 'dash_etf_holdings', label: 'US Spot Bitcoin ETFs Holdings', category: 'Overview & Regime' },
  dash_etf_flows: { id: 'dash_etf_flows', label: 'Lịch Sử Dòng Tiền Ròng / AUM Trend', category: 'Overview & Regime' },
  dash_cme_cot: { id: 'dash_cme_cot', label: 'CME Bitcoin Futures COT', category: 'Overview & Regime' },
  dash_macro_valuator: { id: 'dash_macro_valuator', label: 'Macro Dashboard v2 — Valuator + PnL Matrix', category: 'Overview & Regime' },
  dash_news: { id: 'dash_news', label: 'Tin Tức Vĩ Mô & Thị Trường', category: 'Overview & Regime' },
  dash_polymarket: { id: 'dash_polymarket', label: 'Polymarket — Whale Tracker', category: 'Overview & Regime' },
  dash_btc_chart: { id: 'dash_btc_chart', label: 'BTC/USDT — Giá 48 Giờ Gần Nhất (1H)', category: 'Overview & Regime' },

  // 2. Order Flow & Vi Cấu Trúc
  tab_orderflow: { id: 'tab_orderflow', label: 'Tab Order Flow', category: 'Order Flow' },
  hft_capital_flow: { id: 'hft_capital_flow', label: 'Capital Flow In / Out (24H)', category: 'Order Flow' },
  hft_cvd: { id: 'hft_cvd', label: 'CVD & Order Flow (Spot vs Futures)', category: 'Order Flow' },
  dash_ls_chart: { id: 'dash_ls_chart', label: 'Long/Short Ratio — 24H', category: 'Order Flow' },
  dash_oi_chart: { id: 'dash_oi_chart', label: 'Open Interest — 24H (BTC)', category: 'Order Flow' },
  hft_move_tracker: { id: 'hft_move_tracker', label: 'Move Tracker (Futures + Spot)', category: 'Order Flow' },
  hft_advanced_chart: { id: 'hft_advanced_chart', label: 'Advanced Price Action: POC, Walls & Liquidations', category: 'Order Flow' },
  hft_heatmap: { id: 'hft_heatmap', label: 'Advanced Price Action: POC, Walls & Liquidations', category: 'Order Flow' },
  hft_whale_walls: { id: 'hft_whale_walls', label: 'Target Liquidity (Whale Walls)', category: 'Order Flow' },
  hft_target_liq: { id: 'hft_target_liq', label: 'Target Liquidity (Whale Walls)', category: 'Order Flow' },
  hft_orderbook: { id: 'hft_orderbook', label: 'Order Book Imbalance (OBI)', category: 'Order Flow' },
  hft_obi: { id: 'hft_obi', label: 'Order Book Imbalance', category: 'Order Flow' },
  hft_liquidations: { id: 'hft_liquidations', label: 'Live Whale Trades (> $100k)', category: 'Order Flow' },
  hft_whale_trades: { id: 'hft_whale_trades', label: 'Live Whale Trades', category: 'Order Flow' },

  // 4. AI Decision Lab
  tab_ailab: { id: 'tab_ailab', label: 'Tab AI Decision Lab', category: 'AI Decision Lab' },
  tab_summary: { id: 'tab_summary', label: 'AI Macro & HFT Summary Report', category: 'AI Decision Lab' },
  dash_trade_auditor: { id: 'dash_trade_auditor', label: 'Trade Plan Auditor (Kiểm Định Kế Hoạch)', category: 'AI Decision Lab' },

  // 5. System & Docs
  tab_system: { id: 'tab_system', label: 'Tab System & Docs', category: 'System & Docs' },
  tab_glossary: { id: 'tab_glossary', label: 'Cẩm Nang Thuật Ngữ & Định Nghĩa', category: 'System & Docs' },
  tab_terminal: { id: 'tab_terminal', label: 'Sovereign Crawler — Activity Log', category: 'System & Docs' }
};

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Cấu hình toàn bộ ~21 module trên hệ thống
export const MODULES_CONFIG = {
  // Sidebar
  sidebar_derivatives: { id: 'sidebar_derivatives', label: 'Phái Sinh Realtime', category: 'Sidebar' },
  sidebar_macro: { id: 'sidebar_macro', label: 'Dữ Liệu Kinh Tế Mỹ (Hàng Tháng)', category: 'Sidebar' },
  sidebar_onchain: { id: 'sidebar_onchain', label: 'BTC Network (On-chain)', category: 'Sidebar' },
  
  // Dashboard Tab
  dash_bias: { id: 'dash_bias', label: 'Market Bias Engine (Công Thức Bias Total)', category: 'Dashboard' },
  dash_news: { id: 'dash_news', label: 'Tin Tức Vĩ Mô & Thị Trường', category: 'Dashboard' },
  dash_calendar: { id: 'dash_calendar', label: 'Lịch Kinh Tế Vĩ Mô (7 Ngày Trong Tuần)', category: 'Dashboard' },
  dash_polymarket: { id: 'dash_polymarket', label: 'Polymarket — Whale Tracker', category: 'Dashboard' },
  dash_btc_chart: { id: 'dash_btc_chart', label: 'BTC/USDT — Giá 48 Giờ Gần Nhất (1H)', category: 'Dashboard' },
  dash_ls_chart: { id: 'dash_ls_chart', label: 'Long/Short Ratio — 24H', category: 'Dashboard' },
  dash_oi_chart: { id: 'dash_oi_chart', label: 'Open Interest — 24H (BTC)', category: 'Dashboard' },
  dash_etf_holdings: { id: 'dash_etf_holdings', label: 'US Spot Bitcoin ETFs Holdings', category: 'Dashboard' },
  dash_etf_flows: { id: 'dash_etf_flows', label: 'Lịch Sử Dòng Tiền Ròng / AUM Trend', category: 'Dashboard' },
  dash_cme_cot: { id: 'dash_cme_cot', label: 'CME Bitcoin Futures COT', category: 'Dashboard' },

  // Data / HFT Radar Tab
  hft_cvd: { id: 'hft_cvd', label: 'CVD & Order Flow', category: 'Data (HFT)' },
  hft_target_liq: { id: 'hft_target_liq', label: 'Target Liquidity (Whale Walls)', category: 'Data (HFT)' },
  hft_obi: { id: 'hft_obi', label: 'Order Book Imbalance', category: 'Data (HFT)' },
  hft_advanced_chart: { id: 'hft_advanced_chart', label: 'Advanced Price Action: POC & Walls', category: 'Data (HFT)' },
  hft_whale_trades: { id: 'hft_whale_trades', label: 'Live Whale Trades', category: 'Data (HFT)' },
  hft_move_tracker: { id: 'hft_move_tracker', label: 'Move Tracker (Futures + Spot)', category: 'Data (HFT)' },

  // Thác Thanh Khoản Tab
  tab_cascade: { id: 'tab_cascade', label: 'Thác Thanh Khoản — Sơ Đồ Lưu Chuyển', category: 'Thác Thanh Khoản' },

  // AI Summary Tab
  tab_summary: { id: 'tab_summary', label: 'AI Macro & HFT Summary', category: 'AI Summary' },

  // Glossary Tab
  tab_glossary: { id: 'tab_glossary', label: 'Cẩm Nang Thuật Ngữ & Định Nghĩa', category: 'Thuật Ngữ' },

  // Terminal Logs Tab
  tab_terminal: { id: 'tab_terminal', label: 'Sovereign Crawler — Activity Log', category: 'Terminal Logs' }
};

const STORAGE_KEY = 'app-hidden-modules';

const ModuleVisibilityContext = createContext();

export function ModuleVisibilityProvider({ children }) {
  const [hiddenModules, setHiddenModules] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error loading hidden modules from localStorage:', e);
      return [];
    }
  });

  const saveToStorage = (list) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Error saving hidden modules to localStorage:', e);
    }
  };

  const hideModule = useCallback((id) => {
    setHiddenModules((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveToStorage(next);
      return next;
    });
  }, []);

  const showModule = useCallback((id) => {
    setHiddenModules((prev) => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter((mId) => mId !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  const showAllModules = useCallback(() => {
    setHiddenModules([]);
    saveToStorage([]);
  }, []);

  const isModuleHidden = useCallback((id) => {
    return hiddenModules.includes(id);
  }, [hiddenModules]);

  const value = {
    hiddenModules,
    hideModule,
    showModule,
    showAllModules,
    isModuleHidden,
    MODULES_CONFIG,
  };

  return (
    <ModuleVisibilityContext.Provider value={value}>
      {children}
    </ModuleVisibilityContext.Provider>
  );
}

export function useModuleVisibility() {
  const context = useContext(ModuleVisibilityContext);
  if (!context) {
    throw new Error('useModuleVisibility must be used within a ModuleVisibilityProvider');
  }
  return context;
}

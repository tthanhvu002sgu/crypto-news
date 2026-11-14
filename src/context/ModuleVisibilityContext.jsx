import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { MODULES_CONFIG } from '../config/modulesConfig';

export { MODULES_CONFIG };

const STORAGE_KEY = 'app-hidden-modules';
const ORDER_STORAGE_KEY = 'app-module-orders';

export const DEFAULT_MODULE_ORDERS = {
  sidebar: ['sidebar_derivatives', 'sidebar_macro', 'sidebar_onchain'],
  dash_sec1: ['dash_macro', 'dash_correlation_matrix', 'dash_calendar', 'tab_cascade'],
  dash_sec2: ['dash_etf_pair', 'dash_cme_cot', 'dash_macro_valuator'],
  dash_etf_pair: ['dash_etf_holdings', 'dash_etf_flows'],
  dash_sec3: ['dash_news', 'dash_polymarket'],
  hft_main: [
    'hft_capital_flow',
    'hft_cvd',
    'hft_spot_pressure',
    'hft_ls_oi_pair',
    'hft_move_tracker',
    'hft_heatmap_whale_pair',
    'hft_orderbook',
    'hft_multi_funding',
    'hft_liquidations',
  ],
  hft_ls_oi_pair: ['dash_ls_chart', 'dash_oi_chart'],
};

const HORIZONTAL_GROUPS = new Set(['dash_etf_pair', 'hft_ls_oi_pair']);

const MODULE_GROUP_ALIASES = {
  hft_heatmap: { groupKey: 'hft_main', itemId: 'hft_heatmap_whale_pair' },
};

function mergeOrdersWithDefaults(saved) {
  const merged = {};
  for (const [groupKey, defaultList] of Object.entries(DEFAULT_MODULE_ORDERS)) {
    const savedList = Array.isArray(saved?.[groupKey]) ? saved[groupKey] : [];
    const validSaved = savedList.filter((id) => defaultList.includes(id));
    const missing = defaultList.filter((id) => !validSaved.includes(id));
    merged[groupKey] = [...validSaved, ...missing];
  }
  return merged;
}

export function getGroupForModule(moduleId) {
  if (!moduleId) return null;
  if (MODULE_GROUP_ALIASES[moduleId]) {
    const { groupKey, itemId } = MODULE_GROUP_ALIASES[moduleId];
    return { groupKey, itemId, isHorizontal: HORIZONTAL_GROUPS.has(groupKey) };
  }
  for (const [groupKey, list] of Object.entries(DEFAULT_MODULE_ORDERS)) {
    if (list.includes(moduleId)) {
      return { groupKey, itemId: moduleId, isHorizontal: HORIZONTAL_GROUPS.has(groupKey) };
    }
  }
  return null;
}

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

  const [moduleOrders, setModuleOrders] = useState(() => {
    try {
      const saved = localStorage.getItem(ORDER_STORAGE_KEY);
      return mergeOrdersWithDefaults(saved ? JSON.parse(saved) : null);
    } catch (e) {
      console.error('Error loading module orders from localStorage:', e);
      return mergeOrdersWithDefaults(null);
    }
  });

  const [isEditLayoutMode, setIsEditLayoutMode] = useState(false);

  const saveToStorage = (list) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Error saving hidden modules to localStorage:', e);
    }
  };

  const saveOrdersToStorage = (orders) => {
    try {
      localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(orders));
    } catch (e) {
      console.error('Error saving module orders to localStorage:', e);
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

  const toggleEditLayoutMode = useCallback(() => {
    setIsEditLayoutMode((prev) => !prev);
  }, []);

  const getGroupOrder = useCallback((groupKey) => {
    return moduleOrders[groupKey] || DEFAULT_MODULE_ORDERS[groupKey] || [];
  }, [moduleOrders]);

  const moveModule = useCallback((groupKey, itemId, direction) => {
    setModuleOrders((prev) => {
      const current = prev[groupKey] || DEFAULT_MODULE_ORDERS[groupKey];
      if (!current) return prev;
      const idx = current.indexOf(itemId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' || direction === 'left' || direction === -1 ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= current.length) return prev;
      const nextList = [...current];
      [nextList[idx], nextList[targetIdx]] = [nextList[targetIdx], nextList[idx]];
      const next = { ...prev, [groupKey]: nextList };
      saveOrdersToStorage(next);
      return next;
    });
  }, []);

  const reorderModule = useCallback((groupKey, sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    setModuleOrders((prev) => {
      const current = prev[groupKey] || DEFAULT_MODULE_ORDERS[groupKey];
      if (!current) return prev;
      const fromIdx = current.indexOf(sourceId);
      const toIdx = current.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const nextList = [...current];
      const [moved] = nextList.splice(fromIdx, 1);
      nextList.splice(toIdx, 0, moved);
      const next = { ...prev, [groupKey]: nextList };
      saveOrdersToStorage(next);
      return next;
    });
  }, []);

  const resetModuleOrders = useCallback(() => {
    const defaults = mergeOrdersWithDefaults(null);
    setModuleOrders(defaults);
    try {
      localStorage.removeItem(ORDER_STORAGE_KEY);
    } catch (e) {
      console.error('Error removing module orders from localStorage:', e);
    }
  }, []);

  const hasCustomOrder = useMemo(() => {
    return Object.entries(DEFAULT_MODULE_ORDERS).some(([groupKey, defaultList]) => {
      const current = moduleOrders[groupKey] || defaultList;
      return current.length !== defaultList.length || current.some((id, idx) => id !== defaultList[idx]);
    });
  }, [moduleOrders]);

  const value = {
    hiddenModules,
    hideModule,
    showModule,
    showAllModules,
    isModuleHidden,
    MODULES_CONFIG,
    moduleOrders,
    isEditLayoutMode,
    setIsEditLayoutMode,
    toggleEditLayoutMode,
    getGroupOrder,
    moveModule,
    reorderModule,
    resetModuleOrders,
    hasCustomOrder,
    getGroupForModule,
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

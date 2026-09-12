import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { MODULES_CONFIG } from '../config/modulesConfig';

export { MODULES_CONFIG };

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

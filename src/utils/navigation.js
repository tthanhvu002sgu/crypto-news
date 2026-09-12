/**
 * Navigation configuration, route normalization & backward compatibility helpers.
 */

export const TAB_REDIRECT_MAP = {
  dashboard: 'overview',
  data: 'orderflow',
  hft: 'orderflow',
  cascade: 'overview',
  summary: 'ailab',
  glossary: 'system',
  terminal: 'system',
};

export const DEFAULT_TAB_ORDER = ['overview', 'orderflow', 'scanner', 'ailab', 'system'];

export const TARGET_TAB_IDS = Object.freeze([...DEFAULT_TAB_ORDER]);

/**
 * Normalizes any route hash or legacy tab ID into one of the 5 canonical target tabs.
 * @param {string} tabId
 * @returns {'overview' | 'orderflow' | 'scanner' | 'ailab' | 'system'}
 */
export function normalizeTabId(tabId) {
  if (!tabId) return 'overview';
  const clean = String(tabId).toLowerCase().trim().replace(/^#+/, '').trim();
  if (DEFAULT_TAB_ORDER.includes(clean)) return clean;
  if (TAB_REDIRECT_MAP[clean]) return TAB_REDIRECT_MAP[clean];
  return 'overview';
}

/**
 * Migrates a previously saved tabOrder array from localStorage:
 * - Maps legacy tab IDs to their new homes
 * - Removes invalid or duplicate IDs
 * - Ensures all 5 canonical tabs exist in the returned array
 * @param {any} savedArray
 * @returns {string[]}
 */
export function migrateSavedTabOrder(savedArray) {
  if (!Array.isArray(savedArray) || savedArray.length === 0) {
    return DEFAULT_TAB_ORDER;
  }
  const mapped = savedArray
    .map(id => (typeof id === 'string' ? (TAB_REDIRECT_MAP[id.toLowerCase()] || id.toLowerCase()) : ''))
    .filter(id => DEFAULT_TAB_ORDER.includes(id));
  
  const unique = [...new Set(mapped)];
  return [
    ...unique,
    ...DEFAULT_TAB_ORDER.filter(id => !unique.includes(id))
  ];
}

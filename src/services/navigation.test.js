import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TAB_ORDER,
  TARGET_TAB_IDS,
  normalizeTabId,
  migrateSavedTabOrder,
} from '../utils/navigation.js';
import { MODULES_CONFIG } from '../config/modulesConfig.js';

describe('Navigation Architecture & Migration Utilities', () => {
  it('defines the 5 strategic target workspaces', () => {
    assert.deepEqual(DEFAULT_TAB_ORDER, ['overview', 'orderflow', 'scanner', 'ailab', 'system']);
    assert.deepEqual(TARGET_TAB_IDS, ['overview', 'orderflow', 'scanner', 'ailab', 'system']);
  });

  it('normalizes target tab IDs unchanged', () => {
    assert.equal(normalizeTabId('overview'), 'overview');
    assert.equal(normalizeTabId('orderflow'), 'orderflow');
    assert.equal(normalizeTabId('scanner'), 'scanner');
    assert.equal(normalizeTabId('ailab'), 'ailab');
    assert.equal(normalizeTabId('system'), 'system');
  });

  it('handles URL hash prefixes correctly', () => {
    assert.equal(normalizeTabId('#overview'), 'overview');
    assert.equal(normalizeTabId('#dashboard'), 'overview');
    assert.equal(normalizeTabId('#hft'), 'orderflow');
    assert.equal(normalizeTabId('#data'), 'orderflow');
    assert.equal(normalizeTabId('#cascade'), 'overview');
    assert.equal(normalizeTabId('#summary'), 'ailab');
    assert.equal(normalizeTabId('#glossary'), 'system');
    assert.equal(normalizeTabId('#terminal'), 'system');
  });

  it('accurately redirects all legacy tab IDs', () => {
    assert.equal(normalizeTabId('dashboard'), 'overview');
    assert.equal(normalizeTabId('hft'), 'orderflow');
    assert.equal(normalizeTabId('data'), 'orderflow');
    assert.equal(normalizeTabId('cascade'), 'overview');
    assert.equal(normalizeTabId('summary'), 'ailab');
    assert.equal(normalizeTabId('glossary'), 'system');
    assert.equal(normalizeTabId('terminal'), 'system');
  });

  it('falls back to overview on unknown or empty input', () => {
    assert.equal(normalizeTabId(''), 'overview');
    assert.equal(normalizeTabId(null), 'overview');
    assert.equal(normalizeTabId(undefined), 'overview');
    assert.equal(normalizeTabId('unknown-route'), 'overview');
  });

  it('migrates legacy 7-tab order to canonical 5-tab order without duplicates', () => {
    const legacyOrder = ['dashboard', 'scanner', 'hft', 'cascade', 'summary', 'glossary', 'terminal'];
    const migrated = migrateSavedTabOrder(legacyOrder);
    
    // Expected: dashboard -> overview, scanner -> scanner, hft -> orderflow,
    // cascade -> overview (duplicate skipped), summary -> ailab,
    // glossary -> system, terminal -> system (duplicate skipped)
    assert.deepEqual(migrated, ['overview', 'scanner', 'orderflow', 'ailab', 'system']);
  });

  it('preserves customized ordering of migrated tabs', () => {
    const customUserOrder = ['hft', 'scanner', 'dashboard'];
    const migrated = migrateSavedTabOrder(customUserOrder);
    
    // hft -> orderflow, scanner -> scanner, dashboard -> overview
    // then ailab and system appended
    assert.deepEqual(migrated, ['orderflow', 'scanner', 'overview', 'ailab', 'system']);
  });

  it('handles corrupt or non-array saved data safely', () => {
    assert.deepEqual(migrateSavedTabOrder(null), DEFAULT_TAB_ORDER);
    assert.deepEqual(migrateSavedTabOrder([]), DEFAULT_TAB_ORDER);
    assert.deepEqual(migrateSavedTabOrder('invalid'), DEFAULT_TAB_ORDER);
  });

  it('MODULES_CONFIG preserves all required module keys and classifies categories cleanly', () => {
    const requiredKeys = [
      'dash_bias', 'dash_macro_valuator', 'dash_news', 'dash_calendar', 'dash_polymarket',
      'dash_etf_holdings', 'dash_etf_flows', 'dash_cme_cot',
      'tab_cascade',
      'hft_capital_flow', 'hft_cvd', 'dash_ls_chart', 'dash_oi_chart', 'hft_move_tracker',
      'hft_advanced_chart', 'hft_heatmap', 'hft_whale_walls', 'hft_orderbook', 'hft_liquidations',
      'tab_summary', 'dash_trade_auditor',
      'tab_glossary', 'tab_terminal'
    ];

    for (const key of requiredKeys) {
      assert.ok(MODULES_CONFIG[key], `Missing module key in MODULES_CONFIG: ${key}`);
      assert.ok(MODULES_CONFIG[key].category, `Missing category for module: ${key}`);
    }

    // Verify L/S and OI charts belong to Order Flow category
    assert.equal(MODULES_CONFIG.dash_ls_chart.category, 'Order Flow');
    assert.equal(MODULES_CONFIG.dash_oi_chart.category, 'Order Flow');

    // Verify Trade Plan Auditor belongs to AI Decision Lab
    assert.equal(MODULES_CONFIG.dash_trade_auditor.category, 'AI Decision Lab');

    // Verify Cascade belongs to Overview & Regime
    assert.equal(MODULES_CONFIG.tab_cascade.category, 'Overview & Regime');
  });

  it('handles uppercase, trailing spaces, and redundant hash symbols gracefully', () => {
    assert.equal(normalizeTabId('  #DASHBOARD  '), 'overview');
    assert.equal(normalizeTabId('ORDERFLOW'), 'orderflow');
    assert.equal(normalizeTabId('  #HFT  '), 'orderflow');
    assert.equal(normalizeTabId('SUMMARY'), 'ailab');
    assert.equal(normalizeTabId('##terminal'), 'system');
  });

  it('preserves all 5 canonical workspaces when migrating minimal or partial lists', () => {
    const singleTab = ['ailab'];
    const result = migrateSavedTabOrder(singleTab);
    assert.equal(result.length, 5);
    assert.equal(result[0], 'ailab');
    for (const canonical of DEFAULT_TAB_ORDER) {
      assert.ok(result.includes(canonical));
    }
  });
});

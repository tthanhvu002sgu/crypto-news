import { useState } from 'react';
import { BookOpen, Terminal, Settings, FileSpreadsheet, Layers, EyeOff, RefreshCw } from 'lucide-react';
import GlossaryTab from './GlossaryTab';
import TerminalTab from './TerminalTab';

export default function SystemDocsTab({
  // Terminal Tab props
  data,
  btcDisplay,
  wsStatus,
  fundInfo,
  fund,
  fmt,
  fngColor,
  theme,

  // Settings & Sync props
  apiKeys,
  setApiKeys,
  onSaveApiKeys,
  syncData,
  isSyncing,
  handleSyncGoogleSheet,
  isSyncingSheet,

  // Tab ordering props
  tabOrder,
  moveTab,
  resetTabOrder,
  NAV_TABS_CONFIG,

  // Module visibility props
  hiddenModules,
  showModule,
  showAllModules,
  MODULES_CONFIG,
}) {
  const [activeSubtab, setActiveSubtab] = useState('glossary');

  const subtabs = [
    { id: 'glossary', label: 'CẨM NANG THUẬT NGỮ', icon: <BookOpen size={14} /> },
    { id: 'crawler',  label: 'CRAWLER ACTIVITY LOGS', icon: <Terminal size={14} /> },
    { id: 'settings', label: 'CÀI ĐẶT & TÍCH HỢP', icon: <Settings size={14} /> },
  ];

  return (
    <div className="system-docs-layout" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Subnav toolbar */}
      <div className="system-subnav glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {subtabs.map(st => (
            <button
              key={st.id}
              type="button"
              className={`category-btn font-mono ${activeSubtab === st.id ? 'active' : ''}`}
              onClick={() => setActiveSubtab(st.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {st.icon}
              <span>{st.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Subtab 1: Glossary */}
      {activeSubtab === 'glossary' && (
        hiddenModules?.includes('tab_glossary') ? (
          <div className="glass-panel text-slate-500 font-mono" style={{ padding: '40px 20px', textAlign: 'center', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem' }}>Cẩm nang thuật ngữ hiện đang bị ẩn.</p>
            <button
              type="button"
              onClick={() => showModule && showModule('tab_glossary')}
              className="text-emerald"
              style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem' }}
            >
              Hiện lại Cẩm Nang Thuật Ngữ
            </button>
          </div>
        ) : (
          <GlossaryTab />
        )
      )}

      {/* Subtab 2: Terminal Crawler Logs */}
      {activeSubtab === 'crawler' && (
        hiddenModules?.includes('tab_terminal') ? (
          <div className="glass-panel text-slate-500 font-mono" style={{ padding: '40px 20px', textAlign: 'center', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem' }}>Crawler Activity Log hiện đang bị ẩn.</p>
            <button
              type="button"
              onClick={() => showModule && showModule('tab_terminal')}
              className="text-emerald"
              style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem' }}
            >
              Hiện lại Crawler Activity Log
            </button>
          </div>
        ) : (
          <TerminalTab
            data={data}
            btcDisplay={btcDisplay}
            wsStatus={wsStatus}
            fundInfo={fundInfo}
            fund={fund}
            fmt={fmt}
            fngColor={fngColor}
            theme={theme}
          />
        )
      )}

      {/* Subtab 3: System Settings & Integrations */}
      {activeSubtab === 'settings' && (
        <div className="glass-panel panel-section font-mono" style={{ padding: '20px 24px' }}>
          <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 className="panel-title text-emerald font-mono" style={{ margin: 0, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={16} /> CẤU HÌNH KHÓA API, XUẤT DỮ LIỆU &amp; HỆ THỐNG
            </h3>
          </div>

          <p className="text-slate-400" style={{ fontSize: '0.68rem', margin: '0 0 16px', lineHeight: 1.5 }}>
            Quản lý các khóa API cá nhân, webhook Google Sheets phục vụ xuất dữ liệu định kỳ cho AI đọc, sắp xếp vị trí các Tab phân hệ và quản lý các module đã ẩn.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {/* FRED */}
            <div className="settings-modal-input-group">
              <label className="text-slate-400" style={{ fontSize: '0.6rem', fontWeight: 600 }}>FRED API KEY</label>
              <input
                type="text"
                className="settings-modal-input"
                placeholder="Nhập FRED API key..."
                value={apiKeys?.fred || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, fred: e.target.value }))}
              />
              <span className="text-slate-500" style={{ fontSize: '0.55rem' }}>
                Lấy miễn phí tại: <a href="https://fred.stlouisfed.org/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>fred.stlouisfed.org</a>
              </span>
            </div>

            {/* Alpha Vantage */}
            <div className="settings-modal-input-group">
              <label className="text-slate-400" style={{ fontSize: '0.6rem', fontWeight: 600 }}>ALPHA VANTAGE API KEY</label>
              <input
                type="text"
                className="settings-modal-input"
                placeholder="Nhập Alpha Vantage key..."
                value={apiKeys?.alphaVantage || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, alphaVantage: e.target.value }))}
              />
              <span className="text-slate-500" style={{ fontSize: '0.55rem' }}>
                Lấy miễn phí tại: <a href="https://www.alphavantage.co/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>alphavantage.co</a>
              </span>
            </div>

            {/* Gemini */}
            <div className="settings-modal-input-group">
              <label className="text-slate-400" style={{ fontSize: '0.6rem', fontWeight: 600 }}>GEMINI API KEY (GOOGLE AI STUDIO)</label>
              <input
                type="password"
                className="settings-modal-input"
                placeholder="AIzaSy..."
                value={apiKeys?.gemini || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, gemini: e.target.value }))}
              />
              <span className="text-slate-500" style={{ fontSize: '0.55rem' }}>
                Lấy miễn phí tại: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>aistudio.google.com</a>
              </span>
            </div>

            {/* OpenRouter */}
            <div className="settings-modal-input-group">
              <label className="text-slate-400" style={{ fontSize: '0.6rem', fontWeight: 600 }}>OPENROUTER API KEY</label>
              <input
                type="password"
                className="settings-modal-input"
                placeholder="sk-or-v1-..."
                value={apiKeys?.openrouter || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, openrouter: e.target.value }))}
              />
              <span className="text-slate-500" style={{ fontSize: '0.55rem' }}>
                Lấy miễn phí tại: <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>openrouter.ai/keys</a>
              </span>
            </div>
          </div>

          {/* Google Sheets Webhook Section */}
          <div style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <label className="text-slate-300" style={{ fontSize: '0.68rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileSpreadsheet size={14} style={{ color: '#38bdf8' }} />
                GOOGLE SHEETS WEBHOOK URL (SYNC 3 PHIÊN Á / ÂU / MỸ)
              </label>
              {handleSyncGoogleSheet && (
                <button
                  type="button"
                  className="btn-sync font-mono"
                  onClick={handleSyncGoogleSheet}
                  disabled={isSyncingSheet}
                  style={{ height: '30px', padding: '0 14px', fontSize: '0.65rem', borderColor: 'rgba(56, 189, 248, 0.4)', color: 'var(--color-sky-400, #38bdf8)' }}
                >
                  <FileSpreadsheet size={13} className={isSyncingSheet ? 'spinning' : ''} />
                  {isSyncingSheet ? 'ĐANG XUẤT SHEETS...' : 'XUẤT GOOGLE SHEETS NGAY'}
                </button>
              )}
            </div>
            <input
              type="text"
              className="settings-modal-input"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={apiKeys?.googleSheetsWebhook || ''}
              onChange={(e) => setApiKeys(p => ({ ...p, googleSheetsWebhook: e.target.value }))}
              style={{ marginBottom: '6px' }}
            />
            <span className="text-slate-500" style={{ fontSize: '0.58rem' }}>
              URL Web App Google Apps Script nhận dữ liệu tổng hợp đa chiều từ Terminal, tự động cập nhật để AI đọc phân tích.
            </span>
          </div>

          {/* Action Save */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <button
              type="button"
              className="btn-sync font-mono"
              onClick={onSaveApiKeys}
              style={{ flex: 1, justifyContent: 'center', height: '36px', cursor: 'pointer', fontSize: '0.72rem' }}
            >
              LƯU CẤU HÌNH &amp; ĐỒNG BỘ DỮ LIỆU
            </button>
            <button
              type="button"
              className="btn-sync font-mono"
              onClick={() => syncData && syncData(true, ['hot', 'warm', 'cold'])}
              disabled={isSyncing}
              style={{ padding: '0 16px', height: '36px', cursor: 'pointer', fontSize: '0.72rem' }}
            >
              <RefreshCw size={13} className={isSyncing ? 'spinning' : ''} />
              {isSyncing ? 'ĐANG ĐỒNG BỘ...' : 'SYNC DỮ LIỆU'}
            </button>
          </div>

          {/* Tab Reordering & Hidden Modules Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Tab Reordering */}
            <div className="settings-modal-section" style={{ background: 'var(--bg-slate-950)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 className="text-slate-300" style={{ margin: 0, fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Layers size={13} className="text-emerald" /> SẮP XẾP VỊ TRÍ TABS MENU
                </h4>
                {resetTabOrder && (
                  <button
                    type="button"
                    onClick={resetTabOrder}
                    className="text-slate-400"
                    style={{ background: 'transparent', border: '1px solid var(--border-panel)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.52rem', cursor: 'pointer' }}
                  >
                    Reset Mặc Định
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tabOrder?.map((id, index) => {
                  const tabMeta = NAV_TABS_CONFIG?.find(t => t.id === id);
                  if (!tabMeta) return null;
                  return (
                    <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: '4px', border: '1px solid var(--border-panel)' }}>
                      <span className="text-contrast" style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {tabMeta.icon} {tabMeta.label}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveTab && moveTab(id, 'left')}
                          style={{ background: 'var(--bg-slate-900)', border: '1px solid var(--border-panel)', color: index === 0 ? 'var(--text-slate-600)' : 'var(--text-contrast)', padding: '2px 8px', borderRadius: '4px', cursor: index === 0 ? 'not-allowed' : 'pointer', fontSize: '0.65rem' }}
                        >
                          ◄
                        </button>
                        <button
                          type="button"
                          disabled={index === tabOrder.length - 1}
                          onClick={() => moveTab && moveTab(id, 'right')}
                          style={{ background: 'var(--bg-slate-900)', border: '1px solid var(--border-panel)', color: index === tabOrder.length - 1 ? 'var(--text-slate-600)' : 'var(--text-contrast)', padding: '2px 8px', borderRadius: '4px', cursor: index === tabOrder.length - 1 ? 'not-allowed' : 'pointer', fontSize: '0.65rem' }}
                        >
                          ►
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hidden Modules */}
            <div className="settings-modal-section" style={{ background: 'var(--bg-slate-950)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 className="text-slate-300" style={{ margin: 0, fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <EyeOff size={13} className="text-emerald" /> QUẢN LÝ MODULE ĐÃ ẨN
                </h4>
                {hiddenModules && hiddenModules.length > 1 && (
                  <button
                    type="button"
                    onClick={showAllModules}
                    className="text-emerald"
                    style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.52rem', cursor: 'pointer' }}
                  >
                    Hiển thị tất cả ({hiddenModules.length})
                  </button>
                )}
              </div>

              {(!hiddenModules || hiddenModules.length === 0) ? (
                <div className="text-slate-500" style={{ fontSize: '0.6rem', padding: '14px', textAlign: 'center', border: '1px dashed var(--border-panel)', borderRadius: '4px' }}>
                  ✓ Không có module nào đang bị ẩn.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                  {hiddenModules.map(id => {
                    const meta = (MODULES_CONFIG && MODULES_CONFIG[id]) || { label: id, category: 'Khác' };
                    return (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-card)', borderRadius: '4px', border: '1px solid var(--border-panel)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span className="text-contrast" style={{ fontSize: '0.62rem', fontWeight: 600 }}>{meta.label}</span>
                          <span className="text-slate-500" style={{ fontSize: '0.5rem' }}>[{meta.category}]</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => showModule && showModule(id)}
                          className="text-emerald"
                          style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.55rem', cursor: 'pointer' }}
                        >
                          Hiện lại
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

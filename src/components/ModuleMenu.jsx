import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, EyeOff, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';

export default function ModuleMenu({ moduleId, className = "", style = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const { hideModule, getGroupForModule, getGroupOrder, moveModule } = useModuleVisibility();

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!moduleId) return null;

  const groupInfo = getGroupForModule(moduleId);
  const order = groupInfo ? getGroupOrder(groupInfo.groupKey) : [];
  const idx = groupInfo ? order.indexOf(groupInfo.itemId) : -1;
  const canMovePrev = idx > 0;
  const canMoveNext = idx !== -1 && idx < order.length - 1;

  const parentPairMap = {
    dash_etf_pair: { groupKey: 'dash_sec2', itemId: 'dash_etf_pair', label: 'Cụm ETF' },
    hft_ls_oi_pair: { groupKey: 'hft_main', itemId: 'hft_ls_oi_pair', label: 'Cụm L/S & OI' },
  };
  const parentInfo = groupInfo ? parentPairMap[groupInfo.groupKey] : null;
  const parentOrder = parentInfo ? getGroupOrder(parentInfo.groupKey) : [];
  const parentIdx = parentInfo ? parentOrder.indexOf(parentInfo.itemId) : -1;
  const canParentUp = parentIdx > 0;
  const canParentDown = parentIdx !== -1 && parentIdx < parentOrder.length - 1;

  const PrevIcon = groupInfo?.isHorizontal ? ArrowLeft : ArrowUp;
  const NextIcon = groupInfo?.isHorizontal ? ArrowRight : ArrowDown;
  const prevLabel = groupInfo?.isHorizontal ? 'Chuyển sang trái' : 'Di chuyển lên';
  const nextLabel = groupInfo?.isHorizontal ? 'Chuyển sang phải' : 'Di chuyển xuống';

  const itemBtnStyle = (disabled = false) => ({
    background: 'transparent',
    border: 'none',
    color: disabled ? 'var(--text-slate-600, #475569)' : 'var(--text-contrast, #fff)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: '7px 10px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.65rem',
    textAlign: 'left',
    width: '100%',
    transition: 'background 0.2s ease',
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div ref={menuRef} className={`module-menu-container ${className}`} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <button
        type="button"
        className="module-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title="Tùy chọn hiển thị & vị trí module"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-slate-400)',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          opacity: 0.6
        }}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div
          className="module-dropdown-menu glass-panel"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            minWidth: '175px',
            background: 'var(--bg-panel-solid, rgba(15, 23, 42, 0.95))',
            border: '1px solid var(--border-panel, rgba(255, 255, 255, 0.1))',
            borderRadius: '6px',
            padding: '4px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {groupInfo && order.length > 1 && (
            <>
              <button
                type="button"
                disabled={!canMovePrev}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canMovePrev) return;
                  moveModule(groupInfo.groupKey, groupInfo.itemId, 'up');
                  setIsOpen(false);
                }}
                className="module-dropdown-item font-mono"
                style={itemBtnStyle(!canMovePrev)}
              >
                <PrevIcon size={13} style={{ color: 'var(--color-emerald-400, #34d399)' }} />
                <span>{prevLabel}</span>
              </button>
              <button
                type="button"
                disabled={!canMoveNext}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canMoveNext) return;
                  moveModule(groupInfo.groupKey, groupInfo.itemId, 'down');
                  setIsOpen(false);
                }}
                className="module-dropdown-item font-mono"
                style={itemBtnStyle(!canMoveNext)}
              >
                <NextIcon size={13} style={{ color: 'var(--color-emerald-400, #34d399)' }} />
                <span>{nextLabel}</span>
              </button>
            </>
          )}

          {parentInfo && parentOrder.length > 1 && (
            <>
              <div style={{ height: '1px', background: 'var(--border-panel, rgba(255,255,255,0.08))', margin: '2px 4px' }} />
              <button
                type="button"
                disabled={!canParentUp}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canParentUp) return;
                  moveModule(parentInfo.groupKey, parentInfo.itemId, 'up');
                  setIsOpen(false);
                }}
                className="module-dropdown-item font-mono"
                style={itemBtnStyle(!canParentUp)}
              >
                <ArrowUp size={13} style={{ color: 'var(--color-sky-400, #38bdf8)' }} />
                <span>{parentInfo.label} lên</span>
              </button>
              <button
                type="button"
                disabled={!canParentDown}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canParentDown) return;
                  moveModule(parentInfo.groupKey, parentInfo.itemId, 'down');
                  setIsOpen(false);
                }}
                className="module-dropdown-item font-mono"
                style={itemBtnStyle(!canParentDown)}
              >
                <ArrowDown size={13} style={{ color: 'var(--color-sky-400, #38bdf8)' }} />
                <span>{parentInfo.label} xuống</span>
              </button>
            </>
          )}

          {groupInfo && (
            <div style={{ height: '1px', background: 'var(--border-panel, rgba(255,255,255,0.08))', margin: '2px 4px' }} />
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              hideModule(moduleId);
              setIsOpen(false);
            }}
            className="module-dropdown-item font-mono"
            style={itemBtnStyle(false)}
          >
            <EyeOff size={13} className="text-rose" style={{ color: 'var(--color-rose-400, #f87171)' }} />
            <span>Ẩn module hiển thị</span>
          </button>
        </div>
      )}
    </div>
  );
}

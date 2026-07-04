import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, EyeOff } from 'lucide-react';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';

export default function ModuleMenu({ moduleId, className = "", style = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const { hideModule } = useModuleVisibility();

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

  return (
    <div ref={menuRef} className={`module-menu-container ${className}`} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <button
        type="button"
        className="module-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title="Tùy chọn hiển thị module"
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
            minWidth: '150px',
            background: 'var(--bg-panel-solid, rgba(15, 23, 42, 0.95))',
            border: '1px solid var(--border-panel, rgba(255, 255, 255, 0.1))',
            borderRadius: '6px',
            padding: '4px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              hideModule(moduleId);
              setIsOpen(false);
            }}
            className="module-dropdown-item font-mono"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-contrast, #fff)',
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.65rem',
              textAlign: 'left',
              width: '100%',
              transition: 'background 0.2s ease'
            }}
          >
            <EyeOff size={13} className="text-rose" style={{ color: 'var(--color-rose-400, #f87171)' }} />
            <span>Ẩn module hiển thị</span>
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { GripVertical, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';

// Track active drag payload across components (dataTransfer isn't readable during dragover in some browsers)
let activeDragPayload = null;

export default function SortableModuleItem({
  groupKey,
  itemId,
  label,
  isHorizontal = false,
  className = '',
  style = {},
  children,
}) {
  const { isEditLayoutMode, getGroupOrder, moveModule, reorderModule } = useModuleVisibility();
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  if (!isEditLayoutMode) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  const order = getGroupOrder(groupKey);
  const idx = order.indexOf(itemId);
  const canPrev = idx > 0;
  const canNext = idx !== -1 && idx < order.length - 1;

  const PrevIcon = isHorizontal ? ArrowLeft : ArrowUp;
  const NextIcon = isHorizontal ? ArrowRight : ArrowDown;

  const handleDragStart = (e) => {
    e.stopPropagation();
    activeDragPayload = { groupKey, itemId };
    setIsDragging(true);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({ groupKey, itemId }));
    } catch {
      // Ignore dataTransfer errors in restricted contexts
    }
  };

  const handleDragOver = (e) => {
    if (!activeDragPayload || activeDragPayload.groupKey !== groupKey || activeDragPayload.itemId === itemId) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    let payload = activeDragPayload;
    if (!payload) {
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (raw) payload = JSON.parse(raw);
      } catch {
        // Ignore parse error
      }
    }
    if (payload && payload.groupKey === groupKey && payload.itemId !== itemId) {
      reorderModule(groupKey, payload.itemId, itemId);
    }
    activeDragPayload = null;
    setIsDragging(false);
  };

  const handleDragEnd = (e) => {
    e.stopPropagation();
    activeDragPayload = null;
    setIsDragging(false);
    setIsDragOver(false);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      className={`sortable-module-item ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''} ${className}`}
      style={{
        position: 'relative',
        borderRadius: '10px',
        outline: isDragOver
          ? '2px dashed rgba(16, 185, 129, 0.85)'
          : '1px dashed rgba(148, 163, 184, 0.35)',
        outlineOffset: '2px',
        opacity: isDragging ? 0.55 : 1,
        transition: 'outline 0.15s ease, opacity 0.15s ease, transform 0.15s ease',
        cursor: 'grab',
        ...style,
      }}
    >
      <div
        className="sortable-module-toolbar font-mono"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '4px 10px',
          marginBottom: '6px',
          borderRadius: '6px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          fontSize: '0.6rem',
          color: 'var(--color-emerald-400, #34d399)',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
          <GripVertical size={13} />
          <span>{label || itemId}</span>
        </span>
        {order.length > 1 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => moveModule(groupKey, itemId, 'up')}
              title={isHorizontal ? 'Chuyển sang trái' : 'Di chuyển lên'}
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: canPrev ? '#e2e8f0' : '#475569',
                borderRadius: '4px',
                padding: '2px 5px',
                cursor: canPrev ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <PrevIcon size={12} />
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => moveModule(groupKey, itemId, 'down')}
              title={isHorizontal ? 'Chuyển sang phải' : 'Di chuyển xuống'}
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: canNext ? '#e2e8f0' : '#475569',
                borderRadius: '4px',
                padding: '2px 5px',
                cursor: canNext ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <NextIcon size={12} />
            </button>
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

import { History, Timer, Camera, Layers } from 'lucide-react';

const DATA_ORIGIN_CONFIG = {
  history: {
    icon: History,
    defaultLabel: 'Lịch sử API',
    shortLabel: 'Lịch sử',
    className: 'data-origin-history',
    description: 'Tính được dữ liệu lịch sử trực tiếp từ API/lưu trữ ngay khi mở web (không phụ thuộc thời gian treo tab).',
  },
  session: {
    icon: Timer,
    defaultLabel: 'Từ lúc mở tab',
    shortLabel: 'Mở tab',
    className: 'data-origin-session',
    description: 'Chỉ thu thập & tích lũy từ lúc mở tab trình duyệt. Khoảng thời gian đóng tab sẽ không có dữ liệu.',
  },
  snapshot: {
    icon: Camera,
    defaultLabel: 'Tức thời',
    shortLabel: 'Tức thời',
    className: 'data-origin-snapshot',
    description: 'Ảnh chụp trạng thái hiện tại ngay lúc tải/sync (không cần mở tab trước, nhưng không có lịch sử quá khứ).',
  },
  hybrid: {
    icon: Layers,
    defaultLabel: 'Lịch sử + Mở tab',
    shortLabel: 'Hỗn hợp',
    className: 'data-origin-hybrid',
    description: 'Kết hợp dữ liệu lịch sử API và dữ liệu tích lũy khi mở tab (xem ký hiệu riêng ở từng mục con bên trong).',
  },
};

export default function DataOriginBadge({
  origin = 'history',
  label,
  title,
  compact = false,
  iconOnly = true,
  style = {},
}) {
  const cfg = DATA_ORIGIN_CONFIG[origin] || DATA_ORIGIN_CONFIG.history;
  const Icon = cfg.icon;
  const displayLabel = label ?? (compact ? cfg.shortLabel : cfg.defaultLabel);
  const tooltipText = title || (label ? `${label} — ${cfg.description}` : cfg.description);

  return (
    <span
      className={`data-origin-badge ${cfg.className}${compact ? ' is-compact' : ''}${iconOnly ? ' is-icon-only' : ''}`}
      title={tooltipText}
      aria-label={tooltipText}
      style={style}
    >
      <Icon size={13} className="data-origin-icon" strokeWidth={2} />
      {!iconOnly && <span>{displayLabel}</span>}
    </span>
  );
}

export function DataOriginLegend({ compact = false, style = {} }) {
  return (
    <div className={`data-origin-legend${compact ? ' is-compact' : ''}`} style={style}>
      <span className="data-origin-legend-title">Nguồn dữ liệu:</span>
      <span className="data-origin-legend-item" title={DATA_ORIGIN_CONFIG.history.description}>
        <DataOriginBadge origin="history" compact={compact} iconOnly={false} />
        <span className="data-origin-legend-desc">Tải sẵn từ API</span>
      </span>
      <span className="data-origin-legend-item" title={DATA_ORIGIN_CONFIG.session.description}>
        <DataOriginBadge origin="session" compact={compact} iconOnly={false} />
        <span className="data-origin-legend-desc">Từ lúc mở tab</span>
      </span>
      <span className="data-origin-legend-item" title={DATA_ORIGIN_CONFIG.snapshot.description}>
        <DataOriginBadge origin="snapshot" compact={compact} iconOnly={false} />
        <span className="data-origin-legend-desc">Trạng thái tức thời</span>
      </span>
    </div>
  );
}

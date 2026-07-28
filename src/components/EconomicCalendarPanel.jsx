import React, { useState, useEffect, useMemo } from 'react';
import { getWeeklyEconomicCalendar } from '../services/economicCalendarService';
import ModuleMenu from './ModuleMenu';

const IMPACT_COLORS = {
  High: { dot: '🔴', bg: 'rgba(244,63,94,0.15)', border: 'rgba(244,63,94,0.4)', text: '#f43f5e', label: 'Quan trọng cao (High Impact)' },
  Medium: { dot: '🟡', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', text: '#f59e0b', label: 'Tác động vừa (Medium Impact)' },
  Low: { dot: '🟢', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.4)', text: '#10b981', label: 'Tác động thấp (Low Impact)' },
};

const COUNTRY_FLAGS = {
  USD: '🇺🇸', EUR: '🇪🇺', JPY: '🇯🇵', GBP: '🇬🇧', CNY: '🇨🇳', CAD: '🇨🇦', AUD: '🇦🇺',
};

export default function EconomicCalendarPanel({ theme }) {
  const [calendarData, setCalendarData] = useState({ weekDays: [], allEvents: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'USD' | 'CRYPTO'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getWeeklyEconomicCalendar(force);
      setCalendarData(data);
    } catch (err) {
      console.error('[EconomicCalendarPanel] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto refresh every 30 minutes
    const interval = setInterval(() => loadData(true), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Filter events per day
  const filteredWeekDays = useMemo(() => {
    if (!calendarData?.weekDays) return [];
    return calendarData.weekDays.map((day) => {
      const filteredEvents = day.events.filter((e) => {
        if (filter === 'HIGH') return e.impact === 'High';
        if (filter === 'USD') return e.country === 'USD';
        if (filter === 'CRYPTO') return e.impact === 'High' || e.impactCrypto?.includes('Cực Mạnh') || e.category?.includes('LẠM PHÁT') || e.category?.includes('CHÍNH SÁCH');
        return true;
      });
      return { ...day, events: filteredEvents };
    });
  }, [calendarData, filter]);

  const getImpactStyle = (impact) => IMPACT_COLORS[impact] || IMPACT_COLORS.Medium;

  return (
    <div className="glass-panel economic-calendar-panel" style={{ padding: '18px 20px', marginBottom: '20px', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '12px' }}>
      {/* Panel Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '1px solid var(--border-panel)', paddingBottom: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="dot dot-emerald" />
            <h3 className="font-mono text-emerald" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              📅 LỊCH KINH TẾ VĨ MÔ TUẦN NÀY (7 NGÀY TRONG TUẦN)
            </h3>
            {refreshing && <span style={{ fontSize: '0.7rem', color: 'var(--color-amber-400)' }}>⏳ Đang cập nhật...</span>}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-slate-400)', marginTop: '4px' }}>
            Bảng theo dõi tin tức kinh tế Mỹ &amp; Toàn cầu (CPI, FOMC, NFP...). Bấm vào ô sự kiện để xem phân tích tác động đến Bitcoin &amp; Crypto.
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { key: 'ALL', label: '🌟 Tất Cả' },
            { key: 'HIGH', label: '🔴 Quan Trọng (High)' },
            { key: 'USD', label: '🇺🇸 Chỉ USD (Mỹ)' },
            { key: 'CRYPTO', label: '⚡ Tác Động Crypto' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                background: filter === item.key ? 'var(--color-emerald-500)' : 'rgba(255,255,255,0.05)',
                color: filter === item.key ? '#000' : 'var(--text-contrast)',
                border: filter === item.key ? '1px solid var(--color-emerald-400)' : '1px solid var(--border-panel)',
                transition: 'all 0.2s',
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadData(true)}
            title="Tải lại lịch kinh tế"
            style={{
              padding: '5px 8px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-panel)',
              color: 'var(--text-contrast)',
            }}
          >
            🔄
          </button>
          <ModuleMenu moduleId="dash_calendar" />
        </div>
      </div>

      {/* 7-Day Grids (Các ô vuông theo thứ trong tuần) */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-slate-400)', fontStyle: 'italic' }}>
          ⏳ Đang tải dữ liệu lịch kinh tế 7 ngày trong tuần...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(125px, 1fr))',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '6px',
            width: '100%',
          }}
        >
          {filteredWeekDays.map((day) => {
            const isToday = day.isToday;
            return (
              <div
                key={day.dayIndex}
                style={{
                  background: isToday ? 'rgba(16,185,129,0.05)' : 'var(--bg-slate-950)',
                  border: isToday ? '1.5px solid var(--color-emerald-500)' : '1px solid var(--border-panel)',
                  borderRadius: '8px',
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  minHeight: '160px',
                  boxShadow: isToday ? '0 0 12px rgba(16,185,129,0.12)' : 'none',
                  position: 'relative',
                }}
              >
                {/* Day Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>
                  <span className="font-mono" style={{ fontWeight: 700, fontSize: '0.75rem', color: isToday ? 'var(--color-emerald-400)' : 'var(--text-contrast)' }}>
                    {day.nameVN}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)', background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px' }}>
                    {day.dateStr}
                  </span>
                </div>

                {isToday && (
                  <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#000', background: 'var(--color-emerald-400)', padding: '1px 5px', borderRadius: '3px', alignSelf: 'flex-start' }}>
                    ● HÔM NAY
                  </div>
                )}

                {/* Events List */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '210px', overflowY: 'auto', paddingRight: '1px' }}>
                  {day.events.length === 0 ? (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-slate-400)', fontStyle: 'italic', textAlign: 'center', margin: 'auto 0' }}>
                      --- Trống ---
                    </div>
                  ) : (
                    day.events.map((event) => {
                      const impactStyle = getImpactStyle(event.impact);
                      const flag = COUNTRY_FLAGS[event.country] || '🌐';

                      return (
                        <div
                          key={event.id}
                          onClick={() => setSelectedEvent(event)}
                          style={{
                            background: 'rgba(255,255,255,0.025)',
                            border: '1px solid rgba(255,255,255,0.07)',
                            borderRadius: '5px',
                            padding: '5px 6px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease-in-out',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(16,185,129,0.08)';
                            e.currentTarget.style.borderColor = 'rgba(16,185,129,0.3)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          {/* Top Row: Time + Flag + Impact */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', color: 'var(--text-slate-400)', fontFamily: 'var(--font-mono)' }}>
                            <span style={{ fontWeight: 600, color: 'var(--text-contrast)' }}>
                              ⏰ {event.timeStr}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <span>{flag}</span>
                              <span title={impactStyle.label}>{impactStyle.dot}</span>
                            </span>
                          </div>

                          {/* Title */}
                          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-contrast)', lineHeight: '1.2', wordBreak: 'break-word' }}>
                            {event.titleVN || event.title}
                          </div>

                          {/* Data Row: Actual / Forecast */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-slate-400)', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '3px', marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
                            <span>
                              Act: <strong style={{ color: event.actual ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' }}>{event.actual || '--'}</strong>
                            </span>
                            <span>
                              Fc: {event.forecast || '--'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* EVENT DETAIL MODAL (Khi click vào sự kiện) */}
      {selectedEvent && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 99999,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setSelectedEvent(null)}
        >
          <div
            style={{
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--color-emerald-500)',
              borderRadius: '14px',
              maxWidth: '620px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-panel)', paddingBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '1.4rem' }}>{COUNTRY_FLAGS[selectedEvent.country] || '🌐'}</span>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: getImpactStyle(selectedEvent.impact).bg,
                    border: `1px solid ${getImpactStyle(selectedEvent.impact).border}`,
                    color: getImpactStyle(selectedEvent.impact).text,
                  }}>
                    {getImpactStyle(selectedEvent.impact).label}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-slate-400)', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '6px' }}>
                    {selectedEvent.category}
                  </span>
                </div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-contrast)', margin: 0, lineHeight: 1.3 }}>
                  {selectedEvent.titleVN || selectedEvent.title}
                </h2>
                {selectedEvent.titleVN && selectedEvent.title !== selectedEvent.titleVN && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-slate-400)', fontStyle: 'italic', marginTop: '2px' }}>
                    ({selectedEvent.title})
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-panel)',
                  color: 'var(--text-contrast)',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '1.1rem',
                }}
              >
                ✕
              </button>
            </div>

            {/* Time & Location */}
            <div style={{ background: 'var(--bg-slate-950)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-panel)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-slate-400)' }}>⏰ Thời gian: </span>
                <strong style={{ color: 'var(--color-amber-400)' }}>{selectedEvent.timeStr}</strong> - {selectedEvent.fullDateStr || selectedEvent.dateStr} (Giờ VN)
              </div>
              <div>
                <span style={{ color: 'var(--text-slate-400)' }}>🌍 Đồng tiền: </span>
                <strong style={{ color: 'var(--text-contrast)' }}>{selectedEvent.country}</strong>
              </div>
            </div>

            {/* Data Comparison Table */}
            <div style={{ background: 'var(--bg-slate-950)', borderRadius: '8px', border: '1px solid var(--border-panel)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-panel)', padding: '10px 14px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-slate-400)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                <div>THỰC TẾ (ACTUAL)</div>
                <div>DỰ BÁO (FORECAST)</div>
                <div>KỲ TRƯỚC (PREVIOUS)</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '14px', fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                <div style={{ color: selectedEvent.actual ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' }}>
                  {selectedEvent.actual || 'Chưa công bố'}
                </div>
                <div style={{ color: 'var(--text-contrast)' }}>
                  {selectedEvent.forecast || '---'}
                </div>
                <div style={{ color: 'var(--text-slate-400)' }}>
                  {selectedEvent.previous || '---'}
                </div>
              </div>
            </div>

            {/* AI CRYPTO ANALYSIS */}
            <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-emerald-400)', fontFamily: 'var(--font-mono)' }}>
                <span>🐋</span> PHÂN TÍCH TÁC ĐỘNG ĐẾN BITCOIN &amp; CRYPTO:
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-emerald-300)', fontWeight: 600, marginBottom: '6px' }}>
                {selectedEvent.impactCrypto}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-contrast)', lineHeight: 1.5, marginBottom: '12px' }}>
                {selectedEvent.analysis}
              </div>
              {selectedEvent.tradingCue && (
                <div style={{ background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid var(--color-amber-400)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.78rem', color: 'var(--color-amber-300)', fontFamily: 'var(--font-mono)' }}>
                  {selectedEvent.tradingCue}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: 'var(--color-emerald-500)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Đóng / Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

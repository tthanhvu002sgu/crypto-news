import React, { useState, useEffect, useMemo } from 'react';
import { getWeeklyEconomicCalendar } from '../services/economicCalendarService';
import ModuleMenu from './ModuleMenu';

const IMPACT_BADGES = {
  High: { bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', text: '#f43f5e', label: 'HIGH' },
  Medium: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', label: 'MED' },
  Low: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#10b981', label: 'LOW' },
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
    const interval = setInterval(() => loadData(true), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredWeekDays = useMemo(() => {
    if (!calendarData?.weekDays) return [];
    return calendarData.weekDays.map((day) => {
      const filteredEvents = day.events.filter((e) => {
        if (filter === 'HIGH') return e.impact === 'High';
        if (filter === 'USD') return e.country === 'USD';
        if (filter === 'CRYPTO') return e.impact === 'High' || e.category?.includes('LẠM PHÁT') || e.category?.includes('CHÍNH SÁCH');
        return true;
      });
      return { ...day, events: filteredEvents };
    });
  }, [calendarData, filter]);

  const getImpact = (impact) => IMPACT_BADGES[impact] || IMPACT_BADGES.Medium;

  return (
    <div className="glass-panel economic-calendar-panel" style={{ padding: '16px', marginBottom: '20px', border: '1px solid var(--border-panel)', borderRadius: '8px' }}>
      {/* Editorial Minimalist Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 className="font-mono text-emerald" style={{ margin: 0, fontSize: '0.9rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
              ECONOMIC CALENDAR (7 DAYS)
            </h3>
            {refreshing && <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--color-amber-400)' }}>[UPDATING...]</span>}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-slate-400)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
            US &amp; Global Macroeconomic Release Schedule
          </div>
        </div>

        {/* Filter Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { key: 'ALL', label: 'ALL' },
            { key: 'HIGH', label: 'HIGH IMPACT' },
            { key: 'USD', label: 'USD ONLY' },
            { key: 'CRYPTO', label: 'CRYPTO IMPACT' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em',
                background: filter === item.key ? 'var(--color-emerald-500)' : 'transparent',
                color: filter === item.key ? '#000' : 'var(--text-slate-400)',
                border: filter === item.key ? '1px solid var(--color-emerald-400)' : '1px solid rgba(255,255,255,0.1)',
                transition: 'all 0.15s ease',
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadData(true)}
            title="Reload Calendar Data"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              cursor: 'pointer',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-slate-400)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6" />
              <path d="M2 11.5a10 10 0 0 1 18.8-4.3L21.5 8M2.5 16l1.2 1.2A10 10 0 0 0 22 12.5" />
            </svg>
          </button>
          <ModuleMenu moduleId="dash_calendar" />
        </div>
      </div>

      {/* 7 Columns on 1 Row on PC, Horizontal Scroll on Mobile */}
      {loading ? (
        <div className="font-mono" style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-slate-400)', fontSize: '0.75rem' }}>
          LOADING ECONOMIC DATA...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
            width: '100%',
          }}
        >
          {filteredWeekDays.map((day) => {
            const isToday = day.isToday;
            const isPast = day.isPast;
            const dayBackground = isToday
              ? 'rgba(16,185,129,0.04)'
              : isPast
                ? 'rgba(100,116,139,0.08)'
                : 'var(--bg-slate-950)';
            const dayBorder = isToday
              ? '1px solid var(--color-emerald-500)'
              : isPast
                ? '1px solid rgba(148,163,184,0.18)'
                : '1px solid var(--border-panel)';
            const primaryTextColor = isToday
              ? 'var(--color-emerald-400)'
              : isPast
                ? 'var(--text-slate-500)'
                : 'var(--text-contrast)';
            return (
              <div
                key={day.dayIndex}
                style={{
                  background: dayBackground,
                  border: dayBorder,
                  borderRadius: '6px',
                  padding: '6px 7px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  minHeight: '155px',
                  position: 'relative',
                }}
              >
                {/* Day Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>
                  <span className="font-mono" style={{ fontWeight: 700, fontSize: '0.72rem', color: primaryTextColor }}>
                    {day.nameVN.toUpperCase()}
                  </span>
                  <span className="font-mono" style={{ fontSize: '0.6rem', color: isPast ? 'var(--text-slate-600)' : 'var(--text-slate-400)' }}>
                    {day.dateStr}
                  </span>
                </div>

                {isToday && (
                  <div className="font-mono" style={{ fontSize: '0.58rem', fontWeight: 700, color: '#000', background: 'var(--color-emerald-400)', padding: '1px 4px', borderRadius: '2px', alignSelf: 'flex-start', letterSpacing: '0.04em' }}>
                    TODAY
                  </div>
                )}

                {/* Events List */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '210px', overflowY: 'auto', paddingRight: '1px' }}>
                  {day.events.length === 0 ? (
                    <div className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-slate-500)', textAlign: 'center', margin: 'auto 0' }}>
                      NO EVENTS
                    </div>
                  ) : (
                    day.events.map((event) => {
                      const impact = getImpact(event.impact);
                      const hasActual = event.actual !== '' && event.actual != null;

                      return (
                        <div
                          key={event.id}
                          onClick={() => setSelectedEvent(event)}
                          style={{
                            background: isPast ? 'rgba(148,163,184,0.035)' : 'rgba(255,255,255,0.02)',
                            border: isPast ? '1px solid rgba(148,163,184,0.08)' : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '4px',
                            padding: '5px 6px',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease-in-out',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                          }}
                          onMouseEnter={(e) => {
                            if (isPast) return;
                            e.currentTarget.style.background = 'rgba(16,185,129,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(16,185,129,0.25)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isPast ? 'rgba(148,163,184,0.035)' : 'rgba(255,255,255,0.02)';
                            e.currentTarget.style.borderColor = isPast ? 'rgba(148,163,184,0.08)' : 'rgba(255,255,255,0.06)';
                          }}
                        >
                          {/* Top Meta: Time + Country + Impact */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.62rem', color: 'var(--text-slate-400)', fontFamily: 'var(--font-mono)' }}>
                            <span style={{ fontWeight: 600, color: isPast ? 'var(--text-slate-500)' : 'var(--text-contrast)' }}>
                              {event.timeStr}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '0.58rem', background: 'rgba(255,255,255,0.06)', padding: '0 3px', borderRadius: '2px', color: 'var(--text-contrast)', fontWeight: 600 }}>
                                {event.country}
                              </span>
                              <span style={{ fontSize: '0.55rem', fontWeight: 700, color: impact.text, background: impact.bg, padding: '0 3px', borderRadius: '2px', border: `1px solid ${impact.border}` }}>
                                {impact.label}
                              </span>
                            </div>
                          </div>

                          {/* Title */}
                          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: isPast ? 'var(--text-slate-500)' : 'var(--text-contrast)', lineHeight: '1.2' }}>
                            {event.titleVN || event.title}
                          </div>

                          {/* Data Row */}
                          <div className="font-mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--text-slate-400)', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '3px', marginTop: '1px' }}>
                            <span>ACT: <strong style={{ color: hasActual ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' }}>{hasActual ? event.actual : '--'}</strong></span>
                            <span>FC: {event.forecast ?? '--'}</span>
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

      {/* MINIMALIST EDITORIAL MODAL */}
      {selectedEvent && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 99999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setSelectedEvent(null)}
        >
          <div
            style={{
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--border-panel)',
              borderRadius: '8px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '20px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-contrast)' }}>
                    {selectedEvent.country}
                  </span>
                  <span className="font-mono" style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '3px',
                    background: getImpact(selectedEvent.impact).bg,
                    border: `1px solid ${getImpact(selectedEvent.impact).border}`,
                    color: getImpact(selectedEvent.impact).text,
                  }}>
                    {getImpact(selectedEvent.impact).label} IMPACT
                  </span>
                  <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-slate-400)' }}>
                    {selectedEvent.category}
                  </span>
                </div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-contrast)', margin: 0, lineHeight: 1.35 }}>
                  {selectedEvent.titleVN || selectedEvent.title}
                </h2>
                {selectedEvent.titleVN && selectedEvent.title !== selectedEvent.titleVN && (
                  <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-slate-400)', marginTop: '2px' }}>
                    {selectedEvent.title}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="font-mono"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-slate-400)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                ESC
              </button>
            </div>

            {/* Time Info */}
            <div className="font-mono" style={{ background: 'var(--bg-slate-950)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <div>
                <span style={{ color: 'var(--text-slate-400)' }}>TIME: </span>
                <strong style={{ color: 'var(--color-emerald-400)' }}>{selectedEvent.timeStr}</strong> ({selectedEvent.fullDateStr || selectedEvent.dateStr})
              </div>
              <div>
                <span style={{ color: 'var(--text-slate-400)' }}>CURRENCY: </span>
                <strong style={{ color: 'var(--text-contrast)' }}>{selectedEvent.country}</strong>
              </div>
            </div>

            {/* Data Comparison */}
            <div style={{ background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div className="font-mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '8px 12px', fontSize: '0.68rem', color: 'var(--text-slate-400)', textAlign: 'center', letterSpacing: '0.04em' }}>
                <div>ACTUAL</div>
                <div>FORECAST</div>
                <div>PREVIOUS</div>
              </div>
              <div className="font-mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '12px', fontSize: '1rem', fontWeight: 700, textAlign: 'center' }}>
                <div style={{ color: selectedEvent.actual !== '' && selectedEvent.actual != null ? 'var(--color-emerald-400)' : 'var(--text-slate-400)' }}>
                  {selectedEvent.actual !== '' && selectedEvent.actual != null ? selectedEvent.actual : 'PENDING'}
                </div>
                <div style={{ color: 'var(--text-contrast)' }}>
                  {selectedEvent.forecast || '--'}
                </div>
                <div style={{ color: 'var(--text-slate-400)' }}>
                  {selectedEvent.previous || '--'}
                </div>
              </div>
            </div>

            {/* Editorial Crypto Analysis */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '14px' }}>
              <div className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-emerald-400)', marginBottom: '4px', letterSpacing: '0.04em' }}>
                BITCOIN &amp; CRYPTO MARKET IMPACT
              </div>
              <div className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-contrast)', fontWeight: 600, marginBottom: '8px' }}>
                {selectedEvent.impactCrypto}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-slate-300)', lineHeight: 1.5, marginBottom: '10px' }}>
                {selectedEvent.analysis}
              </div>
              {selectedEvent.tradingCue && (
                <div className="font-mono" style={{ background: 'rgba(245,158,11,0.08)', borderLeft: '2px solid var(--color-amber-400)', padding: '6px 10px', fontSize: '0.72rem', color: 'var(--color-amber-300)' }}>
                  {selectedEvent.tradingCue}
                </div>
              )}
            </div>

            {/* Footer Close */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="font-mono"
                style={{
                  background: 'var(--color-emerald-500)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

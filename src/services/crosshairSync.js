// Lightweight pub/sub để đồng bộ crosshair giữa AdvancedChart (lightweight-charts)
// và CVD Panel (Chart.js). Payload: { timeMs } hoặc null khi rời chuột.

const listeners = new Set();

export function emitCrosshair(payload) {
  listeners.forEach((fn) => {
    try { fn(payload); } catch (e) { /* noop */ }
  });
}

export function subscribeCrosshair(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

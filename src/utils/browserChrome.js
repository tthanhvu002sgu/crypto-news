/**
 * Document title + dynamic favicon for live BTC price.
 *
 * Why a dedicated module (not React useEffect):
 * - Background tabs throttle React re-renders; favicon would lag until click/focus.
 * - WebSocket can call this directly so chrome updates even when React is deferred.
 * - Canvas PNG is more reliable than SVG data-URLs across Chromium/Firefox.
 * - Only rewrite the icon when the visible short-price or color actually changes.
 */

const FAVICON_MIN_INTERVAL_MS = 1000;

let lastVisualKey = '';
let lastApplied = { shortPrice: null, bgColor: null };
let throttleTimer = null;
let pending = null;
let linkEl = null;
let visibilityHooked = false;

function formatShortPrice(price) {
  if (price >= 1000) {
    return `${(price / 1000).toFixed(price >= 100000 ? 0 : 1)}k`;
  }
  return `$${Math.round(price)}`;
}

function ensureLink() {
  if (linkEl && linkEl.isConnected) return linkEl;
  linkEl = document.querySelector("link[rel~='icon']");
  if (!linkEl) {
    linkEl = document.createElement('link');
    linkEl.rel = 'icon';
    document.head.appendChild(linkEl);
  }
  return linkEl;
}

/** Draw favicon via canvas → PNG data URL (stable in background tabs). */
function paintFavicon(shortPrice, bgColor) {
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    // Rounded rect background
    const r = 14;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(size, 0, size, size, r);
    ctx.arcTo(size, size, 0, size, r);
    ctx.arcTo(0, size, 0, 0, r);
    ctx.arcTo(0, 0, size, 0, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortPrice, size / 2, size / 2 + 1);

    const link = ensureLink();
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
    return true;
  } catch (e) {
    console.warn('[browserChrome] favicon paint failed:', e);
    return false;
  }
}

function applyNow(price, change) {
  const p = parseFloat(price);
  if (!Number.isFinite(p)) return;

  const ch = parseFloat(change) || 0;
  const priceFormatted = p.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  document.title = `$${priceFormatted} | BTC ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`;
}

function flushPending() {
  throttleTimer = null;
  if (!pending) return;
  const { price, change } = pending;
  pending = null;
  applyNow(price, change);
}

function ensureVisibilityHook() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pending) {
      flushPending();
    }
  });
}


/**
 * Update tab title + favicon from live BTC price.
 * Safe to call on every WS tick — internally throttled + de-duped.
 */
export function updateBrowserChrome(price, change) {
  if (price == null || typeof document === 'undefined') return;
  ensureVisibilityHook();

  pending = { price, change };

  // When tab is visible, flush sooner; when hidden still update but throttled
  const delay =
    document.visibilityState === 'visible' ? FAVICON_MIN_INTERVAL_MS : FAVICON_MIN_INTERVAL_MS * 2;

  if (throttleTimer) return;
  throttleTimer = setTimeout(flushPending, delay);
}

/** Force immediate update (e.g. after REST fallback price arrives). */
export function updateBrowserChromeImmediate(price, change) {
  if (price == null || typeof document === 'undefined') return;
  ensureVisibilityHook();
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  pending = null;
  applyNow(price, change);
}

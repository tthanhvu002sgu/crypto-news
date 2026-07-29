import { useState, useEffect, useRef } from 'react';
import { getDailyCVD } from './api';
import { updateBrowserChrome } from '../utils/browserChrome';

// ─── Stream URLs ──────────────────────────────────────────────────────────────

const WS_TICKER_URL =
  'wss://fstream.binance.com/market/stream?streams=btcusdt@ticker/btcusdt@markPrice@1s/ethusdt@ticker/solusdt@ticker/linkusdt@ticker';

const WS_AGG_URL = 'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade';

/** Throttle React state pushes from ticker stream (reduces re-render load). */
const TICKER_UI_MS = 250;
/** CVD / footprint UI + localStorage write throttle. */
const CVD_UI_MS = 500;
const WHALE_USD_MIN = 100_000;
const WHALE_KEEP = 5000;
const RECONNECT_MS = 4000;

// Trade subscribers for real-time move tracking
const tradeSubscribers = new Set();

export function subscribeAggTrades(callback) {
  tradeSubscribers.add(callback);
  return () => tradeSubscribers.delete(callback);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createReconnectingWS(url, onMessage, onStatusChange, mountedRef) {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    if (!mountedRef.current) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    onStatusChange?.('connecting');

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        onStatusChange?.('connected');
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          onMessage(JSON.parse(event.data));
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (!mountedRef.current) return;
        onStatusChange?.('disconnected');
        reconnectTimer = setTimeout(() => {
          if (mountedRef.current) connect();
        }, RECONNECT_MS);
      };
    } catch {
      onStatusChange?.('disconnected');
      reconnectTimer = setTimeout(() => {
        if (mountedRef.current) connect();
      }, RECONNECT_MS);
    }
  }

  function close() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }

  connect();
  return { close };
}

function loadTodayJson(key, dateKey, fallback) {
  try {
    const savedDate = localStorage.getItem(dateKey);
    if (savedDate === getTodayStr()) {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function loadTodayMap(key, dateKey) {
  try {
    const savedDate = localStorage.getItem(dateKey);
    if (savedDate === getTodayStr()) {
      const saved = localStorage.getItem(key);
      if (saved) return new Map(JSON.parse(saved));
    }
  } catch {
    /* ignore */
  }
  return new Map();
}

// UTC calendar day (matches midnight reset for HFT session data)
function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 1: useBinanceWebSocket — Multi-symbol Prices + BTC Funding
// ═══════════════════════════════════════════════════════════════════════════════

export function useBinanceWebSocket() {
  const savedTicker = (() => {
    try {
      const raw = localStorage.getItem('hft_last_ticker');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [livePrice, setLivePrice] = useState(savedTicker?.price ?? null);
  const [liveChange, setLiveChange] = useState(savedTicker?.change ?? null);
  const [liveHigh, setLiveHigh] = useState(savedTicker?.high ?? null);
  const [liveLow, setLiveLow] = useState(savedTicker?.low ?? null);
  const [liveVolume, setLiveVolume] = useState(savedTicker?.volume ?? null);
  const [liveFunding, setLiveFunding] = useState(savedTicker?.funding ?? null);
  const [liveEthPrice, setLiveEthPrice] = useState(savedTicker?.eth ?? null);
  const [liveSolPrice, setLiveSolPrice] = useState(savedTicker?.sol ?? null);
  const [liveLinkPrice, setLiveLinkPrice] = useState(savedTicker?.link ?? null);
  const [wsStatus, setWsStatus] = useState('connecting');

  const mountedRef = useRef(true);
  // Latest values live in refs; UI state is flushed on a timer
  const snapRef = useRef({
    price: savedTicker?.price ?? null,
    change: savedTicker?.change ?? null,
    high: savedTicker?.high ?? null,
    low: savedTicker?.low ?? null,
    volume: savedTicker?.volume ?? null,
    funding: savedTicker?.funding ?? null,
    eth: savedTicker?.eth ?? null,
    sol: savedTicker?.sol ?? null,
    link: savedTicker?.link ?? null,
  });
  const flushTimerRef = useRef(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const flushUi = () => {
      flushTimerRef.current = null;
      if (!mountedRef.current || !dirtyRef.current) return;
      dirtyRef.current = false;
      const s = snapRef.current;
      if (s.price != null) setLivePrice(s.price);
      if (s.change != null) setLiveChange(s.change);
      if (s.high != null) setLiveHigh(s.high);
      if (s.low != null) setLiveLow(s.low);
      if (s.volume != null) setLiveVolume(s.volume);
      if (s.funding != null) setLiveFunding(s.funding);
      if (s.eth != null) setLiveEthPrice(s.eth);
      if (s.sol != null) setLiveSolPrice(s.sol);
      if (s.link != null) setLiveLinkPrice(s.link);

      try {
        localStorage.setItem('hft_last_ticker', JSON.stringify(s));
      } catch {
        /* ignore */
      }
    };

    const scheduleFlush = () => {
      dirtyRef.current = true;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushUi, TICKER_UI_MS);
      }
    };

    // Immediate flush when tab becomes active after backgrounding
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        flushUi();
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);

    const conn = createReconnectingWS(
      WS_TICKER_URL,
      (msg) => {
        const { stream, data } = msg;
        if (!data) return;

        if (stream === 'btcusdt@ticker') {
          const price = parseFloat(data.c);
          const change = parseFloat(data.P);
          snapRef.current.price = price;
          snapRef.current.change = change;
          snapRef.current.high = parseFloat(data.h);
          snapRef.current.low = parseFloat(data.l);
          snapRef.current.volume = parseFloat(data.q);
          // Favicon/title: bypass React so background tabs still update
          updateBrowserChrome(price, change);
          scheduleFlush();
          return;
        }
        if (stream === 'ethusdt@ticker') {
          snapRef.current.eth = parseFloat(data.c);
          scheduleFlush();
          return;
        }
        if (stream === 'solusdt@ticker') {
          snapRef.current.sol = parseFloat(data.c);
          scheduleFlush();
          return;
        }
        if (stream === 'linkusdt@ticker') {
          snapRef.current.link = parseFloat(data.c);
          scheduleFlush();
          return;
        }
        if (stream === 'btcusdt@markPrice@1s') {
          snapRef.current.funding = parseFloat(data.r);
          scheduleFlush();
        }
      },
      setWsStatus,
      mountedRef
    );

    return () => {
      mountedRef.current = false;
      window.removeEventListener('visibilitychange', handleVisibility);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      conn.close();
    };
  }, []);

  return {
    livePrice,
    liveChange,
    liveHigh,
    liveLow,
    liveVolume,
    liveFunding,
    liveEthPrice,
    liveSolPrice,
    liveLinkPrice,
    wsStatus,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 2: useCVDStream — Cumulative Volume Delta from aggTrade
// ═══════════════════════════════════════════════════════════════════════════════
// Hook 2: useCVDStream — Cumulative Volume Delta from Futures & Spot aggTrade
// ═══════════════════════════════════════════════════════════════════════════════

const WS_SPOT_AGG_URL = 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade';

export function useCVDStream() {
  // Futures State
  const [cvdFutures, setCvdFutures] = useState(0);
  const [sessionFutures, setSessionFutures] = useState(0);
  const [buyVolFutures, setBuyVolFutures] = useState(0);
  const [sellVolFutures, setSellVolFutures] = useState(0);

  // Spot State
  const [cvdSpot, setCvdSpot] = useState(0);
  const [sessionSpot, setSessionSpot] = useState(0);
  const [buyVolSpot, setBuyVolSpot] = useState(0);
  const [sellVolSpot, setSellVolSpot] = useState(0);

  const [cvdStatus, setCvdStatus] = useState('connecting');

  // Refs for Futures
  const cvdRefFutures = useRef(0);
  const sessionRefFutures = useRef(0);
  const buyRefFutures = useRef(0);
  const sellRefFutures = useRef(0);
  const historyRefFutures = useRef((() => {
    const loaded = loadTodayJson('hft_cvd_history', 'hft_cvd_history_date', []);
    const keepFrom = Date.now() - 70 * 60 * 1000;
    return Array.isArray(loaded) ? loaded.filter((h) => h.timestamp == null || h.timestamp >= keepFrom) : [];
  })());

  // Refs for Spot
  const cvdRefSpot = useRef(0);
  const sessionRefSpot = useRef(0);
  const buyRefSpot = useRef(0);
  const sellRefSpot = useRef(0);
  const historyRefSpot = useRef((() => {
    const loaded = loadTodayJson('hft_cvd_history_spot', 'hft_cvd_history_spot_date', []);
    const keepFrom = Date.now() - 70 * 60 * 1000;
    return Array.isArray(loaded) ? loaded.filter((h) => h.timestamp == null || h.timestamp >= keepFrom) : [];
  })());

  const volNodeRef = useRef(loadTodayMap('hft_vol_nodes', 'hft_vol_nodes_date'));
  const whaleRef = useRef(loadTodayJson('hft_whale_trades', 'hft_whale_trades_date', []));

  const [cvdHistoryFutures, setCvdHistoryFutures] = useState(historyRefFutures.current);
  const [cvdHistorySpot, setCvdHistorySpot] = useState(historyRefSpot.current);

  const [volNodes, setVolNodes] = useState(
    Array.from(volNodeRef.current.entries()).map(([p, v]) => ({ price: p, ...v }))
  );
  const [whaleTrades, setWhaleTrades] = useState(whaleRef.current);

  const mountedRef = useRef(true);
  const throttleRef = useRef(null);
  const minuteRefFutures = useRef(null);
  const minuteRefSpot = useRef(null);
  const isFetchingInitialRef = useRef(true);
  const todayRef = useRef(getTodayStr());

  useEffect(() => {
    mountedRef.current = true;

    const initSafetyTimer = setTimeout(() => {
      if (mountedRef.current && isFetchingInitialRef.current) {
        isFetchingInitialRef.current = false;
      }
    }, 1500);

    // Initial baseline fetch for both Futures and Spot
    Promise.all([
      getDailyCVD('BTCUSDT', 'futures'),
      getDailyCVD('BTCUSDT', 'spot'),
    ])
      .then(([initFut, initSpot]) => {
        if (!mountedRef.current) return;
        clearTimeout(initSafetyTimer);

        cvdRefFutures.current = initFut.initialCvd;
        buyRefFutures.current = initFut.initialBuyVol;
        sellRefFutures.current = initFut.initialSellVol;

        cvdRefSpot.current = initSpot.initialCvd;
        buyRefSpot.current = initSpot.initialBuyVol;
        sellRefSpot.current = initSpot.initialSellVol;

        isFetchingInitialRef.current = false;

        setCvdFutures(cvdRefFutures.current);
        setBuyVolFutures(buyRefFutures.current);
        setSellVolFutures(sellRefFutures.current);

        setCvdSpot(cvdRefSpot.current);
        setBuyVolSpot(buyRefSpot.current);
        setSellVolSpot(sellRefSpot.current);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        clearTimeout(initSafetyTimer);
        console.warn('[useCVDStream] Initial CVD fetch error, unblocking WS:', err);
        isFetchingInitialRef.current = false;
      });

    // Helper for resetting daily state
    const checkMidnightReset = (t) => {
      const today = getTodayStr();
      if (today !== todayRef.current) {
        todayRef.current = today;
        cvdRefFutures.current = 0;
        sessionRefFutures.current = 0;
        buyRefFutures.current = 0;
        sellRefFutures.current = 0;
        historyRefFutures.current = [];

        cvdRefSpot.current = 0;
        sessionRefSpot.current = 0;
        buyRefSpot.current = 0;
        sellRefSpot.current = 0;
        historyRefSpot.current = [];

        whaleRef.current = [];
        volNodeRef.current.clear();
        localStorage.removeItem('hft_cvd_history');
        localStorage.removeItem('hft_cvd_history_spot');
        localStorage.removeItem('hft_vol_nodes');
        localStorage.removeItem('hft_whale_trades');
      }
    };

    // WebSocket 1: Binance Futures
    const connFutures = createReconnectingWS(
      WS_AGG_URL,
      (msg) => {
        const raw = msg?.data || msg;
        if (!raw) return;
        const data = raw.data || raw;
        if (!data.p || !data.q) return;

        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const usdtVol = price * qty;

        tradeSubscribers.forEach((cb) => {
          try {
            cb({ price, qty, usdtVol, isTakerSell: data.m, timestamp: data.T });
          } catch {}
        });

        checkMidnightReset(data.T);
        if (isFetchingInitialRef.current) return;

        const binPrice = Math.floor(price / 10) * 10;
        let node = volNodeRef.current.get(binPrice);
        if (!node) {
          node = { buy: 0, sell: 0 };
          volNodeRef.current.set(binPrice, node);
        }

        if (data.m) {
          cvdRefFutures.current -= usdtVol;
          sessionRefFutures.current -= usdtVol;
          sellRefFutures.current += usdtVol;
          node.sell += usdtVol;
        } else {
          cvdRefFutures.current += usdtVol;
          sessionRefFutures.current += usdtVol;
          buyRefFutures.current += usdtVol;
          node.buy += usdtVol;
        }

        if (usdtVol >= WHALE_USD_MIN) {
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          whaleRef.current = [
            { time: timeStr, price, qty, usdtVol, side: data.m ? 'SELL' : 'BUY', timestamp: data.T },
            ...whaleRef.current,
          ].slice(0, WHALE_KEEP);
        }

        const currentMinute = Math.floor(data.T / 60000);
        if (minuteRefFutures.current !== currentMinute) {
          minuteRefFutures.current = currentMinute;
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          historyRefFutures.current = [
            ...historyRefFutures.current,
            { time: timeStr, cvd: cvdRefFutures.current, price, timestamp: data.T },
          ];
          const keepFrom = data.T - 70 * 60 * 1000;
          historyRefFutures.current = historyRefFutures.current.filter((h) => h.timestamp == null || h.timestamp >= keepFrom);
        } else if (historyRefFutures.current.length > 0) {
          const last = historyRefFutures.current[historyRefFutures.current.length - 1];
          last.cvd = cvdRefFutures.current;
          last.price = price;
        }

        triggerThrottle();
      },
      setCvdStatus,
      mountedRef
    );

    // WebSocket 2: Binance Spot
    const connSpot = createReconnectingWS(
      WS_SPOT_AGG_URL,
      (msg) => {
        const raw = msg?.data || msg;
        if (!raw) return;
        const data = raw.data || raw;
        if (!data.p || !data.q) return;

        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const usdtVol = price * qty;

        checkMidnightReset(data.T);
        if (isFetchingInitialRef.current) return;

        if (data.m) {
          cvdRefSpot.current -= usdtVol;
          sessionRefSpot.current -= usdtVol;
          sellRefSpot.current += usdtVol;
        } else {
          cvdRefSpot.current += usdtVol;
          sessionRefSpot.current += usdtVol;
          buyRefSpot.current += usdtVol;
        }

        const currentMinute = Math.floor(data.T / 60000);
        if (minuteRefSpot.current !== currentMinute) {
          minuteRefSpot.current = currentMinute;
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          historyRefSpot.current = [
            ...historyRefSpot.current,
            { time: timeStr, cvd: cvdRefSpot.current, price, timestamp: data.T },
          ];
          const keepFrom = data.T - 70 * 60 * 1000;
          historyRefSpot.current = historyRefSpot.current.filter((h) => h.timestamp == null || h.timestamp >= keepFrom);
        } else if (historyRefSpot.current.length > 0) {
          const last = historyRefSpot.current[historyRefSpot.current.length - 1];
          last.cvd = cvdRefSpot.current;
          last.price = price;
        }

        triggerThrottle();
      },
      null,
      mountedRef
    );

    function triggerThrottle() {
      if (!throttleRef.current) {
        throttleRef.current = setTimeout(() => {
          if (mountedRef.current) {
            setCvdFutures(cvdRefFutures.current);
            setSessionFutures(sessionRefFutures.current);
            setBuyVolFutures(buyRefFutures.current);
            setSellVolFutures(sellRefFutures.current);
            setCvdHistoryFutures([...historyRefFutures.current]);

            setCvdSpot(cvdRefSpot.current);
            setSessionSpot(sessionRefSpot.current);
            setBuyVolSpot(buyRefSpot.current);
            setSellVolSpot(sellRefSpot.current);
            setCvdHistorySpot([...historyRefSpot.current]);

            setWhaleTrades([...whaleRef.current]);
            setVolNodes(
              Array.from(volNodeRef.current.entries()).map(([p, v]) => ({ price: p, ...v }))
            );

            try {
              localStorage.setItem('hft_cvd_history_date', todayRef.current);
              localStorage.setItem('hft_cvd_history', JSON.stringify(historyRefFutures.current));
              localStorage.setItem('hft_cvd_history_spot_date', todayRef.current);
              localStorage.setItem('hft_cvd_history_spot', JSON.stringify(historyRefSpot.current));
              localStorage.setItem('hft_vol_nodes_date', todayRef.current);
              localStorage.setItem('hft_vol_nodes', JSON.stringify(Array.from(volNodeRef.current.entries())));
              localStorage.setItem('hft_whale_trades_date', todayRef.current);
              localStorage.setItem('hft_whale_trades', JSON.stringify(whaleRef.current));
            } catch (e) {
              console.error('Failed to persist HFT data:', e);
            }
          }
          throttleRef.current = null;
        }, CVD_UI_MS);
      }
    }

    return () => {
      mountedRef.current = false;
      if (throttleRef.current) clearTimeout(throttleRef.current);
      connFutures.close();
      connSpot.close();
    };
  }, []);

  const totalVolFutures = buyVolFutures + sellVolFutures;
  const volumeRatioFutures = totalVolFutures > 0 ? buyVolFutures / totalVolFutures : 0.5;

  return {
    // Futures default for backward compatibility
    cvd: cvdFutures,
    sessionCvd: sessionFutures,
    buyVolume: buyVolFutures,
    sellVolume: sellVolFutures,
    volumeRatio: volumeRatioFutures,
    cvdHistory: cvdHistoryFutures,

    // Specific Futures payload
    futures: {
      cvd: cvdFutures,
      sessionCvd: sessionFutures,
      buyVolume: buyVolFutures,
      sellVolume: sellVolFutures,
      cvdHistory: cvdHistoryFutures,
    },

    // Specific Spot payload
    spot: {
      cvd: cvdSpot,
      sessionCvd: sessionSpot,
      buyVolume: buyVolSpot,
      sellVolume: sellVolSpot,
      cvdHistory: cvdHistorySpot,
    },

    whaleTrades,
    cvdStatus,
    volNodes,
  };
}

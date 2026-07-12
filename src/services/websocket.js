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
  const [livePrice, setLivePrice] = useState(null);
  const [liveChange, setLiveChange] = useState(null);
  const [liveHigh, setLiveHigh] = useState(null);
  const [liveLow, setLiveLow] = useState(null);
  const [liveVolume, setLiveVolume] = useState(null);
  const [liveFunding, setLiveFunding] = useState(null);
  const [liveEthPrice, setLiveEthPrice] = useState(null);
  const [liveSolPrice, setLiveSolPrice] = useState(null);
  const [liveLinkPrice, setLiveLinkPrice] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');

  const mountedRef = useRef(true);
  // Latest values live in refs; UI state is flushed on a timer
  const snapRef = useRef({
    price: null,
    change: null,
    high: null,
    low: null,
    volume: null,
    funding: null,
    eth: null,
    sol: null,
    link: null,
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
    };

    const scheduleFlush = () => {
      dirtyRef.current = true;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushUi, TICKER_UI_MS);
      }
    };

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

export function useCVDStream() {
  const [cvd, setCvd] = useState(0);
  const [sessionCvd, setSessionCvd] = useState(0);
  const [buyVolume, setBuyVolume] = useState(0);
  const [sellVolume, setSellVolume] = useState(0);
  const [cvdStatus, setCvdStatus] = useState('connecting');

  const cvdRef = useRef(0);
  const sessionRef = useRef(0);
  const buyRef = useRef(0);
  const sellRef = useRef(0);

  const historyRef = useRef(
    loadTodayJson('hft_cvd_history', 'hft_cvd_history_date', [])
  );
  const volNodeRef = useRef(
    loadTodayMap('hft_vol_nodes', 'hft_vol_nodes_date')
  );
  const whaleRef = useRef(
    loadTodayJson('hft_whale_trades', 'hft_whale_trades_date', [])
  );

  const [cvdHistory, setCvdHistory] = useState(historyRef.current);
  const [volNodes, setVolNodes] = useState(
    Array.from(volNodeRef.current.entries()).map(([p, v]) => ({ price: p, ...v }))
  );
  const [whaleTrades, setWhaleTrades] = useState(whaleRef.current);

  const mountedRef = useRef(true);
  const throttleRef = useRef(null);
  const minuteRef = useRef(null);
  const isFetchingInitialRef = useRef(true);
  const todayRef = useRef(getTodayStr());

  useEffect(() => {
    mountedRef.current = true;

    getDailyCVD('BTCUSDT').then((init) => {
      if (!mountedRef.current) return;
      cvdRef.current = init.initialCvd;
      buyRef.current = init.initialBuyVol;
      sellRef.current = init.initialSellVol;
      isFetchingInitialRef.current = false;

      setCvd(cvdRef.current);
      setBuyVolume(buyRef.current);
      setSellVolume(sellRef.current);
    });

    const conn = createReconnectingWS(
      WS_AGG_URL,
      (msg) => {
        if (!msg?.data) return;
        const data = msg.data;
        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const usdtVol = price * qty;

        // Midnight UTC reset
        const today = getTodayStr();
        if (today !== todayRef.current) {
          todayRef.current = today;
          cvdRef.current = 0;
          buyRef.current = 0;
          sellRef.current = 0;
          historyRef.current = [];
          whaleRef.current = [];
          volNodeRef.current.clear();
          localStorage.removeItem('hft_cvd_history');
          localStorage.removeItem('hft_vol_nodes');
          localStorage.removeItem('hft_whale_trades');
        }

        if (isFetchingInitialRef.current) return;

        // m=true → taker sell; m=false → taker buy
        const binPrice = Math.floor(price / 10) * 10;
        let node = volNodeRef.current.get(binPrice);
        if (!node) {
          node = { buy: 0, sell: 0 };
          volNodeRef.current.set(binPrice, node);
        }

        if (data.m) {
          cvdRef.current -= usdtVol;
          sessionRef.current -= usdtVol;
          sellRef.current += usdtVol;
          node.sell += usdtVol;
        } else {
          cvdRef.current += usdtVol;
          sessionRef.current += usdtVol;
          buyRef.current += usdtVol;
          node.buy += usdtVol;
        }

        if (usdtVol >= WHALE_USD_MIN) {
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          whaleRef.current = [
            {
              time: timeStr,
              price,
              qty,
              usdtVol,
              side: data.m ? 'SELL' : 'BUY',
              timestamp: data.T,
            },
            ...whaleRef.current,
          ].slice(0, WHALE_KEEP);
        }

        // One sample per minute for history series
        const currentMinute = Math.floor(data.T / 60000);
        if (minuteRef.current !== currentMinute) {
          minuteRef.current = currentMinute;
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
          });
          historyRef.current = [
            ...historyRef.current,
            { time: timeStr, cvd: cvdRef.current, price, timestamp: data.T },
          ];
        } else if (historyRef.current.length > 0) {
          const last = historyRef.current[historyRef.current.length - 1];
          last.cvd = cvdRef.current;
          last.price = price;
        }

        if (!throttleRef.current) {
          throttleRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setCvd(cvdRef.current);
              setSessionCvd(sessionRef.current);
              setBuyVolume(buyRef.current);
              setSellVolume(sellRef.current);
              setCvdHistory([...historyRef.current]);
              setWhaleTrades([...whaleRef.current]);
              setVolNodes(
                Array.from(volNodeRef.current.entries()).map(([p, v]) => ({
                  price: p,
                  ...v,
                }))
              );

              try {
                localStorage.setItem('hft_cvd_history_date', todayRef.current);
                localStorage.setItem(
                  'hft_cvd_history',
                  JSON.stringify(historyRef.current)
                );
                localStorage.setItem('hft_vol_nodes_date', todayRef.current);
                localStorage.setItem(
                  'hft_vol_nodes',
                  JSON.stringify(Array.from(volNodeRef.current.entries()))
                );
                localStorage.setItem('hft_whale_trades_date', todayRef.current);
                localStorage.setItem(
                  'hft_whale_trades',
                  JSON.stringify(whaleRef.current)
                );
              } catch (e) {
                console.error('Failed to persist HFT data:', e);
              }
            }
            throttleRef.current = null;
          }, CVD_UI_MS);
        }
      },
      setCvdStatus,
      mountedRef
    );

    return () => {
      mountedRef.current = false;
      if (throttleRef.current) clearTimeout(throttleRef.current);
      conn.close();
    };
  }, []);

  const totalVol = buyRef.current + sellRef.current;
  const volumeRatio = totalVol > 0 ? buyRef.current / totalVol : 0.5;

  return {
    cvd,
    sessionCvd,
    buyVolume,
    sellVolume,
    volumeRatio,
    cvdHistory,
    whaleTrades,
    cvdStatus,
    volNodes,
  };
}

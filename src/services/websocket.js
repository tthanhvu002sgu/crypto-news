import { useState, useEffect, useRef, useCallback } from 'react';
import { getDailyCVD } from './api';

// ─── Stream #1: BTC, ETH, SOL, LINK Ticker + BTC Mark Price (v6.0) ───────────────────────
const WS_TICKER_URL =
  'wss://fstream.binance.com/market/stream?streams=btcusdt@ticker/btcusdt@markPrice@1s/ethusdt@ticker/solusdt@ticker/linkusdt@ticker';

// ─── Stream #3: Aggregate Trades → CVD Calculator ─────────────────────────────
const WS_AGG_URL = 'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createReconnectingWS(url, onMessage, onStatusChange, mountedRef) {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    if (!mountedRef.current) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    onStatusChange?.('connecting');

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        onStatusChange?.('connected');
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try { onMessage(JSON.parse(event.data)); } catch { }
      };

      ws.onerror = () => { };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        onStatusChange?.('disconnected');
        reconnectTimer = setTimeout(() => { if (mountedRef.current) connect(); }, 4000);
      };
    } catch {
      onStatusChange?.('disconnected');
      reconnectTimer = setTimeout(() => { if (mountedRef.current) connect(); }, 4000);
    }
  }

  function close() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); }
  }

  connect();
  return { close };
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

  useEffect(() => {
    mountedRef.current = true;
    const conn = createReconnectingWS(
      WS_TICKER_URL,
      (msg) => {
        const { stream, data } = msg;
        if (stream === 'btcusdt@ticker') {
          setLivePrice(parseFloat(data.c));
          setLiveChange(parseFloat(data.P));
          setLiveHigh(parseFloat(data.h));
          setLiveLow(parseFloat(data.l));
          setLiveVolume(parseFloat(data.q));
        }
        if (stream === 'ethusdt@ticker') {
          setLiveEthPrice(parseFloat(data.c));
        }
        if (stream === 'solusdt@ticker') {
          setLiveSolPrice(parseFloat(data.c));
        }
        if (stream === 'linkusdt@ticker') {
          setLiveLinkPrice(parseFloat(data.c));
        }
        if (stream === 'btcusdt@markPrice@1s') {
          setLiveFunding(parseFloat(data.r));
        }
      },
      setWsStatus,
      mountedRef
    );
    return () => { mountedRef.current = false; conn.close(); };
  }, []);

  return { livePrice, liveChange, liveHigh, liveLow, liveVolume, liveFunding, liveEthPrice, liveSolPrice, liveLinkPrice, wsStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook 3: useCVDStream — Cumulative Volume Delta from aggTrade
// ═══════════════════════════════════════════════════════════════════════════════

export function useCVDStream() {
  // Thay đổi sang múi giờ chuẩn UTC (Midnight UTC Reset) thay vì múi giờ local
  const getTodayStr = () => new Date().toISOString().split('T')[0];
  
  const [cvd, setCvd] = useState(0);
  const [sessionCvd, setSessionCvd] = useState(0);
  const [buyVolume, setBuyVolume] = useState(0);
  const [sellVolume, setSellVolume] = useState(0);
  const [cvdStatus, setCvdStatus] = useState('connecting');

  const cvdRef = useRef(0);
  const sessionRef = useRef(0);
  const buyRef = useRef(0);
  const sellRef = useRef(0);

  const historyRef = useRef(() => {
    try {
      const savedDate = localStorage.getItem('hft_cvd_history_date');
      if (savedDate === getTodayStr()) {
        const saved = localStorage.getItem('hft_cvd_history');
        if (saved) {
          const parsed = JSON.parse(saved);
          // Không giới hạn 60 phút nữa, tải lại toàn bộ lịch sử trong ngày
          return parsed;
        }
      }
    } catch (e) {}
    return [];
  });
  if (typeof historyRef.current === 'function') historyRef.current = historyRef.current();
  
  const volNodeRef = useRef(() => {
    try {
      const savedDate = localStorage.getItem('hft_vol_nodes_date');
      if (savedDate === getTodayStr()) {
        const saved = localStorage.getItem('hft_vol_nodes');
        if (saved) return new Map(JSON.parse(saved));
      }
    } catch (e) {}
    return new Map();
  });
  if (typeof volNodeRef.current === 'function') volNodeRef.current = volNodeRef.current();

  const whaleRef = useRef(() => {
    try {
      const savedDate = localStorage.getItem('hft_whale_trades_date');
      if (savedDate === getTodayStr()) {
        const saved = localStorage.getItem('hft_whale_trades');
        return saved ? JSON.parse(saved) : [];
      }
    } catch (e) {}
    return [];
  });
  if (typeof whaleRef.current === 'function') whaleRef.current = whaleRef.current();

  const [cvdHistory, setCvdHistory] = useState(historyRef.current);
  const [volNodes, setVolNodes] = useState(Array.from(volNodeRef.current.entries()).map(([p, v]) => ({ price: p, ...v })));
  const [whaleTrades, setWhaleTrades] = useState(whaleRef.current);
  
  const mountedRef = useRef(true);
  const throttleRef = useRef(null);
  const minuteRef = useRef(null);
  const isFetchingInitialRef = useRef(true);
  const todayRef = useRef(getTodayStr());

  useEffect(() => {
    mountedRef.current = true;

    // Fetch initial CVD from start of day
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
        if (!msg || !msg.data) return;
        const data = msg.data;
        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const usdtVol = price * qty;

        // Reset history at midnight (UTC)
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

        // m=true → buyer is maker → taker SELLS → bearish → CVD decreases
        // m=false → seller is maker → taker BUYS → bullish → CVD increases
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

        // Track Whale Trades (Volume > $100k)
        if (usdtVol >= 100000) {
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const side = data.m ? 'SELL' : 'BUY';
          whaleRef.current = [
            { time: timeStr, price, qty, usdtVol, side, timestamp: data.T },
            ...whaleRef.current
          ].slice(0, 5000); 
        }

        // Sample history once per minute
        const currentMinute = Math.floor(data.T / 60000);
        if (minuteRef.current !== currentMinute) {
          minuteRef.current = currentMinute;
          const timeStr = new Date(data.T).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          
          // Giữ toàn bộ lịch sử trong ngày (lên tới 1440 điểm) thay vì chỉ lấy 60 điểm
          historyRef.current = [
            ...historyRef.current,
            { time: timeStr, cvd: cvdRef.current, price, timestamp: data.T }
          ];
        } else if (historyRef.current.length > 0) {
          historyRef.current[historyRef.current.length - 1].cvd = cvdRef.current;
          historyRef.current[historyRef.current.length - 1].price = price;
        }

        // Throttle React state updates & Persistence to every 500ms
        if (!throttleRef.current) {
          throttleRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setCvd(cvdRef.current);
              setSessionCvd(sessionRef.current);
              setBuyVolume(buyRef.current);
              setSellVolume(sellRef.current);
              setCvdHistory([...historyRef.current]);
              setWhaleTrades([...whaleRef.current]);
              setVolNodes(Array.from(volNodeRef.current.entries()).map(([p, v]) => ({ price: p, ...v })));
              
              // Persist to local storage safely
              try {
                localStorage.setItem('hft_cvd_history_date', todayRef.current);
                localStorage.setItem('hft_cvd_history', JSON.stringify(historyRef.current));
                
                localStorage.setItem('hft_vol_nodes_date', todayRef.current);
                localStorage.setItem('hft_vol_nodes', JSON.stringify(Array.from(volNodeRef.current.entries())));
                
                localStorage.setItem('hft_whale_trades_date', todayRef.current);
                localStorage.setItem('hft_whale_trades', JSON.stringify(whaleRef.current));
              } catch (e) {
                console.error("Failed to persist HFT data:", e);
              }
            }
            throttleRef.current = null;
          }, 500);
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

  const volumeRatio = (buyRef.current + sellRef.current) > 0
    ? buyRef.current / (buyRef.current + sellRef.current)
    : 0.5;

  return { cvd, sessionCvd, buyVolume, sellVolume, volumeRatio, cvdHistory, whaleTrades, cvdStatus, volNodes };
}



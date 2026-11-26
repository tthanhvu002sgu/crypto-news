import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeMacroCandles } from './engine.js';

const INTERVAL_MAP = Object.freeze({
  D: '1d',
  W: '1w',
  M: '1M',
});

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Fetch historical spot klines from Binance Vision API (pages backwards by 1,000 rows).
 * Uses Node.js built-in fetch (Node >= 18) with optional disk JSON cache.
 */
export async function fetchBinanceKlines({
  symbol = 'BTCUSDT',
  timeframe = 'W',
  limit = 10000,
  cacheDir = null,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  force = false,
} = {}) {
  const interval = INTERVAL_MAP[timeframe] || '1w';
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.trunc(parsedLimit) : 10000;
  const targetLimit = Math.max(2, Math.min(safeLimit, 10000));
  const cacheFile = cacheDir
    ? path.join(cacheDir, `${symbol}_${interval}_${targetLimit}.json`)
    : null;

  if (cacheFile && !force) {
    try {
      const stat = await fs.stat(cacheFile);
      if (Date.now() - stat.mtimeMs < cacheTtlMs) {
        const cachedRaw = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
        const normalized = normalizeMacroCandles(cachedRaw);
        if (normalized.length > 0) {
          return { candles: normalized, source: `cache:${cacheFile}` };
        }
      }
    } catch {
      // Cache miss or invalid file; fetch fresh data.
    }
  }

  const rows = [];
  let endTime;

  while (rows.length < targetLimit) {
    const batchLimit = Math.min(1000, targetLimit - rows.length);
    const url = new URL('https://data-api.binance.vision/api/v3/klines');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(batchLimit));
    if (endTime != null) url.searchParams.set('endTime', String(endTime));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let batch;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Binance API HTTP ${res.status} ${res.statusText}`);
      }
      batch = await res.json();
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.unshift(...batch);

    const earliestOpenTime = Number(batch[0]?.[0]);
    if (!Number.isFinite(earliestOpenTime) || batch.length < batchLimit) break;
    const nextEndTime = earliestOpenTime - 1;
    if (endTime != null && nextEndTime >= endTime) break;
    endTime = nextEndTime;
  }

  const now = Date.now();
  const uniqueRows = Array.from(new Map(rows.map((row) => [Number(row[0]), row])).values())
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .slice(-targetLimit);

  const candles = normalizeMacroCandles(
    uniqueRows.map((row) => ({
      time: new Date(Number(row[0])),
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
      closeTime: Number(row[6]),
      quoteVolume: parseFloat(row[7]),
      takerBuyQuoteVolume: parseFloat(row[10]),
      isClosed: Number(row[6]) < now,
    })),
  );

  if (cacheFile && candles.length > 0) {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify(candles, null, 2), 'utf8');
  }

  return { candles, source: `binance:${symbol}:${interval}` };
}

function parseTimestamp(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    // Support seconds (10 digits) or milliseconds (13 digits).
    return new Date(num < 1e12 ? num * 1000 : num);
  }
  return new Date(trimmed);
}

/**
 * Load OHLCV candles from a local .json or .csv file.
 * Supports:
 *  - JSON array of candle objects ({ time, open, high, low, close, volume })
 *  - JSON array of Binance raw kline arrays ([openTime, open, high, low, close, volume, closeTime, ...])
 *  - CSV with header containing time/date/timestamp, open, high, low, close, volume (optional)
 */
export async function loadCandlesFromFile(filePath) {
  const rawText = await fs.readFile(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    const parsed = JSON.parse(rawText);
    const list = Array.isArray(parsed) ? parsed : parsed?.candles;
    if (!Array.isArray(list)) {
      throw new Error(`Invalid JSON candle format in ${filePath}`);
    }
    const mapped = list.map((row) => {
      if (Array.isArray(row)) {
        const closeTime = row[6] != null ? Number(row[6]) : null;
        return {
          time: parseTimestamp(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5] ?? 0),
          closeTime,
          ...(closeTime == null ? { isClosed: true } : {}),
        };
      }
      return {
        ...row,
        time: row.time != null ? parseTimestamp(row.time) : parseTimestamp(row.timestamp ?? row.date),
      };
    });
    return normalizeMacroCandles(mapped);
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`CSV file has fewer than 2 rows: ${filePath}`);
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const colIndex = (aliases) => headers.findIndex((h) => aliases.includes(h));
  const timeIdx = colIndex(['time', 'timestamp', 'date', 'datetime', 'open_time']);
  const openIdx = colIndex(['open', 'o']);
  const highIdx = colIndex(['high', 'h']);
  const lowIdx = colIndex(['low', 'l']);
  const closeIdx = colIndex(['close', 'c']);
  const volIdx = colIndex(['volume', 'vol', 'v']);

  if (timeIdx < 0 || openIdx < 0 || highIdx < 0 || lowIdx < 0 || closeIdx < 0) {
    throw new Error(`CSV missing required columns (time, open, high, low, close) in ${filePath}`);
  }

  const parsedRows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    if (cols.length < 5) continue;
    parsedRows.push({
      time: parseTimestamp(cols[timeIdx]),
      open: Number(cols[openIdx]),
      high: Number(cols[highIdx]),
      low: Number(cols[lowIdx]),
      close: Number(cols[closeIdx]),
      volume: volIdx >= 0 ? Number(cols[volIdx] ?? 0) : 0,
      isClosed: true,
    });
  }
  return normalizeMacroCandles(parsedRows);
}

export async function saveCandlesToFile(filePath, candles) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    const header = 'time,open,high,low,close,volume,isClosed';
    const rows = candles.map((c) => [
      c.time instanceof Date ? c.time.toISOString() : new Date(c.time).toISOString(),
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume ?? 0,
      c.isClosed !== false,
    ].join(','));
    await fs.writeFile(filePath, [header, ...rows].join('\n'), 'utf8');
    return;
  }
  await fs.writeFile(filePath, JSON.stringify(candles, null, 2), 'utf8');
}

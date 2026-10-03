import axios from 'axios';
import { analyzeBtcOptions } from './optionsCalculations.js';

// --- Math Helpers ---
function normalPdf(x) {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// --- Deribit API Fetchers ---
export async function fetchDeribitBookSummary(currency = 'BTC') {
  try {
    const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
    const res = await axios.get(url);
    if (res.data && res.data.result) {
      return res.data.result;
    }
    return null;
  } catch (e) {
    console.error('[Deribit]', e.message);
    return null;
  }
}

export async function fetchDeribitTicker(instrumentName) {
  try {
    const url = `https://www.deribit.com/api/v2/public/ticker?instrument_name=${instrumentName}`;
    const res = await axios.get(url);
    if (res.data && res.data.result && res.data.result.greeks) {
      return res.data.result.greeks;
    }
    return null;
  } catch (e) {
    console.error('[Deribit]', e.message);
    return null;
  }
}

export async function fetchDeribitInstruments(currency = 'BTC') {
  try {
    const url = `https://www.deribit.com/api/v2/public/get_instruments?currency=${currency}&kind=option&expired=false`;
    const res = await axios.get(url);
    if (res.data && res.data.result) {
      return res.data.result;
    }
    return null;
  } catch (e) {
    console.error('[Deribit]', e.message);
    return null;
  }
}

const DERIBIT_MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

/**
 * Parse Deribit expiry date string like '4OCT26' or '28MAR26'
 * @param {string} dateStr
 * @returns {number|null} timestamp in ms (at 08:00 UTC)
 */
export function parseDeribitExpiryDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthStr = match[2].toUpperCase();
  const year = 2000 + parseInt(match[3], 10);
  const month = DERIBIT_MONTHS[monthStr];
  if (month === undefined || day < 1 || day > 31) return null;
  // Deribit expirations are at 08:00 UTC
  return Date.UTC(year, month, day, 8, 0, 0, 0);
}

export async function fetchDeribitOptionChain(currency = 'BTC') {
  try {
    const summaries = await fetchDeribitBookSummary(currency);
    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) return null;

    const spotPrice = parseFloat(summaries[0].estimated_delivery_price || summaries[0].underlying_price || 0);
    const nowMs = Date.now();
    const instruments = [];

    for (const item of summaries) {
      if (!item.open_interest || item.open_interest <= 0) continue;
      const { 
        instrument_name, 
        open_interest, 
        underlying_price, 
        estimated_delivery_price, 
        mark_iv, 
        volume 
      } = item;

      const parts = instrument_name.split('-');
      if (parts.length !== 4) continue;
      
      const strike = parseFloat(parts[2]);
      const type = parts[3]; // 'C' or 'P'
      
      let expTimestamp = item.expiration_timestamp;
      if (!expTimestamp) {
        expTimestamp = parseDeribitExpiryDate(parts[1]);
      }
      if (!expTimestamp) continue;

      const dteMs = expTimestamp - nowMs;
      const dte = dteMs / (1000 * 60 * 60 * 24);
      const T = dteMs / (1000 * 60 * 60 * 24 * 365.25); // in years
      
      const F = underlying_price || estimated_delivery_price || spotPrice;
      if (!F) continue;
      
      // Deribit provides mark_iv as percent (e.g. 42.5 = 42.5%), convert to decimal for Black-76
      const rawIv = mark_iv || 0;
      const iv = rawIv > 1 ? rawIv / 100 : rawIv;
      
      let gamma = 0;
      let delta = 0;
      
      if (T <= 0 || T < (1 / (24 * 365.25))) {
         // Expired or < 1 hour to expiry
         gamma = 0;
         delta = type === 'C' ? (F >= strike ? 1 : 0) : (F <= strike ? -1 : 0);
      } else if (iv > 0 && strike > 0 && F > 0) {
         const d1 = (Math.log(F / strike) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
         gamma = normalPdf(d1) / (F * iv * Math.sqrt(T));
         delta = type === 'C' ? normalCdf(d1) : normalCdf(d1) - 1;
      }
      
      instruments.push({
        instrumentName: instrument_name,
        strike,
        type,
        expirationTimestamp: expTimestamp,
        dte,
        openInterest: open_interest,
        underlyingPrice: F,
        markIv: rawIv,
        gamma,
        delta,
        volume24h: volume || 0,
      });
    }

    return {
      instruments,
      underlyingPrice: spotPrice,
      timestamp: Date.now()
    };
  } catch (e) {
    console.error('[Deribit]', e.message);
    return null;
  }
}

export async function getDeribitOptionsAnalysis(currency = 'BTC', dteFilter = null) {
  try {
    const chain = await fetchDeribitOptionChain(currency);
    if (!chain || !chain.instruments) return null;
    
    const analysis = analyzeBtcOptions(chain.instruments, chain.underlyingPrice, dteFilter);
    return {
      ...analysis,
      timestamp: Date.now()
    };
  } catch (e) {
    console.error('[Deribit]', e.message);
    return null;
  }
}

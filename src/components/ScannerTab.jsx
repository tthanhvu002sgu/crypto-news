/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Terminal */
import React, { useState, useEffect, useCallback } from 'react';
import { runFullScan } from '../services/coinScanner';
import { RefreshCw, Zap, ExternalLink, TrendingUp, TrendingDown, ShieldCheck, Clock, CheckCircle2 } from 'lucide-react';

const fmtUsd = (n) => {
  if (n == null) return '---';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtCvd = (n) => {
  if (n == null || n === 0) return '---';
  const sign = n > 0 ? '+' : '';
  if (Math.abs(n) >= 1e9) return `${sign}$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${sign}$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${sign}$${(n / 1e3).toFixed(0)}K`;
  return `${sign}$${n.toFixed(0)}`;
};

export default function ScannerTab({ data = {}, etfHistory = [] }) {
  const [scanResult, setScanResult] = useState({ topBuy: [], topSell: [], scannedCount: 0, qualifiedCount: 0, timestamp: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(3600); // 60 mins countdown
  const [activeDirection, setActiveDirection] = useState('BUY'); // 'BUY' | 'SELL'

  // Macro context evaluation
  const macroContext = {
    isBtcBullish: (data.btcChange24h ?? 0) > 0,
    isEtfInflow: etfHistory.length > 0 ? (etfHistory[0]?.netFlow ?? 0) > 0 : false,
  };

  const executeScan = useCallback(async (force = false) => {
    setIsScanning(true);
    try {
      const res = await runFullScan(macroContext, force);
      setScanResult(res);
      setSecondsUntilRefresh(3600);
    } catch (e) {
      console.error('[ScannerTab] Scan error:', e);
    } finally {
      setIsScanning(false);
    }
  }, [macroContext.isBtcBullish, macroContext.isEtfInflow]);

  // Initial load
  useEffect(() => {
    executeScan(false);
  }, []);

  // Countdown timer & auto-refresh
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) {
          executeScan(true);
          return 3600;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [executeScan]);

  const formatTimeRemaining = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentCoins = activeDirection === 'BUY' 
    ? (scanResult.topBuy || []) 
    : (scanResult.topSell || []);

  return (
    <div className="scanner-tab-container hallmark-scanner-container font-mono">
      {/* ── HEADER CONTROL BAR ────────────────────────────────────────────── */}
      <div className="scanner-header-card glass-panel">
        <div className="scanner-header-left">
          <div className="scanner-title-row">
            <span className="scanner-icon-badge">
              <Zap size={18} className="text-amber-400" />
            </span>
            <div>
              <h2 className="scanner-title">SCANNER — NHÂN DUYÊN 2 CHIỀU (BUY &amp; SELL)</h2>
              <p className="scanner-subtitle">
                Lọc Top Coin theo <strong>Vol 30D + Vol Consistency (volCV) + Funding Rate + MCap + Multi-TF</strong>. Chỉ giữ coin vượt Quality Gate.
              </p>
            </div>
          </div>
        </div>

        <div className="scanner-header-right">
          <div className="scanner-timer-badge">
            <Clock size={13} className="text-emerald-400" />
            <span>Tự động quét sau: <strong className="text-contrast">{formatTimeRemaining(secondsUntilRefresh)}</strong></span>
          </div>

          <button
            className={`scanner-refresh-btn ${isScanning ? 'is-loading' : ''}`}
            onClick={() => executeScan(true)}
            disabled={isScanning}
          >
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
            <span>{isScanning ? 'Đang Lọc Dữ Liệu...' : 'Quét Ngay'}</span>
          </button>
        </div>
      </div>

      {/* ── DUAL DIRECTION TAB SWITCHER ─────────────────────────────────────── */}
      <div className="scanner-direction-bar">
        <div className="direction-toggle-group">
          <button
            onClick={() => setActiveDirection('BUY')}
            className={`btn-direction-tab ${activeDirection === 'BUY' ? 'active buy-active' : ''}`}
          >
            <TrendingUp size={16} />
            <span>TOP LONG (BUY)</span>
            <span className="chip-count buy">
              {scanResult.topBuy?.length || 0} COIN
            </span>
          </button>

          <button
            onClick={() => setActiveDirection('SELL')}
            className={`btn-direction-tab ${activeDirection === 'SELL' ? 'active sell-active' : ''}`}
          >
            <TrendingDown size={16} />
            <span>TOP SHORT (SELL)</span>
            <span className="chip-count sell">
              {scanResult.topSell?.length || 0} COIN
            </span>
          </button>
        </div>
      </div>

      {/* ── MAIN SCANNER TABLE ──────────────────────────────────────── */}
      <div className="scanner-table-wrapper glass-panel">
        {isScanning && currentCoins.length === 0 ? (
          <div className="scanner-skeleton-loader">
            <RefreshCw size={24} className="spin text-amber-400" />
            <p className="loading-text">Đang tính toán VolCV 30D, Funding Rate &amp; Multi-TF cho các cặp giao dịch...</p>
          </div>
        ) : currentCoins.length === 0 ? (
          <div className="scanner-empty-state">
            <ShieldCheck size={36} className="empty-icon text-amber-400" />
            <h4 className="empty-heading font-bold">Không có coin nào đạt Quality Gate cho chiều {activeDirection === 'BUY' ? 'MUA (LONG)' : 'BÁN (SHORT)'} lúc này.</h4>
            <p className="empty-sub">
              Bộ lọc giữ kỷ luật nghiêm ngặt: Thà không báo tín hiệu chứ không ép đưa coin kém chất lượng vào Top để bảo vệ tài khoản cho Trader.
            </p>
          </div>
        ) : (
          <div className="table-responsive-scroll">
            <table className="scanner-table">
              <thead>
                <tr>
                  <th style={{ width: '6%' }}>HẠNG</th>
                  <th style={{ width: '14%' }}>COIN / CHART</th>
                  <th style={{ width: '15%' }}>VỐN HÓA &amp; VOL 30D</th>
                  <th style={{ width: '13%' }}>SPREAD &amp; FUNDING</th>
                  <th style={{ width: '15%' }}>DÒNG TIỀN (CVD 24H)</th>
                  <th style={{ width: '14%' }}>KỸ THUẬT (4H &amp; 1D)</th>
                  <th style={{ width: '11%' }}>ĐIỂM TÍN HIỆU</th>
                  <th style={{ width: '12%' }}>THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {currentCoins.map((coin, index) => {
                  const rank = index + 1;
                  const is4hUptrend = coin.ema21 && coin.ema55 && coin.ema21 > coin.ema55;
                  const spreadText = coin.spreadPct != null ? `${coin.spreadPct.toFixed(3)}%` : '---';
                  const isTightSpread = coin.spreadPct != null && coin.spreadPct <= 0.05;
                  const fundingText = coin.fundingRate != null ? `${coin.fundingRate > 0 ? '+' : ''}${coin.fundingRate.toFixed(4)}%` : '---';
                  const tvChartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`;

                  return (
                    <tr key={coin.symbol} className={`scanner-row rank-${rank}`}>
                      {/* Hạng */}
                      <td className="td-rank">
                        <span className={`rank-badge rank-${rank}`}>#{rank}</span>
                      </td>

                      {/* Coin & TradingView One-Click Link */}
                      <td className="td-coin">
                        <a
                          href={tvChartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tv-link-group"
                          title={`Mở Chart ${coin.symbol} trên TradingView`}
                        >
                          <div className="coin-name-group">
                            <span className="symbol-text">{coin.baseAsset}</span>
                            <span className="pair-text">/USDT</span>
                            <ExternalLink size={12} className="tv-icon" />
                          </div>
                        </a>
                        <div className="price-group">
                          <span className="price-text">
                            ${coin.price < 1 ? coin.price.toFixed(4) : coin.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                          <span className={`change-text ${coin.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {coin.priceChange24h >= 0 ? '+' : ''}{coin.priceChange24h.toFixed(2)}%
                          </span>
                        </div>
                      </td>

                      {/* Vol 30d, MCap & VolCV */}
                      <td className="td-vol">
                        <div className="vol-val">
                          <span className="label-sub">MCap: </span><strong>{fmtUsd(coin.marketCap)}</strong>
                        </div>
                        <div className="surge-val">
                          <span className="label-sub">Vol 30D: </span>
                          <strong className="vol-30d-num">{fmtUsd(coin.vol30d)}</strong>
                        </div>
                        <div className="volcv-row">
                          <span className={`volcv-badge ${coin.volCV <= 0.6 ? 'volcv-steady' : 'volcv-normal'}`}>
                            VolCV: {coin.volCV} {coin.volCV <= 0.6 ? '✓' : ''}
                          </span>
                        </div>
                      </td>

                      {/* Futures Spread & Funding Rate */}
                      <td className="td-spread">
                        <div className={`spread-val ${isTightSpread ? 'text-emerald-400' : coin.spreadPct > 0.15 ? 'text-rose-400' : 'text-neutral'}`}>
                          Spread: <strong>{spreadText}</strong>
                        </div>
                        <div className="funding-row">
                          <span className={`funding-val ${
                            activeDirection === 'BUY' && coin.fundingRate < -0.02 ? 'text-emerald-400 font-extrabold' :
                            activeDirection === 'BUY' && coin.fundingRate > 0.04 ? 'text-rose-400' :
                            activeDirection === 'SELL' && coin.fundingRate > 0.04 ? 'text-rose-400 font-extrabold' : 'text-neutral'
                          }`}>
                            Funding: {fundingText}
                          </span>
                        </div>
                      </td>

                      {/* Money Flow / CVD & Taker Ratio */}
                      <td className="td-cvd">
                        <div className="cvd-main">
                          <span className="label-sub">CVD 24h: </span>
                          <strong className={`cvd-val ${coin.cvd24h > 0 ? 'text-emerald-400' : coin.cvd24h < 0 ? 'text-rose-400' : 'text-neutral'}`}>
                            {fmtCvd(coin.cvd24h)}
                          </strong>
                        </div>
                        <div className="buy-ratio-bar-wrap">
                          <div className="buy-ratio-text">
                            <span className="buy-percent">Mua: <strong>{coin.takerBuyRatio}%</strong></span>
                            <span className="sell-percent">Bán: <strong>{100 - coin.takerBuyRatio}%</strong></span>
                          </div>
                          <div className="buy-ratio-track">
                            <div className="buy-ratio-fill" style={{ width: `${coin.takerBuyRatio}%` }} />
                          </div>
                        </div>
                      </td>

                      {/* Technicals (4h + Daily Multi-TF) */}
                      <td className="td-ta">
                        <div className="ta-item">
                          <span className="label-sub">EMA 4h: </span>
                          <span className={`val-ta ${is4hUptrend ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {is4hUptrend ? '▲ BULL (21>55)' : '▼ BEAR (21<55)'}
                          </span>
                        </div>
                        <div className="ta-item">
                          <span className="label-sub">Daily 1D: </span>
                          <span className={`val-ta ${coin.isDailyUptrend ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {coin.isDailyUptrend ? '▲ BULL 1D' : '▼ BEAR 1D'}
                          </span>
                        </div>
                        <div className="ta-item">
                          <span className="label-sub">RSI (14): </span>
                          <span className={`val-ta ${coin.rsi14 >= 40 && coin.rsi14 <= 60 ? 'text-cyan-400' : coin.rsi14 > 70 ? 'text-rose-400' : 'text-neutral'}`}>
                            {coin.rsi14} {coin.rsi14 >= 40 && coin.rsi14 <= 60 ? '🎯' : ''}
                          </span>
                        </div>
                      </td>

                      {/* Score */}
                      <td className="td-score">
                        <div className="score-badge-wrap">
                          <span className="score-val font-extrabold" style={{ color: coin.statusColor }}>
                            {coin.score}<small className="score-max">/25</small>
                          </span>
                          <span className="status-pill" style={{ backgroundColor: `${coin.statusColor}18`, color: coin.statusColor, borderColor: coin.statusColor }}>
                            {coin.status}
                          </span>
                        </div>
                        <div className="score-bar-bg">
                          <div
                            className="score-bar-fill"
                            style={{
                              width: `${Math.min(100, (coin.score / 25) * 100)}%`,
                              backgroundColor: coin.statusColor,
                            }}
                          />
                        </div>
                      </td>

                      {/* Action & Chart Link */}
                      <td className="td-action">
                        <a
                          href={tvChartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tv-btn-action font-mono"
                        >
                          <span>Mở Chart</span>
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── FOOTER GUIDANCE ──────────────────────────────────────────────── */}
      <div className="scanner-footer-note glass-panel">
        <div className="note-header font-mono">
          <CheckCircle2 size={15} className="text-emerald-400" />
          <span className="note-title">NGUYÊN TẮC SWING TRADING CHÍNH XÁC CAO:</span>
        </div>
        <p className="note-body">
          • <strong>Chất Lượng Over Số Lượng</strong>: Hệ thống có thể trả về ít hơn 5 coin nếu các coin khác không vượt qua <strong>Quality Gate (Score &ge; 10/25, VolCV &le; 1.3, Spread &le; 0.15%)</strong>.<br />
          • <strong>Volume Consistency (VolCV &le; 0.6)</strong>: Đảm bảo volume giao dịch bền vững trong suốt 30 ngày, loại bỏ triệt me coin bị bơm thổi ảo 1-2 ngày rồi xả.<br />
          • <strong>Funding Rate &amp; Crowded Trade</strong>: Tránh vào Long khi Funding quá dương (&gt;0.04%) hoặc Short khi Funding quá âm (&lt;-0.03%) để né cú Squeeze.<br />
          • <strong>Multi-Timeframe Alignment</strong>: Tín hiệu mạnh nhất xuất hiện khi cả khung <strong>4H và Daily</strong> cùng đồng thuận theo 1 hướng trend.
        </p>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { runFullScan } from '../services/coinScanner';
import { RefreshCw, Zap, ExternalLink, TrendingUp, TrendingDown, ShieldCheck } from 'lucide-react';

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

  const lastUpdatedStr = scanResult.timestamp
    ? new Date(scanResult.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : 'Chưa quét';

  const currentCoins = activeDirection === 'BUY' 
    ? (scanResult.topBuy || []) 
    : (scanResult.topSell || []);

  return (
    <div className="scanner-tab-container font-mono">
      {/* ── HEADER CONTROL BAR ────────────────────────────────────────────── */}
      <div className="scanner-header-card glass-panel">
        <div className="scanner-header-left">
          <div className="scanner-title-row">
            <span className="scanner-icon-badge">
              <Zap size={18} className="text-amber" />
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
            <span className="timer-dot"></span>
            <span>Refresh sau: <strong>{formatTimeRemaining(secondsUntilRefresh)}</strong></span>
          </div>

          <button
            className={`scanner-refresh-btn ${isScanning ? 'is-loading' : ''}`}
            onClick={() => executeScan(true)}
            disabled={isScanning}
          >
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
            <span>{isScanning ? 'Đang Lọc 2 Chiều...' : 'Quét Ngay'}</span>
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
            <span>🟢 TOP LONG (BUY)</span>
            <span className="chip-count buy">
              {scanResult.topBuy?.length || 0} COIN
            </span>
          </button>

          <button
            onClick={() => setActiveDirection('SELL')}
            className={`btn-direction-tab ${activeDirection === 'SELL' ? 'active sell-active' : ''}`}
          >
            <TrendingDown size={16} />
            <span>🔴 TOP SHORT (SELL)</span>
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
            <RefreshCw size={24} className="spin text-amber" />
            <p>Đang tính toán VolCV 30D, Funding Rate &amp; Multi-TF 50 coins...</p>
          </div>
        ) : currentCoins.length === 0 ? (
          <div className="scanner-empty-state">
            <ShieldCheck size={32} className="text-amber-400/80 mb-1" />
            <p className="font-bold text-empty-heading">Không có coin nào đạt Quality Gate cho chiều {activeDirection === 'BUY' ? 'MUA (LONG)' : 'BÁN (SHORT)'} lúc này.</p>
            <p className="text-xs text-empty-sub max-w-md text-center">
              Bộ lọc giữ kỷ luật nghiêm ngặt: Thà không báo tín hiệu chứ không ép đưa coin kém chất lượng vào Top để bảo vệ tài khoản cho Trader.
            </p>
          </div>
        ) : (
          <table className="scanner-table">
            <thead>
              <tr>
                <th style={{ width: '55px' }}>HẠNG</th>
                <th style={{ width: '160px' }}>COIN / TRADINGVIEW</th>
                <th style={{ width: '140px' }}>VỐN HÓA &amp; VOL 30D</th>
                <th style={{ width: '135px' }}>SPREAD &amp; FUNDING</th>
                <th style={{ width: '155px' }}>DÒNG TIỀN (CVD 24H)</th>
                <th style={{ width: '165px' }}>KỸ THUẬT (4H &amp; DAILY)</th>
                <th style={{ width: '120px' }}>ĐIỂM TÍN HIỆU</th>
                <th>TÍN HIỆU NHÂN DUYÊN NỔI BẬT</th>
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
                        title={`1-Click mở Chart ${coin.symbol} trên TradingView`}
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
                        <span className={`change-text ${coin.priceChange24h >= 0 ? 'text-emerald' : 'text-rose'}`}>
                          {coin.priceChange24h >= 0 ? '+' : ''}{coin.priceChange24h.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Vol 30d, MCap & VolCV */}
                    <td className="td-vol">
                      <div className="vol-val font-bold">
                        <span className="label-sub">MCap: </span>{fmtUsd(coin.marketCap)}
                      </div>
                      <div className="surge-val mt-0.5">
                        <span className="label-sub">Vol 30D: </span>
                        <span className="vol-30d-num font-bold">{fmtUsd(coin.vol30d)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          coin.volCV <= 0.6 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40' : 'volcv-badge-normal'
                        }`}>
                          VolCV: {coin.volCV} {coin.volCV <= 0.6 ? '✓' : ''}
                        </span>
                      </div>
                    </td>

                    {/* Futures Spread & Funding Rate */}
                    <td className="td-spread">
                      <div className={`val-bold ${isTightSpread ? 'text-emerald' : coin.spreadPct > 0.15 ? 'text-rose' : 'text-neutral-spread'}`}>
                        Spread: {spreadText}
                      </div>
                      <div className="mt-1">
                        <span className={`text-[11px] font-bold ${
                          activeDirection === 'BUY' && coin.fundingRate < -0.02 ? 'text-emerald font-extrabold' :
                          activeDirection === 'BUY' && coin.fundingRate > 0.04 ? 'text-rose' :
                          activeDirection === 'SELL' && coin.fundingRate > 0.04 ? 'text-rose font-extrabold' : 'funding-val-neutral'
                        }`}>
                          Funding: {fundingText}
                        </span>
                      </div>
                    </td>

                    {/* Money Flow / CVD & Taker Ratio */}
                    <td className="td-cvd">
                      <div className="cvd-main">
                        <span className="label-sub">CVD 24h: </span>
                        <span className={`val-bold ${coin.cvd24h > 0 ? 'text-emerald' : coin.cvd24h < 0 ? 'text-rose' : 'text-neutral-spread'}`}>
                          {fmtCvd(coin.cvd24h)}
                        </span>
                      </div>
                      <div className="buy-ratio-bar-wrap mt-1">
                        <div className="buy-ratio-text flex justify-between text-[10px]">
                          <span>Mua: <strong>{coin.takerBuyRatio}%</strong></span>
                          <span>Bán: <strong>{100 - coin.takerBuyRatio}%</strong></span>
                        </div>
                        <div className="buy-ratio-track mt-0.5">
                          <div className="buy-ratio-fill" style={{ width: `${coin.takerBuyRatio}%` }} />
                        </div>
                      </div>
                    </td>

                    {/* Technicals (4h + Daily Multi-TF) */}
                    <td className="td-ta">
                      <div className="ta-item">
                        <span className="label-sub">EMA 4h: </span>
                        <span className={`val-ta font-bold ${is4hUptrend ? 'text-emerald' : 'text-rose'}`}>
                          {is4hUptrend ? '▲ BULL (21>55)' : '▼ BEAR (21<55)'}
                        </span>
                      </div>
                      <div className="ta-item mt-0.5">
                        <span className="label-sub">Daily: </span>
                        <span className={`val-ta font-bold ${coin.isDailyUptrend ? 'text-emerald' : 'text-rose'}`}>
                          {coin.isDailyUptrend ? '▲ BULL 1D' : '▼ BEAR 1D'}
                        </span>
                      </div>
                      <div className="ta-item mt-0.5">
                        <span className="label-sub">RSI (14): </span>
                        <span className={`val-ta ${coin.rsi14 >= 40 && coin.rsi14 <= 60 ? 'text-cyan font-bold' : coin.rsi14 > 70 ? 'text-rose' : 'val-rsi-neutral'}`}>
                          {coin.rsi14} {coin.rsi14 >= 40 && coin.rsi14 <= 60 ? '🎯' : ''}
                        </span>
                      </div>
                    </td>

                    {/* Score */}
                    <td className="td-score">
                      <div className="score-badge-wrap">
                        <span className="score-val font-extrabold" style={{ color: coin.statusColor }}>
                          {coin.score}<small>/25</small>
                        </span>
                        <span className="status-pill font-bold" style={{ backgroundColor: `${coin.statusColor}20`, color: coin.statusColor, borderColor: coin.statusColor }}>
                          {coin.status}
                        </span>
                      </div>
                      <div className="score-bar-bg mt-1">
                        <div
                          className="score-bar-fill"
                          style={{
                            width: `${Math.min(100, (coin.score / 25) * 100)}%`,
                            backgroundColor: coin.statusColor,
                          }}
                        />
                      </div>
                    </td>

                    {/* Tags & 1-Click TradingView Button */}
                    <td className="td-tags">
                      <div className="tags-flex align-center flex-wrap gap-1">
                        {coin.tags.map((tag, i) => (
                          <span key={i} className={`scan-tag tag-${tag.type}`}>
                            {tag.label}
                          </span>
                        ))}
                        <a
                          href={tvChartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tv-btn-badge ml-auto"
                        >
                          Chart ↗
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── FOOTER GUIDANCE ──────────────────────────────────────────────── */}
      <div className="scanner-footer-note glass-panel">
        <div className="note-title">💡 NGUYÊN TẮC SWING TRADING CHÍNH XÁC CAO:</div>
        <p>
          • <strong>Chất Lượng Over Số Lượng</strong>: Hệ thống có thể trả về ít hơn 5 coin nếu các coin khác không vượt qua <strong>Quality Gate (Score &ge; 10/25, VolCV &le; 1.3, Spread &le; 0.15%)</strong>.<br />
          • <strong>Volume Consistency (VolCV &le; 0.6)</strong>: Đảm bảo volume giao dịch bền vững trong suốt 30 ngày, loại bỏ triệt để coin bị bơm thổi ảo 1-2 ngày rồi xả.<br />
          • <strong>Funding Rate &amp; Crowded Trade</strong>: Tránh vào Long khi Funding quá dương (&gt;0.04%) hoặc Short khi Funding quá âm (&lt;-0.03%) để né cú Squeeze.<br />
          • <strong>Multi-Timeframe Alignment</strong>: Tín hiệu mạnh nhất xuất hiện khi cả khung <strong>4H và Daily</strong> cùng đồng thuận theo 1 hướng trend.
        </p>
      </div>
    </div>
  );
}

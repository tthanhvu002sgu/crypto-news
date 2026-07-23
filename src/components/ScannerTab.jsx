import React, { useState, useEffect, useCallback } from 'react';
import { runFullScan } from '../services/coinScanner';
import { RefreshCw, Zap, ExternalLink } from 'lucide-react';

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
  const [scanResult, setScanResult] = useState({ top5: [], scannedCount: 0, timestamp: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(3600); // 60 mins countdown

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
      setSecondsUntilRefresh(3600); // Reset timer to 60 minutes
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

  // 1-hour interval auto refresh + 1-second countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilRefresh(prev => {
        if (prev <= 1) {
          executeScan(true); // Auto trigger scan when countdown hits zero
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
              <h2 className="scanner-title">SCANNER — TOP 5 COIN NHÂN DUYÊN SWING</h2>
              <p className="scanner-subtitle">
                Lọc Top 50 coin theo <strong>Volume Bền Vững 30 Ngày</strong> (chống coin bơm ảo ngắn hạn) → 1-Click mở Chart TradingView.
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
            <span>{isScanning ? 'Đang Lọc Vol 30D...' : 'Quét Ngay'}</span>
          </button>
        </div>
      </div>

      {/* ── MACRO CONTEXT STRIP ───────────────────────────────────────────── */}
      <div className="scanner-macro-bar glass-panel">
        <div className="macro-item">
          <span className="macro-label">Bối Cảnh BTC:</span>
          <span className={`macro-val ${data.btcChange24h >= 0 ? 'text-emerald' : 'text-rose'}`}>
            BTC ${Number(data.btcPrice || 0).toLocaleString()} ({data.btcChange24h >= 0 ? '+' : ''}{Number(data.btcChange24h || 0).toFixed(2)}%)
          </span>
        </div>
        <div className="macro-divider">|</div>
        <div className="macro-item">
          <span className="macro-label">ETF Net Flow (Dù):</span>
          <span className={`macro-val ${(etfHistory[0]?.netFlow ?? 0) >= 0 ? 'text-emerald' : 'text-rose'}`}>
            {(etfHistory[0]?.netFlow ?? 0) >= 0 ? '+' : ''}${((etfHistory[0]?.netFlow ?? 0)).toFixed(1)}M
          </span>
        </div>
        <div className="macro-divider">|</div>
        <div className="macro-item">
          <span className="macro-label">Fear &amp; Greed:</span>
          <span className="macro-val text-amber">{data.fngValue ?? '---'} ({data.fngClass ?? 'Neutral'})</span>
        </div>
        <div className="macro-divider">|</div>
        <div className="macro-item">
          <span className="macro-label">Lần cuối quét:</span>
          <span className="macro-val text-slate-400">{lastUpdatedStr} (Quét {scanResult.scannedCount} coins vol 30d)</span>
        </div>
      </div>

      {/* ── MAIN TOP 5 SCANNER TABLE ──────────────────────────────────────── */}
      <div className="scanner-table-wrapper glass-panel">
        {isScanning && scanResult.top5.length === 0 ? (
          <div className="scanner-skeleton-loader">
            <RefreshCw size={24} className="spin text-amber" />
            <p>Đang tính Volume 30 Ngày &amp; phân tích Orderbook Spread 50 coins...</p>
          </div>
        ) : scanResult.top5.length === 0 ? (
          <div className="scanner-empty-state">
            <p>Chưa có dữ liệu scan. Bấm "Quét Ngay" để khởi chạy.</p>
          </div>
        ) : (
          <table className="scanner-table">
            <thead>
              <tr>
                <th style={{ width: '55px' }}>HẠNG</th>
                <th style={{ width: '160px' }}>COIN / TRADINGVIEW</th>
                <th style={{ width: '125px' }}>ĐIỂM CHẤM</th>
                <th style={{ width: '125px' }}>FUTURES SPREAD</th>
                <th style={{ width: '155px' }}>DÒNG TIỀN (CVD 24H)</th>
                <th style={{ width: '155px' }}>VOLUME 24H / VOL 30D</th>
                <th style={{ width: '155px' }}>KỸ THUẬT 4H (EMA / RSI)</th>
                <th>TÍN HIỆU NHÂN DUYÊN NỔI BẬT</th>
              </tr>
            </thead>
            <tbody>
              {scanResult.top5.map((coin, index) => {
                const rank = index + 1;
                const isUptrend = coin.ema21 && coin.ema55 && coin.ema21 > coin.ema55;
                const spreadText = coin.spreadPct != null ? `${coin.spreadPct.toFixed(3)}%` : '---';
                const isTightSpread = coin.spreadPct != null && coin.spreadPct <= 0.05;
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
                        <span className="price-text">${coin.price < 1 ? coin.price.toFixed(4) : coin.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        <span className={`change-text ${coin.priceChange24h >= 0 ? 'text-emerald' : 'text-rose'}`}>
                          {coin.priceChange24h >= 0 ? '+' : ''}{coin.priceChange24h.toFixed(2)}%
                        </span>
                      </div>
                    </td>

                    {/* Score */}
                    <td className="td-score">
                      <div className="score-badge-wrap">
                        <span className="score-val" style={{ color: coin.statusColor }}>
                          {coin.score}<small>/20</small>
                        </span>
                        <span className="status-pill" style={{ backgroundColor: `${coin.statusColor}20`, color: coin.statusColor, borderColor: coin.statusColor }}>
                          {coin.status}
                        </span>
                      </div>
                      <div className="score-bar-bg">
                        <div
                          className="score-bar-fill"
                          style={{
                            width: `${Math.min(100, (coin.score / 20) * 100)}%`,
                            backgroundColor: coin.statusColor,
                          }}
                        />
                      </div>
                    </td>

                    {/* Futures Spread */}
                    <td className="td-spread">
                      <div className={`val-bold ${isTightSpread ? 'text-emerald' : coin.spreadPct > 0.15 ? 'text-rose' : 'text-slate'}`}>
                        {spreadText}
                      </div>
                      <div className="label-sub">
                        {isTightSpread ? '⚡ Mỏng (Thanh khoản)' : coin.spreadPct > 0.15 ? '⚠️ Rộng (Slippage)' : 'Bình thường'}
                      </div>
                    </td>

                    {/* Money Flow / CVD */}
                    <td className="td-cvd">
                      <div className="cvd-main">
                        <span className="label-sub">CVD 24h:</span>
                        <span className={`val-bold ${coin.cvd24h > 0 ? 'text-emerald' : coin.cvd24h < 0 ? 'text-rose' : 'text-slate'}`}>
                          {fmtCvd(coin.cvd24h)}
                        </span>
                      </div>
                      <div className="buy-ratio-bar-wrap">
                        <div className="buy-ratio-text">
                          <span>Phe mua: <strong>{coin.takerBuyRatio}%</strong></span>
                        </div>
                        <div className="buy-ratio-track">
                          <div className="buy-ratio-fill" style={{ width: `${coin.takerBuyRatio}%` }} />
                        </div>
                      </div>
                    </td>

                    {/* Volume 24h & Vol 30D */}
                    <td className="td-vol">
                      <div className="vol-val">24h: {fmtUsd(coin.volume24h)}</div>
                      <div className="surge-val">
                        <span className="label-sub">Vol 30D: </span>
                        <span className="text-slate-300 font-bold">{fmtUsd(coin.vol30d)}</span>
                        <span className={`badge-surge ml-1 ${coin.volSurgeRatio >= 1.5 ? 'surge-high' : 'surge-normal'}`}>
                          {coin.volSurgeRatio}x 30d
                        </span>
                      </div>
                    </td>

                    {/* Technicals */}
                    <td className="td-ta">
                      <div className="ta-item">
                        <span className="label-sub">EMA 4h:</span>
                        <span className={`val-ta ${isUptrend ? 'text-emerald' : 'text-rose'}`}>
                          {isUptrend ? '▲ BULL (21>55)' : '▼ BEAR (21<55)'}
                        </span>
                      </div>
                      <div className="ta-item">
                        <span className="label-sub">RSI (14):</span>
                        <span className={`val-ta ${coin.rsi14 >= 40 && coin.rsi14 <= 60 ? 'text-cyan font-bold' : coin.rsi14 > 70 ? 'text-rose' : 'text-slate'}`}>
                          {coin.rsi14} {coin.rsi14 >= 40 && coin.rsi14 <= 60 ? '🎯' : ''}
                        </span>
                      </div>
                    </td>

                    {/* Tags & 1-Click TradingView Button */}
                    <td className="td-tags">
                      <div className="tags-flex align-center">
                        {coin.tags.map((tag, i) => (
                          <span key={i} className={`scan-tag tag-${tag.type}`}>
                            {tag.label}
                          </span>
                        ))}
                        <a
                          href={tvChartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tv-btn-badge"
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
        <div className="note-title">💡 GHI CHÚ GIAO DỊCH SWING:</div>
        <p>
          • <strong>1-Click Mở Chart</strong>: Nhấp thẳng vào <strong>Tên Coin</strong> hoặc nút <strong>[Chart ↗]</strong> để soi nến chi tiết trên TradingView.<br />
          • <strong>Volume 30D &amp; Spread Mỏng</strong>: Đã được lọc tự động để chống coin ảo/pump ngắn hạn và trượt giá.<br />
          • Vùng vào lệnh Swing đẹp nhất: Khi <strong>Vol 30D lớn (&gt;$300M)</strong> + <strong>RSI 14 (4h) ở vùng 40-55 (Pullback)</strong> + <strong>CVD Mua ròng dương</strong> + <strong>Giá &gt; EMA 21 (4h)</strong>.
        </p>
      </div>
    </div>
  );
}

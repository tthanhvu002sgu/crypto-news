import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ExternalLink, TrendingUp, Filter } from 'lucide-react';
import { getPolymarketTopMarkets } from '../services/api';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';

const categorizeMarket = (m) => {
  const q = (m.question || '').toLowerCase();
  const slug = (m.slug || '').toLowerCase();
  const text = ` ${q} ${slug} `;

  // 1. Check sports / soccer
  const sportsKeywords = ['soccer', 'football', 'world cup', 'fifa', 'copa', 'euro', 'nba', 'nfl', 'mlb', 'nhl', 'tennis', 'ufc', 'champions league', 'premier league', 'super bowl', ' vs ', ' vs.', 'match', 'league', ' fc ', 'real madrid', 'barcelona', 'manchester', 'liverpool', 'arsenal', 'chelsea', 'bayern', 'psg'];
  if (sportsKeywords.some(kw => text.includes(kw))) return 'sports';

  // 2. Crypto & Bitcoin
  const cryptoKeywords = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto', 'token', 'nft', 'binance', 'coinbase', 'etf', 'market cap', 'fdv', 'memecoin', 'doge', 'pepe', 'xrp', 'airdrop', 'cardano', 'sui', 'aptos', 'tether', 'usdc'];
  if (cryptoKeywords.some(kw => text.includes(kw))) return 'crypto';

  // 3. Economy & Fed
  const econKeywords = ['fed ', 'rate cut', 'interest rate', 'inflation', 'cpi', 'recession', 'gdp', 'unemployment', 'tariff', 'treasury', 'economy', 'dollar', 'dxy', 'tax', 'debt', 'fomc', 'powell', 'yellen'];
  if (econKeywords.some(kw => text.includes(kw))) return 'economy';

  // 4. Politics & Geopolitics
  const polKeywords = ['trump', 'biden', 'election', 'president', 'congress', 'senate', 'war', 'china', 'russia', 'ukraine', 'israel', 'gaza', 'taiwan', 'eu ', 'nato', 'cabinet', 'court', 'pardon', 'governor'];
  if (polKeywords.some(kw => text.includes(kw))) return 'politics';

  // 5. AI & Tech
  const techKeywords = ['ai ', 'artificial intelligence', 'openai', 'gpt', 'google', 'apple', 'microsoft', 'nvidia', 'tesla', 'spacex', 'meta', 'gemini', 'claude', 'robot', 'chip', 'starship', 'neuralink'];
  if (techKeywords.some(kw => text.includes(kw))) return 'tech';

  return 'general';
};

const TOPICS = [
  { id: 'no_sports', label: '🔥 TÀI CHÍNH & MACRO' },
  { id: 'crypto', label: '🪙 CRYPTO' },
  { id: 'economy', label: '🏛️ KINH TẾ - FED' },
  { id: 'politics', label: '🌐 CHÍNH TRỊ' }
];

const VOL_FILTERS = [
  { id: 'top9', label: '🏆 Top 9 Vol Lớn Nhất' },
  { id: 'top15', label: 'Top 15 Vol Lớn Nhất' },
  { id: 'min5m', label: 'Vol > $5M' },
  { id: 'all', label: 'Tất cả' }
];

export default function PolymarketWhales({ fmt, moduleId }) {
  const { isModuleHidden } = useModuleVisibility();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState('no_sports');
  const [volumeFilter, setVolumeFilter] = useState('top9'); // Default: show only top 9 highest volume votes

  const fetchRealData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const data = await getPolymarketTopMarkets();
    if (data && data.length > 0) {
      setMarkets(data);
    } else {
      setMarkets([]);
      setError('Không thể tải dữ liệu thực tế từ Polymarket API (có thể do kết nối mạng hoặc DNS bị chặn).');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchRealData();
  }, [fetchRealData]);

  // Categorize, strictly sort by volume descending, and slice by volume filter
  const filteredMarkets = useMemo(() => {
    let list = markets.filter(m => {
      const cat = categorizeMarket(m);
      if (selectedTopic === 'all') return true;
      if (selectedTopic === 'no_sports') return cat !== 'sports';
      return cat === selectedTopic;
    });

    // Ensure strictly sorted descending by 24h volume
    list.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    if (volumeFilter === 'top9') return list.slice(0, 9);
    if (volumeFilter === 'top15') return list.slice(0, 15);
    if (volumeFilter === 'min5m') return list.filter(m => (m.volume || 0) >= 5000000);
    return list;
  }, [markets, selectedTopic, volumeFilter]);

  const totalVolFiltered = useMemo(() => {
    return filteredMarkets.reduce((sum, m) => sum + (m.volume || 0), 0);
  }, [filteredMarkets]);

  if (moduleId && isModuleHidden(moduleId)) return null;

  return (
    <div className="glass-panel whale-panel" style={{ marginTop: 16, marginBottom: 16, border: '1px solid rgba(16, 185, 129, 0.25)', boxShadow: '0 8px 32px rgba(16, 185, 129, 0.05)' }}>
      {/* Header */}
      <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <span className="dot dot-emerald" />
            <span className="font-mono text-emerald" style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.5px' }}>
              POLYMARKET WHALES TRACKER (REAL DATA)
            </span>
          </div>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.68rem' }}>
            TOP HIGHEST VOLUME VOTES
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {filteredMarkets.length > 0 && (
            <div className="font-mono" style={{ fontSize: '0.68rem', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>HIỂN THỊ: <strong className="text-emerald">{filteredMarkets.length}</strong> VOTE</span>
              <span>VOL 24H: <strong className="text-emerald">${fmt ? fmt(totalVolFiltered / 1e6, 2) : (totalVolFiltered / 1e6).toFixed(2)}M</strong></span>
            </div>
          )}

          <button
            onClick={() => fetchRealData(true)}
            disabled={loading || refreshing}
            className="font-mono"
            style={{
              padding: '4px 10px',
              fontSize: '0.65rem',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-panel)',
              color: 'var(--text-slate-200)',
              cursor: (loading || refreshing) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              transition: 'all 0.2s'
            }}
            title="Làm mới dữ liệu từ Polymarket Gamma API"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> LÀM MỚI
          </button>
          {moduleId && <ModuleMenu moduleId={moduleId} />}
        </div>
      </div>

      {/* Filters Section (Topic & Volume) */}
      <div style={{ margin: '12px 0', borderBottom: '1px solid var(--border-panel)', paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Topic Tabs */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 4 }}>
          {TOPICS.map(t => {
            const isActive = selectedTopic === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedTopic(t.id)}
                className={`font-mono ${isActive ? 'text-emerald' : 'text-slate-400'}`}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: '0.66rem',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                  border: isActive ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-panel)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s'
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Volume Threshold Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', flexWrap: 'nowrap' }}>
          <span className="font-mono text-slate-400" style={{ fontSize: '0.65rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            <TrendingUp size={11} className="text-amber" /> LỌC THEO VOLUME:
          </span>
          {VOL_FILTERS.map(vf => {
            const isActive = volumeFilter === vf.id;
            return (
              <button
                key={vf.id}
                onClick={() => setVolumeFilter(vf.id)}
                className="font-mono"
                style={{
                  padding: '3px 9px',
                  borderRadius: 4,
                  fontSize: '0.64rem',
                  background: isActive ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.2))' : 'rgba(255, 255, 255, 0.03)',
                  color: isActive ? 'var(--color-amber-400)' : 'var(--text-slate-300)',
                  border: isActive ? '1px solid rgba(245,158,11,0.4)' : '1px solid var(--border-panel)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 400
                }}
              >
                {vf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body Content */}
      <div>
        {loading ? (
          <div className="font-mono text-slate-400" style={{ padding: '36px 0', textAlign: 'center', fontSize: '0.8rem' }}>
            Đang tải dữ liệu thực tế từ Polymarket Gamma API...
          </div>
        ) : error ? (
          <div className="font-mono text-rose" style={{ padding: '28px 12px', textAlign: 'center', fontSize: '0.78rem', background: 'rgba(244, 63, 94, 0.05)', borderRadius: 8, border: '1px solid rgba(244, 63, 94, 0.2)' }}>
            <p style={{ margin: '0 0 10px 0' }}>{error}</p>
            <button
              onClick={() => fetchRealData(true)}
              style={{
                padding: '6px 14px',
                background: 'var(--color-rose-500)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono',
                fontSize: '0.7rem'
              }}
            >
              Thử lại ngay
            </button>
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="font-mono text-slate-400" style={{ padding: '32px 0', textAlign: 'center', fontSize: '0.75rem' }}>
            Không tìm thấy vote nào thỏa mãn bộ lọc hiện tại.
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => { setSelectedTopic('no_sports'); setVolumeFilter('top9'); }}
                style={{
                  padding: '5px 12px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid var(--color-emerald-400)',
                  color: 'var(--color-emerald-400)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '0.68rem'
                }}
              >
                Đưa về bộ lọc mặc định (Top 9 Vol Lớn Nhất)
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12, maxHeight: '440px', overflowY: 'auto', padding: '4px 2px' }}>
            {filteredMarkets.map((m, idx) => {
              const yesPrice = Math.round((m.outcomePrices?.[0] || 0.5) * 100);
              const noPrice = 100 - yesPrice;
              const marketUrl = m.slug ? `https://polymarket.com/event/${m.slug}` : `https://polymarket.com/markets/${m.id}`;
              const rankColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : 'rgba(255,255,255,0.2)';

              return (
                <div key={m.id} style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-panel)',
                  borderRadius: 8,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'border-color 0.2s, transform 0.2s'
                }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <a
                        href={marketUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-sans"
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: 'var(--text-contrast)',
                          margin: 0,
                          lineHeight: 1.35,
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 6,
                          width: '100%'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span className="font-mono" style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            padding: '2px 5px',
                            borderRadius: 4,
                            background: idx < 3 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
                            color: rankColor,
                            border: `1px solid ${idx < 3 ? 'rgba(245,158,11,0.3)' : 'var(--border-panel)'}`,
                            flexShrink: 0
                          }}>
                            #{idx + 1}
                          </span>
                          <span>{m.question}</span>
                        </div>
                        <ExternalLink size={13} style={{ flexShrink: 0, color: 'var(--text-slate-400)', marginTop: 2 }} />
                      </a>
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-slate-400)', marginBottom: 12 }}>
                      Vol 24h: <strong style={{ color: 'var(--color-amber-400)' }}>${(m.volume / 1e6).toFixed(2)}M</strong>
                      {m.liquidity > 0 && <span style={{ marginLeft: 10 }}>Liq: <strong style={{ color: 'var(--text-slate-300)' }}>${(m.liquidity / 1e6).toFixed(2)}M</strong></span>}
                    </div>
                  </div>

                  {/* Odds Progress Bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 5 }} className="font-mono">
                      <span style={{ color: 'var(--color-emerald-400)', fontWeight: 600 }}>YES {yesPrice}%</span>
                      <span style={{ color: 'var(--color-rose-400)', fontWeight: 600 }}>NO {noPrice}%</span>
                    </div>
                    <div style={{ width: '100%', height: 7, background: 'rgba(244, 63, 94, 0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${yesPrice}%`, height: '100%', background: 'var(--color-emerald-500)', transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

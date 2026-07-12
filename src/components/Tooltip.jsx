import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

export const METRIC_METADATA = {
  btcPrice: {
    api: 'Binance WebSocket (btcusdt@ticker)',
    def: 'Giá giao dịch tức thời của Bitcoin trên sàn Binance Futures, cập nhật thời gian thực qua WebSocket.'
  },
  fng: {
    api: 'Alternative.me API (REST)',
    def: 'Chỉ số Sợ hãi & Tham lam đo lường tâm lý chung của thị trường từ 0 (Cực kỳ sợ hãi) đến 100 (Cực kỳ tham lam).'
  },
  funding: {
    api: 'Binance WebSocket (btcusdt@markPrice@1s)',
    def: 'Phí định kỳ trao đổi giữa bên Long và Short để giữ giá Futures cân bằng với Spot. Funding dương: Long trả Short; Funding âm: Short trả Long.',
    formula: 'Funding = (Premium Index + clamp(Interest Rate - Premium Index, -0.05%, 0.05%))'
  },
  oi: {
    api: 'Binance Futures API (REST)',
    def: 'Tổng số vị thế mua/bán phái sinh đang mở trên sàn Binance Futures, chưa được thanh toán hoặc đóng lại.'
  },
  lsRatio: {
    api: 'Binance Futures API (REST)',
    def: 'Tỷ lệ tài khoản giữ vị thế Long vs Short của nhà giao dịch cá nhân. L/S > 1.0 biểu thị đa số đang mua lên.'
  },
  btcDom: {
    api: 'CoinGecko API (REST)',
    def: 'Thị phần vốn hóa của Bitcoin so với tổng vốn hóa của toàn bộ thị trường tiền điện tử.'
  },
  stablecoin: {
    api: 'CoinGecko API (REST)',
    def: 'Tổng vốn hóa của hai stablecoin lớn nhất (USDT + USDC) làm chỉ số đại diện cho dòng vốn dự trữ ("thuốc súng") trên chuỗi.'
  },
  totalMcap: {
    api: 'CoinGecko API (REST)',
    def: 'Tổng giá trị vốn hóa thị trường của tất cả các đồng tiền điện tử đang lưu hành.'
  },
  volume24h: {
    api: 'Binance WebSocket (btcusdt@ticker)',
    def: 'Tổng giá trị giao dịch của BTC bằng đồng USDT trong vòng 24 giờ qua trên sàn Binance.'
  },
  range24h: {
    api: 'Binance WebSocket (btcusdt@ticker)',
    def: 'Mức giá thấp nhất (Low) và cao nhất (High) của BTC trong vòng 24 giờ qua.'
  },
  hashRate: {
    api: 'Blockchain.info API (REST)',
    def: 'Tổng năng lượng tính toán (sức mạnh khai thác) đang bảo mật cho mạng lưới blockchain Bitcoin.'
  },
  difficulty: {
    api: 'Blockchain.info API (REST)',
    def: 'Độ khó thuật toán đào block mới của Bitcoin, tự động điều chỉnh sau mỗi 2016 block để duy trì thời gian ra block khoảng 10 phút.'
  },
  txCount: {
    api: 'Blockchain.info API (REST)',
    def: 'Tổng số giao dịch thành công trên chuỗi Bitcoin trong vòng 24 giờ qua.'
  },
  blockTime: {
    api: 'Blockchain.info API (REST)',
    def: 'Thời gian trung bình để khai thác một khối block Bitcoin mới trong 24 giờ qua.'
  },
  activeAddr: {
    api: 'CoinMetrics Community API (REST)',
    def: 'Số lượng địa chỉ ví độc nhất có phát sinh giao dịch gửi hoặc nhận BTC trên mạng lưới blockchain trong ngày.'
  },
  productionCost: {
    api: 'Blockchain.info (Tính toán dựa trên Độ khó Mạng lưới)',
    def: 'Khoảng ước tính chi phí điện (+ opex thô) để khai thác 1 BTC mới — không phải giá điểm chính xác. Low ≈ 20 J/TH @ $0.04/kWh; Mid ≈ 26 J/TH @ $0.05 + 10% opex; High ≈ 32 J/TH @ $0.065 + opex cao hơn. Biên phản ánh sai số assumption hợp lý (~±30–50% quanh mid). Không gồm pool fee, CapEx ASIC đầy đủ hay transaction fees.',
    formula: 'Cost = (D × 2³² × J/hash × $/kWh) / (3.6e6 × 3.125) × opex  →  range [low → high]'
  },
  mvrv: {
    api: 'CoinMetrics Community API (REST)',
    def: 'Tỷ lệ giữa Vốn hóa thị trường vs Vốn hóa thực tế. MVRV > 3.5 báo hiệu đỉnh bong bóng; MVRV < 1.0 báo hiệu vùng tích lũy đáy rẻ.',
    formula: 'MVRV = Market Cap / Realized Cap'
  },
  ethMvrv: {
    api: 'CoinMetrics Community API (REST)',
    def: 'MVRV Ratio của Ethereum. Tương tự BTC, phản ánh mức độ định giá quá cao hoặc quá thấp của mạng lưới ETH so với giá trị thực tế.',
    formula: 'MVRV = Market Cap / Realized Cap'
  },
  btcNupl: {
    api: 'CoinMetrics (Tính toán từ MVRV)',
    def: 'Net Unrealized Profit/Loss của Bitcoin. Đo lường tỷ lệ phần trăm vốn hóa thị trường đang ở trạng thái lãi hoặc lỗ chưa thực hiện. NUPL < 0: Đầu hàng; > 0.75: Hưng phấn tột độ.',
    formula: 'NUPL = 1 - (1 / MVRV)'
  },
  ethNupl: {
    api: 'CoinMetrics (Tính toán từ MVRV)',
    def: 'Net Unrealized Profit/Loss của Ethereum. Đo lường tỷ lệ phần trăm vốn hóa ETH đang ở trạng thái lãi hoặc lỗ chưa thực hiện.',
    formula: 'NUPL = 1 - (1 / MVRV)'
  },
  btcSupplyProfit: {
    api: 'Mô hình giả lập từ MVRV',
    def: 'Ước tính Tỷ lệ % nguồn cung Bitcoin đang có lời (Percent Supply in Profit). Do CoinMetrics khóa chỉ số này ở gói Pro ($500+/tháng), hệ thống sử dụng mô hình hồi quy toán học bậc 2 từ MVRV được hiệu chỉnh khớp tuyệt đối với số liệu thực tế.',
    formula: 'SupplyInProfit ≈ -10 + 52 × MVRV - 1.5 × MVRV²'
  },
  ethSupplyProfit: {
    api: 'Mô hình giả lập từ MVRV',
    def: 'Ước tính Tỷ lệ % nguồn cung Ethereum đang có lời (Percent Supply in Profit) dựa trên mô hình hồi quy toán học từ MVRV.',
    formula: 'SupplyInProfit ≈ -10 + 52 × MVRV - 1.5 × MVRV²'
  },
  cvd: {
    api: 'Binance WebSocket (btcusdt@aggTrade)',
    def: 'Chênh lệch tích lũy giữa volume lệnh Mua chủ động (Taker Buy) và lệnh Bán chủ động (Taker Sell) từ thời điểm mở trang.',
    formula: 'CVD = Σ(Taker Buy Vol) - Σ(Taker Sell Vol)',
    sessionOnly: true
  },
  whaleWalls: {
    api: 'Binance Futures API (REST - 1000 levels)',
    def: 'Mật độ các lệnh giới hạn (Limit Orders) có giá trị cực lớn (≥ $500K) đang chờ khớp, đóng vai trò như các vùng nam châm thanh khoản.',
    formula: 'Support/Resistance Walls ≥ $500K'
  },
  obi: {
    api: 'Binance Futures API (REST - 100 levels)',
    def: 'Chênh lệch khối lượng giữa tổng lệnh mua chờ (Bids) và bán chờ (Asks) trong sổ lệnh 100 levels. Đo lường sự bất cân xứng của cung/cầu chờ.',
    formula: 'OBI = (ΣBidVol - ΣAskVol) / (ΣBidVol + ΣAskVol) (100 levels)'
  },
  dxy: {
    api: 'FRED API (REST)',
    def: 'Chỉ số sức mạnh đồng USD so với rổ tiền tệ lớn trên thế giới.'
  },
  fedRate: {
    api: 'FRED API (REST - Series FEDFUNDS)',
    def: 'Lãi suất liên bang do Ngân hàng Trung ương Mỹ (FED) ấn định.'
  },
  cpi: {
    api: 'FRED API (REST - Series CPIAUCSL)',
    def: 'Chỉ số giá tiêu dùng (Consumer Price Index) của Hoa Kỳ, đo lường lạm phát.'
  },
  unrate: {
    api: 'FRED API (REST - Series UNRATE)',
    def: 'Tỷ lệ thất nghiệp của Hoa Kỳ, phần trăm lực lượng lao động không có việc làm.'
  },
  tenYearYield: {
    api: 'FRED API (REST - Series DGS10)',
    def: 'Lợi suất trái phiếu chính phủ Mỹ kỳ hạn 10 năm.'
  },
  sp500: {
    api: 'FRED API (REST - Series SP500)',
    def: 'Chỉ số chứng khoán S&P 500 đại diện cho 500 doanh nghiệp lớn nhất Hoa Kỳ.'
  },
  vix: {
    api: 'FRED API (REST - Series VIXCLS)',
    def: 'Chỉ số đo lường mức độ biến động dự kiến của thị trường chứng khoán (Fear Gauge).'
  },
  m2Supply: {
    api: 'FRED API (REST - Series M2SL)',
    def: 'Tổng cung tiền M2 của Hoa Kỳ (tính bằng tỷ USD), phản ánh mức độ thanh khoản cơ sở trong nền kinh tế.'
  },
  highYield: {
    api: 'FRED API (REST - Series BAMLH0A0HYM2EY)',
    def: 'Lợi suất chỉ số trái phiếu doanh nghiệp dưới mức đầu tư (High Yield / Junk Bonds) của Mỹ.'
  },
  qqq: {
    api: 'FRED API (REST - Series NASDAQ100)',
    def: 'Chỉ số chứng khoán Nasdaq 100 đại diện cho 100 công ty phi tài chính lớn nhất được giao dịch trên sàn Nasdaq.'
  },
  netLiquidity: {
    api: 'FRED API (REST)',
    def: 'Hệ thống thanh khoản ròng của Hoa Kỳ, đo lường lượng đô la thực tế lưu thông trong hệ thống tài chính sau khi loại trừ các tài khoản hút thanh khoản của Kho bạc và Fed.',
    formula: 'Net Liquidity = WALCL (Fed Assets) - WDTGAL (TGA) - RRPONTSYD (Reverse Repo)'
  },
  econCycle: {
    api: 'Khung lý thuyết Chu kỳ kinh tế (Macro Cycle Framework)',
    def: 'Kinh tế vận hành theo chu kỳ 4 giai đoạn: Nới lỏng -> Tăng trưởng -> Thắt chặt -> Suy thoái. Xác định đúng chu kỳ giúp nhà đầu tư chuẩn bị vốn, kiến thức và hạn chế tâm lý FOMO mua theo đám đông.'
  }
};

const TooltipContext = createContext({
  tooltipsEnabled: true,
  setTooltipsEnabled: () => {},
  lastSyncTime: null,
  setLastSyncTime: () => {}
});

export function TooltipProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem('tooltips-enabled') !== 'false';
  });
  const [lastSyncTime, setLastSyncTime] = useState(null);

  useEffect(() => {
    localStorage.setItem('tooltips-enabled', String(enabled));
  }, [enabled]);

  // Alt + T shortcut to toggle tooltips globally
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setEnabled(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <TooltipContext.Provider value={{ 
      tooltipsEnabled: enabled, 
      setTooltipsEnabled: setEnabled,
      lastSyncTime,
      setLastSyncTime
    }}>
      {children}
    </TooltipContext.Provider>
  );
}

export function useTooltipSettings() {
  return useContext(TooltipContext);
}

export default function Tooltip({ content, lastUpdated, children }) {
  const [visible, setVisible] = useState(false);
  const { tooltipsEnabled, lastSyncTime } = useTooltipSettings();
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!tooltipsEnabled) {
      setVisible(false);
    }
  }, [tooltipsEnabled]);

  const handleMouseEnter = () => {
    if (!tooltipsEnabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.top + window.scrollY,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
    }
    setVisible(true);
  };

  const handleMouseLeave = () => {
    setVisible(false);
  };

  // Adjust left dynamically to prevent clipping on the viewport edges
  let leftPos = coords.left;
  const halfWidth = 130;
  if (leftPos - halfWidth < 10) {
    leftPos = halfWidth + 10;
  }
  if (leftPos + halfWidth > window.innerWidth - 10) {
    leftPos = window.innerWidth - halfWidth - 10;
  }

  const isRealTime = content.api && (
    content.api.toLowerCase().includes('websocket') || 
    content.api.toLowerCase().includes('realtime') || 
    content.api.toLowerCase().includes('real-time')
  );
  const displayTime = lastUpdated || (isRealTime ? 'Thời gian thực' : lastSyncTime);

  return (
    <div 
      className="tooltip-wrapper"
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      {children}
      {visible && content && createPortal(
        <div className="tooltip-box font-mono" style={{
          position: 'absolute',
          top: `${coords.top}px`,
          left: `${leftPos}px`,
          transform: 'translateX(-50%) translateY(-100%) translateY(-8px)',
          zIndex: 9999,
          width: '260px',
          padding: '10px',
          background: 'var(--bg-tooltip)',
          border: '1px solid var(--border-tooltip)',
          borderRadius: '6px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
          color: 'var(--text-tooltip-body)',
          fontSize: '0.6rem',
          lineHeight: '1.4',
          pointerEvents: 'none'
        }}>
          {content.api && (
            <div style={{ borderBottom: '1px solid var(--border-panel)', paddingBottom: '4px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
              <span style={{ color: 'var(--text-tooltip-title)' }}>API Source:</span>
              <span className="text-emerald" style={{ fontWeight: 700 }}>{content.api}</span>
            </div>
          )}
          {content.formula && (
            <div style={{ marginBottom: '6px', background: 'rgba(0,0,0,0.1)', padding: '4px', borderRadius: '3px' }}>
              <span style={{ color: 'var(--text-tooltip-title)', display: 'block', fontSize: '0.52rem', fontWeight: 'bold' }}>CÔNG THỨC:</span>
              <code style={{ fontSize: '0.55rem', wordBreak: 'break-all' }}>{content.formula}</code>
            </div>
          )}
          <p style={{ margin: 0 }}>{content.def}</p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', marginBottom: '2px' }}>
            {isRealTime && (
              <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '3px 6px', borderRadius: '4px', fontSize: '0.55rem', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                🟢 Liên tục
              </span>
            )}
            {content.sessionOnly && (
              <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '3px 6px', borderRadius: '4px', fontSize: '0.55rem', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                ⏳ Tính từ lúc tải trang
              </span>
            )}
            {!isRealTime && (
              <span style={{ background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-slate-400)', padding: '3px 6px', borderRadius: '4px', fontSize: '0.55rem', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                🔄 Cập nhật định kỳ
              </span>
            )}
          </div>
          {displayTime && (
            <div style={{ borderTop: '1px solid var(--border-panel)', paddingTop: '6px', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-tooltip-title)' }}>Cập nhật:</span>
              <span className="text-emerald" style={{ fontWeight: 700 }}>{displayTime}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

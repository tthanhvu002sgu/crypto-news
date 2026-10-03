/**
 * COT Engine: Xử lý, phân tích xu hướng lịch sử và diễn giải chiến lược
 * cho dữ liệu CME Bitcoin Futures Commitments of Traders (CFTC TFF Report)
 */

import staticCotHistory from '../data/cmeCotHistoryStatic.json' with { type: 'json' };

export const COT_REGIMES = {
  INSTITUTIONAL_ACCUMULATION: {
    id: 'INSTITUTIONAL_ACCUMULATION',
    label: 'TÍCH LŨY THỂ CHẾ (BULLISH)',
    color: 'var(--color-emerald-500, #10b981)',
    badgeClass: 'badge-emerald',
    icon: '🏛️'
  },
  ARBITRAGE_HEDGED: {
    id: 'ARBITRAGE_HEDGED',
    label: 'GIAO DỊCH CHÊNH LỆCH BASIS ARBITRAGE',
    color: 'var(--color-amber-500, #f59e0b)',
    badgeClass: 'badge-amber',
    icon: '⚖️'
  },
  SHORT_SQUEEZE_RISK: {
    id: 'SHORT_SQUEEZE_RISK',
    label: 'CẢNH BÁO SHORT SQUEEZE (ĐÓNG VỊ THẾ BÁN)',
    color: 'var(--color-cyan-500, #06b6d4)',
    badgeClass: 'badge-cyan',
    icon: '⚡'
  },
  DISTRIBUTION_DERISKING: {
    id: 'DISTRIBUTION_DERISKING',
    label: 'PHÂN PHỐI / HẠ ĐÒN BẨY (BEARISH/DE-RISK)',
    color: 'var(--color-rose-500, #ef4444)',
    badgeClass: 'badge-rose',
    icon: '⚠️'
  },
  BALANCED_NEUTRAL: {
    id: 'BALANCED_NEUTRAL',
    label: 'CÂN BẰNG / TÍCH LŨY TRUNG TÍNH',
    color: 'var(--color-slate-400, #94a3b8)',
    badgeClass: 'badge-slate',
    icon: '🔄'
  }
};

const toInt = (val) => {
  if (val == null || val === '') return 0;
  const num = parseInt(String(val).replace(/,/g, ''), 10);
  return Number.isFinite(num) ? num : 0;
};

const toFloat = (val) => {
  if (val == null || val === '') return 0;
  const num = parseFloat(String(val).replace(/[%]/g, '').trim());
  return Number.isFinite(num) ? num : 0;
};

/**
 * Format ngày YYYY-MM-DD sang DD/MM/YYYY
 */
export const formatCotDate = (isoOrYmd) => {
  if (!isoOrYmd) return 'N/A';
  const clean = isoOrYmd.split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoOrYmd;
};

/**
 * Parse 1 record thô từ CFTC Socrata TFF API (gpe5-46if)
 */
export const parseCftcRecord = (r) => {
  if (!r) return null;
  // Hỗ trợ record đã parse sẵn (từ snapshot hoặc cache)
  if (r.assetManager && r.leveragedFunds && r.date) {
    const rawDate = r.rawDate || r.date;
    return {
      date: formatCotDate(rawDate),
      rawDate,
      openInterest: toInt(r.openInterest),
      openInterestChange: toInt(r.openInterestChange),
      dealerIntermediary: r.dealerIntermediary || { long: 0, short: 0, spread: 0, net: 0, netChange: 0 },
      assetManager: r.assetManager,
      leveragedFunds: r.leveragedFunds,
      otherReportables: r.otherReportables || { long: 0, short: 0, spread: 0, net: 0, netChange: 0 },
      nonReportable: r.nonReportable || { long: 0, short: 0, net: 0, netChange: 0 },
      totalTraders: toInt(r.totalTraders),
    };
  }

  const rawDate = r.report_date_as_yyyy_mm_dd ? r.report_date_as_yyyy_mm_dd.split('T')[0] : (r.date || '');
  const formattedDate = formatCotDate(rawDate);
  const openInterest = toInt(r.open_interest_all);
  const oiChange = toInt(r.change_in_open_interest_all);

  const parseGroup = (prefixLong, prefixShort, prefixSpread, chgLong, chgShort, chgSpread, oiLong, oiShort, oiSpread, tLong, tShort, tSpread) => {
    const long = toInt(r[prefixLong]);
    const short = toInt(r[prefixShort]);
    const spread = toInt(r[prefixSpread]);
    const longChange = toInt(r[chgLong]);
    const shortChange = toInt(r[chgShort]);
    const spreadChange = toInt(r[chgSpread]);
    const longOi = toFloat(r[oiLong]);
    const shortOi = toFloat(r[oiShort]);
    const spreadOi = toFloat(r[oiSpread]);
    const longTraders = r[tLong] ? toInt(r[tLong]) : null;
    const shortTraders = r[tShort] ? toInt(r[tShort]) : null;
    const spreadTraders = r[tSpread] ? toInt(r[tSpread]) : null;

    return {
      long,
      longChange,
      longOi,
      longTraders,
      short,
      shortChange,
      shortOi,
      shortTraders,
      spread,
      spreadChange,
      spreadOi,
      spreadTraders,
      net: long - short,
      netChange: longChange - shortChange,
    };
  };

  const dealerIntermediary = parseGroup(
    'dealer_positions_long_all', 'dealer_positions_short_all', 'dealer_positions_spread_all',
    'change_in_dealer_long_all', 'change_in_dealer_short_all', 'change_in_dealer_spread_all',
    'pct_of_oi_dealer_long_all', 'pct_of_oi_dealer_short_all', 'pct_of_oi_dealer_spread_all',
    'traders_dealer_long_all', 'traders_dealer_short_all', null
  );

  const assetManager = parseGroup(
    'asset_mgr_positions_long', 'asset_mgr_positions_short', 'asset_mgr_positions_spread',
    'change_in_asset_mgr_long', 'change_in_asset_mgr_short', 'change_in_asset_mgr_spread',
    'pct_of_oi_asset_mgr_long', 'pct_of_oi_asset_mgr_short', 'pct_of_oi_asset_mgr_spread',
    'traders_asset_mgr_long_all', 'traders_asset_mgr_short_all', 'traders_asset_mgr_spread'
  );

  const leveragedFunds = parseGroup(
    'lev_money_positions_long', 'lev_money_positions_short', 'lev_money_positions_spread',
    'change_in_lev_money_long', 'change_in_lev_money_short', 'change_in_lev_money_spread',
    'pct_of_oi_lev_money_long', 'pct_of_oi_lev_money_short', 'pct_of_oi_lev_money_spread',
    'traders_lev_money_long_all', 'traders_lev_money_short_all', 'traders_lev_money_spread'
  );

  const otherReportables = parseGroup(
    'other_rept_positions_long', 'other_rept_positions_short', 'other_rept_positions_spread',
    'change_in_other_rept_long', 'change_in_other_rept_short', 'change_in_other_rept_spread',
    'pct_of_oi_other_rept_long', 'pct_of_oi_other_rept_short', 'pct_of_oi_other_rept_spread',
    'traders_other_rept_long_all', 'traders_other_rept_short', 'traders_other_rept_spread'
  );

  const nonReportable = parseGroup(
    'nonrept_positions_long_all', 'nonrept_positions_short_all', null,
    'change_in_nonrept_long_all', 'change_in_nonrept_short_all', null,
    'pct_of_oi_nonrept_long_all', 'pct_of_oi_nonrept_short_all', null,
    null, null, null
  );

  return {
    date: formattedDate,
    rawDate,
    openInterest,
    openInterestChange: oiChange,
    dealerIntermediary,
    assetManager,
    leveragedFunds,
    otherReportables,
    nonReportable,
    totalTraders: toInt(r.traders_tot_all),
  };
};

/**
 * Tính toán COT Index Percentile: (Current - Min) / (Max - Min) * 100
 */
export const calculateCotIndex = (current, min, max) => {
  if (current == null || min == null || max == null) return 50;
  if (max === min) return 50;
  const pct = ((current - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
};

/**
 * Phân loại Regime và cấu trúc thị trường
 */
export const classifyCotRegime = ({ amNet, amChangeWoW, amChange4W, amCotIndex, lfNet, lfChangeWoW, oiChangeWoW }) => {
  // 1. Quỹ phòng hộ đóng Short đột ngột (Short covering) kèm OI giảm mạnh
  if (lfChangeWoW > 1200 && oiChangeWoW < -1000) {
    return COT_REGIMES.SHORT_SQUEEZE_RISK;
  }

  // 2. Thể chế (Asset Manager) gom mạnh mẽ, COT Index > 65% hoặc tăng ròng liên tục
  if ((amCotIndex >= 65 || amChange4W > 800) && amNet > 2500) {
    return COT_REGIMES.INSTITUTIONAL_ACCUMULATION;
  }

  // 3. Quỹ đòn bẩy Short sâu (> -5000) trong khi Asset Manager Long lớn (> +2000)
  // Đặc trưng điển hình của chiến lược Cash and Carry Basis Trade
  if (lfNet < -4000 && amNet > 1500) {
    return COT_REGIMES.ARBITRAGE_HEDGED;
  }

  // 4. Thể chế giảm Long ròng liên tiếp hoặc COT Index < 35%
  if (amCotIndex < 35 || (amChange4W < -1000 && amChangeWoW < 0)) {
    return COT_REGIMES.DISTRIBUTION_DERISKING;
  }

  return COT_REGIMES.BALANCED_NEUTRAL;
};

/**
 * Tạo nội dung diễn giải chiến lược tự động (Strategic Narrative Generator)
 */
export const generateCotNarrative = ({
  latest,
  prevWeek,
  fourWeeksAgo,
  amCotIndex,
  lfCotIndex,
  regime,
  deltas,
}) => {
  const am = latest.assetManager || {};
  const lf = latest.leveragedFunds || {};
  const retail = latest.nonReportable || {};
  const oi = latest.openInterest || 0;

  // 1. Nhận định Smart Money (Asset Managers)
  const amLongRatio = am.long + am.short > 0 ? ((am.long / (am.long + am.short)) * 100).toFixed(1) : '---';
  let amText = `Nhóm Quỹ Quản lý Tài sản (Asset Managers / ETFs) hiện nắm giữ vị thế ròng **${am.net >= 0 ? '+' : ''}${am.net.toLocaleString()} hợp đồng** (Long chiếm ${amLongRatio}%). `;
  if (deltas.amWoW > 0) {
    amText += `Trong tuần qua, họ đã **tăng thêm +${deltas.amWoW.toLocaleString()} hợp đồng Long ròng**, `;
  } else if (deltas.amWoW < 0) {
    amText += `Tuần qua ghi nhận động thái **giảm nhẹ ${deltas.amWoW.toLocaleString()} hợp đồng Long ròng**, `;
  } else {
    amText += `Vị thế duy trì ổn định so với tuần trước, `;
  }
  amText += `đưa chỉ số tích lũy COT Index 26 tuần đạt mức **${amCotIndex}%**. So với 4 tuần trước, vị thế của nhóm này biến động **${deltas.am4W >= 0 ? '+' : ''}${deltas.am4W.toLocaleString()} hợp đồng**, phản ánh dòng tiền thể chế tiếp tục duy trì thiên hướng tích lũy dài hạn.`;

  // 2. Nhận định Quỹ Phòng Hộ & Basis Trade (Leveraged Funds)
  let lfText = `Nhóm Quỹ Đòn bẩy (Hedge Funds) đang nắm giữ vị thế ròng **${lf.net.toLocaleString()} hợp đồng** (nghiêng hẳn về phía Short). `;
  if (lf.net < -4000 && am.net > 1500) {
    lfText += `Lưu ý rằng mức Short áp đảo của nhóm này phần lớn **không phải là cược giá giảm định hướng**, mà là vị thế bán phòng hộ trong chiến lược **Cash-and-Carry Basis Trade** (Mua Spot/ETF trên thị trường giao ngay và Bán CME Futures để ăn chênh lệch funding/basis). `;
  }
  if (deltas.lfWoW > 500) {
    lfText += `Tuần này họ đã **đóng bớt Short (+${deltas.lfWoW.toLocaleString()} hợp đồng)**, làm giảm áp lực bán trên sàn phái sinh.`;
  } else if (deltas.lfWoW < -500) {
    lfText += `Họ tiếp tục mở rộng Short thêm **${deltas.lfWoW.toLocaleString()} hợp đồng**, cho thấy hoạt động chênh lệch giá cơ sở vẫn đang hấp thụ thanh khoản mạnh mẽ.`;
  } else {
    lfText += `Quy mô Short được duy trì ở mức cân bằng với tuần trước.`;
  }

  // 3. Nhận định Nhà Đầu Tư Nhỏ Lẻ (Retail / Non-Reportable)
  let retailText = `Nhóm cá nhân nhỏ lẻ (Non-Reportable) đang nắm giữ vị thế ròng **${retail.net >= 0 ? '+' : ''}${retail.net.toLocaleString()} hợp đồng** (Long: ${retail.long.toLocaleString()} / Short: ${retail.short.toLocaleString()}). `;
  if (retail.net > 0 && am.net > 0) {
    retailText += `Tâm lý cá nhân đồng thuận với dòng tiền thể chế, củng cố xu hướng tăng chung nhưng cần thận trọng khi phe Long trở nên quá đông đúc.`;
  } else if (retail.net < 0 && am.net > 0) {
    retailText += `Tồn tại sự **phân kỳ thú vị**: Nhà đầu tư cá nhân thiên về Short trong khi các tổ chức lớn tích cực gom Long, đây là tín hiệu củng cố sức mạnh cho dòng tiền lớn (Smart Money Dominance).`;
  } else {
    retailText += `Quy mô vị thế cá nhân chiếm tỷ trọng nhỏ (~${retail.longOi || 5}% OI), không chi phối cấu trúc giá chính.`;
  }

  // 4. Tổng kết hành động (Tactical Synthesis)
  let tacticalText = '';
  if (regime.id === 'INSTITUTIONAL_ACCUMULATION') {
    tacticalText = `Cấu trúc vị thế thể hiện rõ trạng thái **Tích lũy Thể chế**: Smart Money duy trì vị thế Long vững chắc với COT Index cao. Xu hướng vĩ mô trung hạn của Bitcoin được hỗ trợ tốt, các nhịp điều chỉnh ngắn hạn là cơ hội tích lũy theo dòng tiền lớn.`;
  } else if (regime.id === 'ARBITRAGE_HEDGED') {
    tacticalText = `Thị trường vận động lành mạnh dưới sự chi phối của **Basis Arbitrage**: Lượng hợp đồng mở duy trì ở mức cao (${oi.toLocaleString()} hợp đồng), vị thế Short lớn của Hedge Funds chỉ nhằm cân bằng thanh khoản với Spot ETFs chứ không tạo áp lực bán tháo.`;
  } else if (regime.id === 'SHORT_SQUEEZE_RISK') {
    tacticalText = `Cảnh báo biến động mạnh: Hedge Funds có dấu hiệu đóng Short nhanh khiến giá nhạy cảm với các đợt bật tăng bất ngờ (Short Squeeze).`;
  } else if (regime.id === 'DISTRIBUTION_DERISKING') {
    tacticalText = `Cảnh báo rủi ro: Smart Money đang hạ dần tỷ trọng Long trong 4 tuần qua. Cần quan sát chặt chẽ dòng tiền ETF và khối lượng giao dịch để phòng ngừa nhịp phân phối sâu hơn.`;
  } else {
    tacticalText = `Thị trường đang ở trạng thái cân bằng vị thế, chưa có tín hiệu gom hay xả cực đoan từ các tổ chức lớn.`;
  }

  return {
    overview: tacticalText,
    smartMoney: amText,
    hedgeFunds: lfText,
    retail: retailText,
  };
};

/**
 * Xử lý danh sách báo cáo thô từ CFTC hoặc fallback thành đối tượng đầy đủ
 */
export const processCotData = (rawList, options = { mergeStatic: true }) => {
  let list = Array.isArray(rawList) && rawList.length > 0 ? rawList : staticCotHistory;
  if (!Array.isArray(list) || list.length === 0) return null;

  // Nếu list chỉ có ít hơn 10 records và mergeStatic được bật, tự động ghép với staticCotHistory
  if (options?.mergeStatic !== false && list.length < 10 && Array.isArray(staticCotHistory)) {
    const listRawDates = new Set(list.map(item => (item.report_date_as_yyyy_mm_dd?.split('T')[0] || item.rawDate || item.date)));
    const additionalStatic = staticCotHistory.filter(s => {
      const sDate = s.report_date_as_yyyy_mm_dd?.split('T')[0];
      return sDate && !listRawDates.has(sDate);
    });
    list = [...list, ...additionalStatic];
  }

  // Chuẩn hóa danh sách các tuần
  const history = list
    .map(parseCftcRecord)
    .filter(Boolean)
    .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());

  if (history.length === 0) return null;

  const latest = history[0];
  const prevWeek = history[1] || latest;
  const fourWeeksAgo = history[4] || history[history.length - 1];
  const twelveWeeksAgo = history[12] || history[history.length - 1];
  const twentySixWeeks = history.slice(0, 26);
  const fiftyTwoWeeks = history.slice(0, 52);

  // Tính Min/Max 26 tuần cho Asset Manager & Leveraged Funds
  const amNets26 = twentySixWeeks.map(w => w.assetManager.net);
  const amMin26 = Math.min(...amNets26);
  const amMax26 = Math.max(...amNets26);
  const amCotIndex = calculateCotIndex(latest.assetManager.net, amMin26, amMax26);

  const lfNets26 = twentySixWeeks.map(w => w.leveragedFunds.net);
  const lfMin26 = Math.min(...lfNets26);
  const lfMax26 = Math.max(...lfNets26);
  const lfCotIndex = calculateCotIndex(latest.leveragedFunds.net, lfMin26, lfMax26);

  const retailNets26 = twentySixWeeks.map(w => w.nonReportable.net);
  const retailMin26 = Math.min(...retailNets26);
  const retailMax26 = Math.max(...retailNets26);
  const retailCotIndex = calculateCotIndex(latest.nonReportable.net, retailMin26, retailMax26);

  // Deltas so với các mốc thời gian
  const deltas = {
    oiWoW: latest.openInterest - prevWeek.openInterest,
    oi4W: latest.openInterest - fourWeeksAgo.openInterest,
    oi12W: latest.openInterest - twelveWeeksAgo.openInterest,

    amWoW: latest.assetManager.net - prevWeek.assetManager.net,
    am4W: latest.assetManager.net - fourWeeksAgo.assetManager.net,
    am12W: latest.assetManager.net - twelveWeeksAgo.assetManager.net,

    lfWoW: latest.leveragedFunds.net - prevWeek.leveragedFunds.net,
    lf4W: latest.leveragedFunds.net - fourWeeksAgo.leveragedFunds.net,
    lf12W: latest.leveragedFunds.net - twelveWeeksAgo.leveragedFunds.net,

    retailWoW: latest.nonReportable.net - prevWeek.nonReportable.net,
    retail4W: latest.nonReportable.net - fourWeeksAgo.nonReportable.net,
    retail12W: latest.nonReportable.net - twelveWeeksAgo.nonReportable.net,

    dealerWoW: latest.dealerIntermediary.net - prevWeek.dealerIntermediary.net,
    dealer4W: latest.dealerIntermediary.net - fourWeeksAgo.dealerIntermediary.net,
  };

  // Phân loại Regime
  const regime = classifyCotRegime({
    amNet: latest.assetManager.net,
    amChangeWoW: deltas.amWoW,
    amChange4W: deltas.am4W,
    amCotIndex,
    lfNet: latest.leveragedFunds.net,
    lfChangeWoW: deltas.lfWoW,
    oiChangeWoW: deltas.oiWoW,
  });

  // Tạo diễn giải
  const narrative = generateCotNarrative({
    latest,
    prevWeek,
    fourWeeksAgo,
    amCotIndex,
    lfCotIndex,
    regime,
    deltas,
  });

  return {
    ...latest,
    history,
    analytics: {
      amCotIndex,
      lfCotIndex,
      retailCotIndex,
      amRange26W: { min: amMin26, max: amMax26 },
      lfRange26W: { min: lfMin26, max: lfMax26 },
      retailRange26W: { min: retailMin26, max: retailMax26 },
      deltas,
      regime,
      weeksAvailable: history.length,
    },
    cotIndex: amCotIndex,
    regime,
    narrative,
    source: 'CFTC_SOCRATA_TFF',
    isFallback: false,
  };
};

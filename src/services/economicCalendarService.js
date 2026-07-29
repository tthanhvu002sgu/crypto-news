/**
 * Economic Calendar Service
 * Fetches real-time weekly macroeconomic calendar from FairEconomy (ForexFactory)
 * and enriches events with Vietnamese translations, impact levels, and deep Crypto trading insights.
 */

import axios from 'axios';

// Cache in memory for 15 minutes
let cachedEvents = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 15 * 60 * 1000;
const FOREX_FACTORY_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function normalizeEventTitle(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getActualLookupKey(sourceDate, country, title) {
  return `${sourceDate}|${country?.toUpperCase() || ''}|${normalizeEventTitle(title)}`;
}

function getForexFactoryDayUrl(sourceDate) {
  const [year, month, day] = sourceDate.split('-').map(Number);
  return `https://r.jina.ai/http://www.forexfactory.com/calendar?day=${FOREX_FACTORY_MONTHS[month - 1]}${day}.${year}`;
}

function parseForexFactoryActuals(markdown, sourceDate) {
  const actuals = new Map();

  markdown.split('\n').forEach((line) => {
    if (!line.startsWith('|')) return;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<[^>]*>/g, '')
        .trim());

    const countryIndex = cells.findIndex((cell) => /^[A-Z]{3}$/.test(cell));
    if (countryIndex === -1) return;

    const titleIndex = cells.findIndex((cell, index) => index > countryIndex && cell.length > 0);
    const actual = cells[titleIndex + 3]?.trim();
    if (titleIndex === -1 || !actual) return;

    actuals.set(getActualLookupKey(sourceDate, cells[countryIndex], cells[titleIndex]), actual);
  });

  return actuals;
}

async function getReleasedEventActuals(rawEvents) {
  const now = Date.now();
  const sourceDates = [...new Set(
    rawEvents
      .filter((event) => event.date && event.title && !event.actual && new Date(event.date).getTime() <= now)
      .map((event) => event.date.slice(0, 10))
  )];

  const results = await Promise.allSettled(sourceDates.map(async (sourceDate) => {
    const response = await axios.get(getForexFactoryDayUrl(sourceDate), {
      headers: { Accept: 'text/plain' },
      timeout: 10000,
    });
    return parseForexFactoryActuals(response.data || '', sourceDate);
  }));

  return results.reduce((actuals, result) => {
    if (result.status === 'fulfilled') {
      result.value.forEach((value, key) => actuals.set(key, value));
    }
    return actuals;
  }, new Map());
}

/**
 * Get 7 days of the current week (Monday to Sunday)
 */
export function getCurrentWeekDays() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const currentDayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const days = [];
  const dayNamesVN = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const isPast = d.getTime() < todayStart.getTime();

    const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const fullDateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    days.push({
      dayIndex: i,
      nameVN: dayNamesVN[i],
      dateStr,
      fullDateStr,
      dateObj: new Date(d),
      isToday,
      isPast,
      events: [],
    });
  }
  return days;
}

/**
 * Map raw event titles to Vietnamese explanations & Crypto Trading Insights
 */
export function getEventCryptoAnalysis(title = '', country = 'USD', impact = 'Medium') {
  const t = title.toLowerCase();

  if (t.includes('cpi') || t.includes('consumer price index') || t.includes('lạm phát')) {
    return {
      titleVN: 'Chỉ số Giá Tiêu dùng (Lạm phát CPI)',
      category: 'LẠM PHÁT (INFLATION)',
      impactCrypto: 'TÁC ĐỘNG CỰC MẠNH ĐẾN BITCOIN & CRYPTO',
      analysis: 'CPI đo lường tốc độ lạm phát. Nếu CPI công bố CAO hơn dự báo -> Lạm phát dai dẳng -> Fed có thể giữ lãi suất cao lâu hơn (Hawkish) -> DXY & Lợi suất trái phiếu tăng -> Áp lực BÁN MẠNH lên Bitcoin. Ngược lại, nếu CPI THẤP hơn dự báo -> Lạm phát hạ nhiệt -> Dòng tiền rủi ro đổ mạnh vào Crypto (Bullish).',
      tradingCue: 'CẢNH BÁO: Biến động hai chiều (Darth Maul candle) thường xảy ra trong 15 phút đầu công bố. Tránh mở lệnh đòn bẩy cao trước giờ tin ra.',
    };
  }

  if (t.includes('fomc') || t.includes('federal funds rate') || t.includes('interest rate') || t.includes('lãi suất')) {
    return {
      titleVN: 'Quyết định Lãi suất Fed / Biên bản FOMC',
      category: 'CHÍNH SÁCH TIỀN TỆ (MONETARY POLICY)',
      impactCrypto: 'SỰ KIỆN ĐỊNH ĐOẠT XU HƯỚNG CHU KỲ',
      analysis: 'Lãi suất của Cục Dự trữ Liên bang Mỹ (Fed) quyết định chi phí vốn toàn cầu. Cắt giảm lãi suất hoặc thông điệp nới lỏng (Dovish) sẽ bơm thanh khoản M2 vào hệ thống tài chính, kích hoạt siêu chu kỳ tăng giá cho Bitcoin. Ngược lại, giữ lãi suất cao hoặc tăng lãi suất sẽ thắt chặt dòng tiền.',
      tradingCue: 'MỨC BIẾN ĐỘNG CỰC ĐẠI: Chú ý theo dõi kỹ phần hỏi đáp (Q&A) trong cuộc họp báo của Chủ tịch Fed Powell sau thời điểm công bố lãi suất 30 phút.',
    };
  }

  if (t.includes('non-farm') || t.includes('nfp') || t.includes('employment change') || t.includes('bảng lương')) {
    return {
      titleVN: 'Bảng lương Phi nông nghiệp Mỹ (NFP)',
      category: 'LAO ĐỘNG & VIỆC LÀM (EMPLOYMENT)',
      impactCrypto: 'TÁC ĐỘNG MẠNH - ĐỊNH HƯỚNG FED',
      analysis: 'NFP đo lường số lượng việc làm mới được tạo ra tại Mỹ. Nếu NFP tăng quá mạnh -> Thị trường lao động nóng -> Fed lo ngại lạm phát quay lại -> Tác động tiêu cực nhẹ cho Crypto. Nếu NFP vừa phải hoặc giảm nhẹ -> Kịch bản hạ cánh mềm (Soft Landing) lý tưởng cho Bitcoin.',
      tradingCue: 'LƯỢNG VOLUME: Giao dịch phái sinh thường bùng nổ ngay khi số liệu NFP xuất hiện.',
    };
  }

  if (t.includes('unemployment') || t.includes('jobless claims') || t.includes('thất nghiệp')) {
    return {
      titleVN: 'Tỷ lệ Thất nghiệp / Trợ cấp Thất nghiệp Mỹ',
      category: 'LAO ĐỘNG (LABOR MARKET)',
      impactCrypto: 'TÁC ĐỘNG TRUNG BÌNH - CAO',
      analysis: 'Số đơn xin trợ cấp thất nghiệp lần đầu cho thấy sức khỏe nền kinh tế. Nếu thất nghiệp tăng vọt đột ngột, thị trường có thể lo ngại suy thoái (Recession), gây bán tháo ngắn hạn trước khi Fed buộc phải bơm tiền cứu trợ.',
      tradingCue: 'QUAN SÁT: Kết hợp với chỉ số DXY và S&P 500 để xác định hướng đi chính của dòng tiền.',
    };
  }

  if (t.includes('pmi') || t.includes('manufacturing') || t.includes('services') || t.includes('ism')) {
    return {
      titleVN: 'Chỉ số Quản lý Thu mua Sản xuất / Dịch vụ (PMI)',
      category: 'SỨC KHỎE KINH TẾ (ECONOMIC ACTIVITY)',
      impactCrypto: 'TÁC ĐỘNG TRUNG BÌNH',
      analysis: 'PMI trên 50 thể hiện sự mở rộng kinh tế, dưới 50 cho thấy sự thu hẹp. Dữ liệu PMI yếu hơn dự báo thường làm giảm sức mạnh đồng USD, qua đó hỗ trợ giá Bitcoin theo tỷ lệ nghịch.',
      tradingCue: 'DỮ LIỆU: Dẫn dắt quan trọng cho các báo cáo GDP trong quý.',
    };
  }

  if (t.includes('gdp') || t.includes('gross domestic product')) {
    return {
      titleVN: 'Tăng trưởng Tổng sản phẩm Quốc nội (GDP)',
      category: 'TĂNG TRƯỞNG (GROWTH)',
      impactCrypto: 'TÁC ĐỘNG TRUNG BÌNH - CAO',
      analysis: 'GDP phản ánh tốc độ tăng trưởng kinh tế Mỹ. GDP ổn định giúp củng cố niềm tin vào tài sản rủi ro. Tuy nhiên nếu lạm phát đi kèm GDP giảm (Lạm phát đình trệ - Stagflation), đó là kịch bản xấu cho thị trường tài chính nói chung.',
      tradingCue: 'LƯU Ý: Thường có tác động dai dẳng trong phiên giao dịch Mỹ (US Session).',
    };
  }

  if (t.includes('powell') || t.includes('speech') || t.includes('testifies') || t.includes('phát biểu')) {
    return {
      titleVN: 'Chủ tịch Fed Powell / Quan chức Fed Phát biểu',
      category: 'TÍN HIỆU CHÍNH SÁCH (FED SPEAK)',
      impactCrypto: 'BIẾN ĐỘNG THEO TỪ NGỮ (HAWKISH / DOVISH)',
      analysis: 'Thị trường tài chính luôn soi xét từng từ ngữ của Chủ tịch Fed Powell để đoán định thời điểm cắt giảm hoặc tăng lãi suất tiếp theo. Những phát biểu mang tính ủng hộ nới lỏng (Dovish) sẽ kích hoạt lực mua lập tức trên thị trường Crypto.',
      tradingCue: 'THUẬT TOÁN HFT: Thường quét từ khóa trong bài phát biểu để kích hoạt lệnh.',
    };
  }

  if (t.includes('jolts') || t.includes('job openings')) {
    return {
      titleVN: 'Cơ hội Việc làm JOLTs Mỹ',
      category: 'LAO ĐỘNG (LABOR MARKET)',
      impactCrypto: 'TÁC ĐỘNG TRUNG BÌNH',
      analysis: 'Đo lường số lượng vị trí tuyển dụng còn trống. Số lượng giảm cho thấy thị trường việc làm đang hạ nhiệt, làm tăng kỳ vọng Fed sẽ sớm giảm lãi suất.',
      tradingCue: 'THỜI GIAN: Dữ liệu thường được công bố lúc 21:00 giờ VN.',
    };
  }

  if (t.includes('retail sales') || t.includes('doanh số bán lẻ')) {
    return {
      titleVN: 'Doanh số Bán lẻ Mỹ (Retail Sales)',
      category: 'TIÊU DÙNG (CONSUMER SPENDING)',
      impactCrypto: 'TÁC ĐỘNG TRUNG BÌNH',
      analysis: 'Phản ánh sức mua của người tiêu dùng Mỹ - động lực chính của GDP. Doanh số bán lẻ tốt duy trì tâm lý tích cực trên thị trường chứng khoán và tiền điện tử.',
      tradingCue: 'KHUNG GIỜ: Công bố cùng khung giờ với nhiều dữ liệu kinh tế khác.',
    };
  }

  // Default fallback analysis
  return {
    titleVN: title,
    category: `VĨ MÔ (${country.toUpperCase()})`,
    impactCrypto: impact.toLowerCase() === 'high' ? 'TÁC ĐỘNG CAO ĐẾN BIẾN ĐỘNG GIÁ' : 'TÁC ĐỘNG VỪA PHẢI',
    analysis: `Sự kiện kinh tế vĩ mô của ${country}. Các số liệu thực tế (Actual) chênh lệch lớn so với dự báo (Forecast) sẽ gây biến động mạnh cho tỷ giá ngoại tệ, chỉ số DXY và lan tỏa sang thị trường tiền điện tử Bitcoin.`,
    tradingCue: 'THEO DÕI: Diễn biến giá BTC và dòng tiền khối ngoại tại thời điểm tin công bố.',
  };
}

/**
 * Generate Curated Fallback Weekly Calendar (Ensures 7 square boxes always have great events)
 */
function getCuratedWeeklyEvents(weekDays) {
  const curated = [];
  const templates = [
    // Mon (Index 0)
    { dayIdx: 0, timeStr: '19:30', title: 'Đấu giá Trái phiếu Chính phủ Mỹ 3 tháng & 6 tháng (T-Bill Auction)', country: 'USD', impact: 'Medium', actual: '4.85%', forecast: '4.85%', previous: '4.90%' },
    { dayIdx: 0, timeStr: '21:30', title: 'Chỉ số PMI Sản xuất Dallas Fed (Dallas Fed Mfg Business Index)', country: 'USD', impact: 'Low', actual: '', forecast: '-14.2', previous: '-15.1' },
    // Tue (Index 1)
    { dayIdx: 1, timeStr: '21:00', title: 'Cơ hội Việc làm JOLTs Mỹ (JOLTs Job Openings)', country: 'USD', impact: 'High', actual: '', forecast: '8.05M', previous: '8.14M' },
    { dayIdx: 1, timeStr: '21:00', title: 'Niềm tin Người tiêu dùng CB (CB Consumer Confidence)', country: 'USD', impact: 'Medium', actual: '', forecast: '100.2', previous: '100.4' },
    // Wed (Index 2)
    { dayIdx: 2, timeStr: '19:15', title: 'Thay đổi Việc làm Phi nông nghiệp ADP (ADP Non-Farm)', country: 'USD', impact: 'High', actual: '', forecast: '152K', previous: '156K' },
    { dayIdx: 2, timeStr: '21:30', title: 'Báo cáo Tồn kho Dầu thô EIA (Crude Oil Inventories)', country: 'USD', impact: 'Low', actual: '', forecast: '-1.8M', previous: '-2.5M' },
    { dayIdx: 2, timeStr: '01:00', title: 'Quyết định Lãi suất FOMC (FOMC Interest Rate Decision)', country: 'USD', impact: 'High', actual: '', forecast: '5.25%', previous: '5.50%' },
    { dayIdx: 2, timeStr: '01:30', title: 'Họp báo Chủ tịch Fed Powell (FOMC Press Conference)', country: 'USD', impact: 'High', actual: '', forecast: '---', previous: '---' },
    // Thu (Index 3)
    { dayIdx: 3, timeStr: '19:30', title: 'Đề nghị Trợ cấp Thất nghiệp Lần đầu (Initial Jobless Claims)', country: 'USD', impact: 'High', actual: '', forecast: '235K', previous: '233K' },
    { dayIdx: 3, timeStr: '21:00', title: 'Chỉ số PMI Sản xuất ISM (ISM Manufacturing PMI)', country: 'USD', impact: 'High', actual: '', forecast: '48.8', previous: '48.5' },
    // Fri (Index 4)
    { dayIdx: 4, timeStr: '19:30', title: 'Bảng lương Phi nông nghiệp Mỹ (Non-Farm Payrolls - NFP)', country: 'USD', impact: 'High', actual: '', forecast: '175K', previous: '180K' },
    { dayIdx: 4, timeStr: '19:30', title: 'Tỷ lệ Thất nghiệp Mỹ (Unemployment Rate)', country: 'USD', impact: 'High', actual: '', forecast: '4.1%', previous: '4.1%' },
    { dayIdx: 4, timeStr: '19:30', title: 'Thu nhập Bình quân theo Giờ m/m (Average Hourly Earnings)', country: 'USD', impact: 'Medium', actual: '', forecast: '0.3%', previous: '0.4%' },
    // Sat (Index 5)
    { dayIdx: 5, timeStr: '02:30', title: 'Báo cáo Vị thế Giao dịch CFTC COT Report (Commitments of Traders)', country: 'USD', impact: 'Medium', actual: '---', forecast: '---', previous: 'Net Long 14.5K' },
    { dayIdx: 5, timeStr: '09:00', title: 'Tổng kết Dòng tiền Quỹ ETF Bitcoin & Ethereum Spot Tuần', country: 'USD', impact: 'High', actual: '', forecast: '+$450M', previous: '+$380M' },
    // Sun (Index 6)
    { dayIdx: 6, timeStr: '07:00', title: 'Đóng cửa Tuần Nến BTC & Đánh giá Thanh khoản M2 Toàn cầu', country: 'USD', impact: 'Medium', actual: '', forecast: '---', previous: '---' },
  ];

  templates.forEach((tmpl, id) => {
    const targetDay = weekDays[tmpl.dayIdx];
    if (!targetDay) return;

    const analysis = getEventCryptoAnalysis(tmpl.title, tmpl.country, tmpl.impact);
    curated.push({
      id: `curated_${id}_${tmpl.dayIdx}`,
      title: tmpl.title,
      titleVN: analysis.titleVN,
      country: tmpl.country,
      impact: tmpl.impact,
      timeStr: tmpl.timeStr,
      dateStr: targetDay.dateStr,
      fullDateStr: targetDay.fullDateStr,
      dayIndex: tmpl.dayIdx,
      actual: tmpl.actual ?? '',
      forecast: tmpl.forecast ?? '',
      previous: tmpl.previous ?? '',
      category: analysis.category,
      impactCrypto: analysis.impactCrypto,
      analysis: analysis.analysis,
      tradingCue: analysis.tradingCue,
      isLive: false,
    });
  });

  return curated;
}

/**
 * Fetch and structure weekly economic events into 7-day square boxes
 */
export async function getWeeklyEconomicCalendar(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedEvents && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedEvents;
  }

  const weekDays = getCurrentWeekDays();
  let rawEvents = null;

  try {
    const calendarUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    try {
      const res = await axios.get(`https://corsproxy.io/?${encodeURIComponent(calendarUrl)}`, { timeout: 6000 });
      rawEvents = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } catch {
      const res2 = await axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(calendarUrl)}`, { timeout: 6000 });
      rawEvents = typeof res2.data === 'string' ? JSON.parse(res2.data) : res2.data;
    }
  } catch (err) {
    console.warn('[EconomicCalendar] API fetch failed, using curated fallback:', err?.message);
  }

  let formattedEvents = [];
  let releasedActuals = new Map();

  if (rawEvents && Array.isArray(rawEvents) && rawEvents.length > 0) {
    try {
      releasedActuals = await getReleasedEventActuals(rawEvents);
    } catch (err) {
      console.warn('[EconomicCalendar] Actual result lookup failed:', err?.message);
    }
  }

  if (rawEvents && Array.isArray(rawEvents) && rawEvents.length > 0) {
    rawEvents.forEach((e, idx) => {
      if (!e.date || !e.title) return;
      const eventDate = new Date(e.date);

      // Match eventDate with one of our weekDays
      const matchedDay = weekDays.find((d) =>
        d.dateObj.getDate() === eventDate.getDate() &&
        d.dateObj.getMonth() === eventDate.getMonth() &&
        d.dateObj.getFullYear() === eventDate.getFullYear()
      );

      if (matchedDay && ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD'].includes(e.country?.toUpperCase())) {
        const timeStr = eventDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const analysis = getEventCryptoAnalysis(e.title, e.country, e.impact);

        formattedEvents.push({
          id: `live_${idx}_${eventDate.getTime()}`,
          title: e.title,
          titleVN: analysis.titleVN,
          country: e.country?.toUpperCase() || 'USD',
          impact: e.impact?.trim() ? (e.impact.charAt(0).toUpperCase() + e.impact.slice(1).toLowerCase()) : 'Medium',
          timeStr,
          dateStr: matchedDay.dateStr,
          fullDateStr: matchedDay.fullDateStr,
          dayIndex: matchedDay.dayIndex,
          actual: e.actual ?? releasedActuals.get(getActualLookupKey(e.date.slice(0, 10), e.country, e.title)) ?? '',
          forecast: e.forecast ?? '',
          previous: e.previous ?? '',
          category: analysis.category,
          impactCrypto: analysis.impactCrypto,
          analysis: analysis.analysis,
          tradingCue: analysis.tradingCue,
          isLive: true,
        });
      }
    });
  }

  // If live events are too sparse or failed, merge with curated weekly events
  const curated = getCuratedWeeklyEvents(weekDays);

  // Preserve every live event (including released Actual values), then use curated
  // items only for days where the source returned no events at all.
  if (formattedEvents.length === 0) {
    formattedEvents = curated;
  } else {
    curated.forEach((curatedEvent) => {
      const hasLiveEventThatDay = formattedEvents.some((liveEvent) => liveEvent.dayIndex === curatedEvent.dayIndex);
      if (!hasLiveEventThatDay) formattedEvents.push(curatedEvent);
    });
  }

  // Populate events into weekDays array
  weekDays.forEach((day) => {
    day.events = formattedEvents
      .filter((e) => e.dayIndex === day.dayIndex)
      .sort((a, b) => a.timeStr.localeCompare(b.timeStr));
  });

  const result = {
    weekDays,
    allEvents: formattedEvents,
    lastUpdated: Date.now(),
  };

  cachedEvents = result;
  lastFetchTime = Date.now();
  return result;
}

const finite = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const signWithDeadband = (value, deadband) => {
  const parsed = finite(value);
  if (parsed == null) return 'unknown';
  if (parsed > deadband) return 'up';
  if (parsed < -deadband) return 'down';
  return 'flat';
};

const flowWithDeadband = (value, deadband) => {
  const direction = signWithDeadband(value, deadband);
  if (direction === 'up') return 'buy';
  if (direction === 'down') return 'sell';
  return direction === 'flat' ? 'neutral' : 'unknown';
};

function crowdingContext(fundingRate, basisPct) {
  const funding = finite(fundingRate);
  const basis = finite(basisPct);
  const longCrowded = (funding != null && funding >= 0.0005) || (basis != null && basis >= 0.25);
  const shortCrowded = (funding != null && funding <= -0.0005) || (basis != null && basis <= -0.25);

  if (longCrowded) {
    return {
      state: 'CROWDED_LONGS',
      label: 'Long đang crowded',
      detail: 'Funding hoặc basis dương cao làm tăng chi phí và rủi ro long unwind.',
      tone: 'warning',
    };
  }
  if (shortCrowded) {
    return {
      state: 'CROWDED_SHORTS',
      label: 'Short đang crowded',
      detail: 'Funding hoặc basis âm sâu làm tăng rủi ro short squeeze.',
      tone: 'warning',
    };
  }
  if (funding == null && basis == null) {
    return {
      state: 'UNKNOWN',
      label: 'Crowding chưa rõ',
      detail: 'Chưa có Funding và Basis để đánh giá chi phí vị thế.',
      tone: 'neutral',
    };
  }
  return {
    state: 'BALANCED',
    label: 'Crowding cân bằng',
    detail: 'Funding và basis chưa ở vùng cực đoan.',
    tone: 'neutral',
  };
}

function dataQuality({ priceChangePct, cvdRatioPct, oiChangePct, fundingRate, basisPct, coveragePct }) {
  const required = [priceChangePct, cvdRatioPct, oiChangePct].filter((value) => finite(value) != null).length;
  if (required < 3) {
    return {
      level: 'INSUFFICIENT',
      label: 'Thiếu dữ liệu lõi',
      detail: 'Cần đồng thời Price 24H, Futures CVD/Volume và ΔOI 24H.',
    };
  }

  const coverage = finite(coveragePct);
  const contextCount = [fundingRate, basisPct].filter((value) => finite(value) != null).length;
  if ((coverage != null && coverage < 70) || contextCount === 0) {
    return {
      level: 'DEGRADED',
      label: 'Bằng chứng giới hạn',
      detail: coverage != null && coverage < 70
        ? `Coverage OI/CVD mới đạt ${coverage.toFixed(0)}%.`
        : 'Thiếu Funding và Basis; vẫn phân loại được flow nhưng chưa đánh giá crowding.',
    };
  }
  return {
    level: contextCount === 2 && (coverage == null || coverage >= 95) ? 'HIGH' : 'MEDIUM',
    label: contextCount === 2 && (coverage == null || coverage >= 95) ? 'Bằng chứng đầy đủ' : 'Bằng chứng khá',
    detail: 'Price, Futures CVD và ΔOI cùng horizon; Funding/Basis chỉ dùng làm context.',
  };
}

const BASE = {
  flow: 'UNKNOWN',
  bias: 'MIXED',
  mechanism: 'UNRESOLVED',
  state: 'INSUFFICIENT_EVIDENCE',
  label: 'Chưa đủ dữ liệu',
  detail: 'Chờ Price, Futures CVD và Open Interest cùng đầy đủ.',
  tone: 'neutral',
};

export function classifyCapitalFlow({
  priceChangePct,
  cvdRatioPct,
  oiChangePct,
  fundingRate,
  basisPct,
  coveragePct,
  thresholds = {},
} = {}) {
  const priceDeadband = finite(thresholds.pricePct) ?? 0.15;
  const oiDeadband = finite(thresholds.oiPct) ?? 0.15;
  const cvdDeadband = finite(thresholds.cvdRatioPct) ?? 0.15;
  const priceDirection = signWithDeadband(priceChangePct, priceDeadband);
  const oiDirection = signWithDeadband(oiChangePct, oiDeadband);
  const cvdDirection = flowWithDeadband(cvdRatioPct, cvdDeadband);
  const quality = dataQuality({ priceChangePct, cvdRatioPct, oiChangePct, fundingRate, basisPct, coveragePct });
  const crowding = crowdingContext(fundingRate, basisPct);

  const result = {
    ...BASE,
    horizon: '24H',
    priceDirection,
    cvdDirection,
    oiDirection,
    quality,
    crowding,
  };

  if (quality.level === 'INSUFFICIENT') return result;

  if (oiDirection === 'up') {
    if (priceDirection === 'up' && cvdDirection === 'buy') {
      return {
        ...result,
        flow: 'IN', bias: 'LONG', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_LONG_BIAS', tone: 'bullish',
        label: 'Vốn vào · Long bias',
        detail: 'OI mở rộng trong khi giá và aggressive Futures flow cùng tăng.',
      };
    }
    if (priceDirection === 'down' && cvdDirection === 'sell') {
      return {
        ...result,
        flow: 'IN', bias: 'SHORT', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_SHORT_BIAS', tone: 'bearish',
        label: 'Vốn vào · Short bias',
        detail: 'OI mở rộng trong khi giá và aggressive Futures flow cùng giảm.',
      };
    }
    if (priceDirection === 'up' && cvdDirection === 'sell') {
      return {
        ...result,
        flow: 'IN', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'SELL_ABSORPTION_WITH_OI_IN', tone: 'constructive',
        label: 'Vốn vào · Sell absorption',
        detail: 'OI tăng và giá đi lên dù aggressive flow nghiêng bán; bên mua thụ động đang hấp thụ.',
      };
    }
    if (priceDirection === 'down' && cvdDirection === 'buy') {
      return {
        ...result,
        flow: 'IN', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'BUY_ABSORPTION_OR_TRAPPED_LONGS', tone: 'warning',
        label: 'Vốn vào · Buy absorption',
        detail: 'OI tăng nhưng aggressive buy chưa nâng được giá; có thể là hấp thụ hoặc long bị kẹt.',
      };
    }
    return {
      ...result,
      flow: 'IN', bias: 'MIXED', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_MIXED', tone: 'warning',
      label: 'Vốn vào · Chưa rõ hướng',
      detail: 'OI đang mở rộng nhưng Price và Futures CVD chưa xác nhận cùng một hướng.',
    };
  }

  if (oiDirection === 'down') {
    if (priceDirection === 'up' && cvdDirection === 'buy') {
      return {
        ...result,
        flow: 'OUT', bias: 'SHORT', mechanism: 'SHORT_COVERING', state: 'CAPITAL_OUT_SHORT_COVER', tone: 'constructive',
        label: 'Vốn ra · Short covering',
        detail: 'Giá và aggressive buy tăng trong khi OI co lại; gross exposure rời khỏi vị thế short.',
      };
    }
    if (priceDirection === 'down' && cvdDirection === 'sell') {
      return {
        ...result,
        flow: 'OUT', bias: 'LONG', mechanism: 'LONG_EXIT_OR_LIQUIDATION', state: 'CAPITAL_OUT_LONG_EXIT', tone: 'bearish',
        label: 'Vốn ra · Long exit',
        detail: 'Giá, aggressive sell và OI cùng giảm; chưa thể tách voluntary close với liquidation.',
      };
    }
    return {
      ...result,
      flow: 'OUT', bias: 'MIXED', mechanism: 'POSITION_CLOSING', state: 'CAPITAL_OUT_MIXED', tone: 'warning',
      label: 'Vốn ra · Đóng vị thế hỗn hợp',
      detail: 'OI đang co lại nhưng Price và Futures CVD chưa xác định rõ bên rút khỏi exposure.',
    };
  }

  if ((priceDirection === 'up' && cvdDirection === 'sell') || (priceDirection === 'down' && cvdDirection === 'buy')) {
    return {
      ...result,
      flow: 'ROTATION', bias: 'MIXED', mechanism: priceDirection === 'up' ? 'SELL_ABSORPTION' : 'BUY_ABSORPTION', state: 'FLOW_ROTATION', tone: 'warning',
      label: 'Luân chuyển · Absorption',
      detail: 'OI gần như không đổi trong khi giá chống lại aggressive flow; chưa có bằng chứng gross capital mở rộng hoặc co lại.',
    };
  }

  return {
    ...result,
    flow: 'NEUTRAL', bias: 'MIXED', mechanism: 'NO_MATERIAL_CHANGE', state: 'NO_MATERIAL_FLOW_CHANGE', tone: 'neutral',
    label: 'Dòng vốn trung tính',
    detail: 'ΔOI nằm trong deadband; chưa có thay đổi gross derivatives exposure đáng kể.',
  };
}

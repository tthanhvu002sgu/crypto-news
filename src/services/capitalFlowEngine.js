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

function dataQuality({ priceChangePct, cvdRatioPct, oiChangePct, fundingRate, basisPct, coveragePct, horizon = '24H' }) {
  const coverage = finite(coveragePct);
  const required = [priceChangePct, cvdRatioPct, oiChangePct].filter((value) => finite(value) != null).length;
  if (required < 3) {
    return {
      level: 'INSUFFICIENT',
      label: 'Thiếu dữ liệu lõi',
      detail: `Cần đồng thời Price ${horizon}, Futures CVD/Volume và ΔOI ${horizon}.`,
      coveragePct: coverage,
    };
  }

  const contextCount = [fundingRate, basisPct].filter((value) => finite(value) != null).length;
  if ((coverage != null && coverage < 70) || contextCount === 0) {
    return {
      level: 'DEGRADED',
      label: 'Bằng chứng giới hạn',
      detail: coverage != null && coverage < 70
        ? `Coverage OI/CVD mới đạt ${coverage.toFixed(0)}%.`
        : 'Thiếu Funding và Basis; vẫn phân loại được flow nhưng chưa đánh giá crowding.',
      coveragePct: coverage,
    };
  }
  return {
    level: contextCount === 2 && (coverage == null || coverage >= 95) ? 'HIGH' : 'MEDIUM',
    label: contextCount === 2 && (coverage == null || coverage >= 95) ? 'Bằng chứng đầy đủ' : 'Bằng chứng khá',
    detail: 'Price, Futures CVD và ΔOI cùng horizon; Funding/Basis chỉ dùng làm context.',
    coveragePct: coverage,
  };
}

const BASE = {
  flow: 'UNKNOWN',
  actionBadge: 'UNKNOWN',
  bias: 'MIXED',
  mechanism: 'UNRESOLVED',
  state: 'INSUFFICIENT_EVIDENCE',
  label: 'Chưa đủ dữ liệu',
  detail: 'Chờ Price, Futures CVD và Open Interest cùng đầy đủ.',
  tone: 'neutral',
};

function spotAlignmentContext(futuresFlow, spotCvdRatioPct, spotNetDelta) {
  const spotRatio = finite(spotCvdRatioPct);
  const spotNet = finite(spotNetDelta);
  if (spotRatio == null && spotNet == null) {
    return {
      state: 'UNAVAILABLE',
      direction: 'UNKNOWN',
      label: 'Spot chưa rõ',
      detail: 'Chưa có dữ liệu Spot CVD 24h để đánh giá đồng thuận.',
      tone: 'neutral',
    };
  }
  const spotDeadband = 0.15;
  const isSpotBuy = spotRatio != null ? spotRatio > spotDeadband : spotNet > 0;
  const isSpotSell = spotRatio != null ? spotRatio < -spotDeadband : spotNet < 0;

  const isFuturesBuy = futuresFlow === 'BUY' || futuresFlow === 'LONG';
  const isFuturesSell = futuresFlow === 'SELL' || futuresFlow === 'SHORT';

  if (isFuturesBuy) {
    if (isSpotBuy) {
      return {
        state: 'SPOT_CONFLUENCE',
        direction: 'BUY',
        label: 'Spot đồng thuận mua',
        detail: 'Cả Futures lẫn Spot đều mua chủ động; tiền thịt ủng hộ đà tăng.',
        tone: 'bullish',
      };
    }
    if (isSpotSell) {
      return {
        state: 'SPOT_DIVERGENCE',
        direction: 'SELL',
        label: 'Spot phân kỳ bán',
        detail: 'Futures mua chủ động nhưng Spot đang bán ròng; rủi ro đòn bẩy quá mức hoặc bị xả hàng.',
        tone: 'warning',
      };
    }
    return {
      state: 'SPOT_NEUTRAL',
      direction: 'NEUTRAL',
      label: 'Spot đi ngang',
      detail: 'Spot CVD đi ngang; đà tăng chủ yếu do dòng tiền phái sinh dẫn dắt.',
      tone: 'neutral',
    };
  }

  if (isFuturesSell) {
    if (isSpotSell) {
      return {
        state: 'SPOT_CONFLUENCE',
        direction: 'SELL',
        label: 'Spot đồng thuận bán',
        detail: 'Cả Futures lẫn Spot đều bán chủ động; áp lực bán bao trùm cả hai thị trường.',
        tone: 'bearish',
      };
    }
    if (isSpotBuy) {
      return {
        state: 'SPOT_DIVERGENCE',
        direction: 'BUY',
        label: 'Spot phân kỳ mua',
        detail: 'Futures ép bán nhưng Spot đang mua ròng; tiềm ẩn bẫy giá giảm hoặc hấp thụ.',
        tone: 'warning',
      };
    }
    return {
      state: 'SPOT_NEUTRAL',
      direction: 'NEUTRAL',
      label: 'Spot đi ngang',
      detail: 'Spot CVD đi ngang; đà giảm chủ yếu do dòng tiền phái sinh dẫn dắt.',
      tone: 'neutral',
    };
  }

  // If Futures flow is MIXED or flat
  if (isSpotBuy) {
    return {
      state: 'SPOT_BUY_LEAD',
      direction: 'BUY',
      label: 'Spot mua ròng',
      detail: 'Thị trường phái sinh chưa rõ hướng nhưng Spot đang có lực mua chủ động.',
      tone: 'bullish',
    };
  }
  if (isSpotSell) {
    return {
      state: 'SPOT_SELL_LEAD',
      direction: 'SELL',
      label: 'Spot bán ròng',
      detail: 'Thị trường phái sinh chưa rõ hướng nhưng Spot đang có lực bán chủ động.',
      tone: 'bearish',
    };
  }
  return {
    state: 'BALANCED',
    direction: 'NEUTRAL',
    label: 'Spot cân bằng',
    detail: 'Dòng tiền Spot ở trạng thái cân bằng trong biên độ hẹp.',
    tone: 'neutral',
  };
}

export { spotAlignmentContext };

const HORIZON_THRESHOLDS = {
  '24H': { pricePct: 0.15, oiPct: 0.15, cvdRatioPct: 0.15, strongCvdRatioPct: 1.5 },
  '7D': { pricePct: 0.5, oiPct: 0.5, cvdRatioPct: 0.15, strongCvdRatioPct: 1.2 },
  '30D': { pricePct: 1.0, oiPct: 1.0, cvdRatioPct: 0.15, strongCvdRatioPct: 1.0 },
};

export function classifyCapitalFlow({
  priceChangePct,
  cvdRatioPct,
  oiChangePct,
  fundingRate,
  basisPct,
  coveragePct,
  spotCvdRatioPct,
  spotNetDelta,
  horizon = '24H',
  thresholds = {},
} = {}) {
  const normalizedHorizon = HORIZON_THRESHOLDS[String(horizon).toUpperCase()] ? String(horizon).toUpperCase() : '24H';
  const defaultThresholds = HORIZON_THRESHOLDS[normalizedHorizon];
  const priceDeadband = finite(thresholds.pricePct) ?? defaultThresholds.pricePct;
  const oiDeadband = finite(thresholds.oiPct) ?? defaultThresholds.oiPct;
  const cvdDeadband = finite(thresholds.cvdRatioPct) ?? defaultThresholds.cvdRatioPct;
  const strongCvdThreshold = finite(thresholds.strongCvdRatioPct) ?? defaultThresholds.strongCvdRatioPct;
  const priceDirection = signWithDeadband(priceChangePct, priceDeadband);
  const oiDirection = signWithDeadband(oiChangePct, oiDeadband);
  const cvdDirection = flowWithDeadband(cvdRatioPct, cvdDeadband);
  const absCvdRatio = Math.abs(finite(cvdRatioPct) ?? 0);
  const isStrongFlowPinnedPrice = priceDirection === 'flat' && absCvdRatio >= strongCvdThreshold;
  const quality = dataQuality({
    priceChangePct,
    cvdRatioPct,
    oiChangePct,
    fundingRate,
    basisPct,
    coveragePct,
    horizon: normalizedHorizon,
  });
  const crowding = crowdingContext(fundingRate, basisPct);

  const result = {
    ...BASE,
    horizon: normalizedHorizon,
    priceDirection,
    cvdDirection,
    oiDirection,
    quality,
    crowding,
  };

  const resolveResult = () => {
    if (quality.level === 'INSUFFICIENT') return result;

    if (oiDirection === 'up') {
      if (priceDirection === 'up' && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'LONG BUILD-UP', bias: 'LONG', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_LONG_BIAS', tone: 'bullish',
          label: 'Mở vị thế Long',
          detail: 'OI mở rộng trong khi giá và aggressive Futures flow cùng tăng.',
        };
      }
      if (priceDirection === 'down' && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'SHORT BUILD-UP', bias: 'SHORT', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_SHORT_BIAS', tone: 'bearish',
          label: 'Mở vị thế Short',
          detail: 'OI mở rộng trong khi giá và aggressive Futures flow cùng giảm.',
        };
      }
      if (priceDirection === 'up' && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'SELL_ABSORPTION_WITH_OI_IN', tone: 'constructive',
          label: 'Hấp thụ lực bán',
          detail: 'OI tăng và giá đi lên dù aggressive flow nghiêng bán; bên mua thụ động đang hấp thụ.',
        };
      }
      if (priceDirection === 'down' && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'BUY_ABSORPTION_OR_TRAPPED_LONGS', tone: 'warning',
          label: 'Hấp thụ lực mua (Kẹt Long)',
          detail: 'OI tăng nhưng aggressive buy chưa nâng được giá; có thể là hấp thụ hoặc long bị kẹt.',
        };
      }
      if (isStrongFlowPinnedPrice && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'SELL_ABSORPTION_WITH_OI_IN', tone: 'constructive',
          label: 'Hấp thụ lực bán',
          detail: 'Bán chủ động mạnh nhưng giá đi ngang nhờ tường Limit Bid đỡ, trong khi OI mở rộng.',
        };
      }
      if (isStrongFlowPinnedPrice && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'IN', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'BUY_ABSORPTION_OR_TRAPPED_LONGS', tone: 'warning',
          label: 'Hấp thụ lực mua (Kẹt Long)',
          detail: 'Mua chủ động mạnh nhưng giá bị chặn đi ngang bởi tường Limit Ask, trong khi OI mở rộng.',
        };
      }
      return {
        ...result,
        flow: 'IN', actionBadge: 'BUILD-UP', bias: 'MIXED', mechanism: 'NEW_POSITION', state: 'CAPITAL_IN_MIXED', tone: 'warning',
        label: 'Mở vị thế chưa rõ hướng',
        detail: 'OI đang mở rộng nhưng Price và Futures CVD chưa xác nhận cùng một hướng.',
      };
    }

    if (oiDirection === 'down') {
      if (priceDirection === 'up' && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'SHORT COVER', bias: 'SHORT', mechanism: 'SHORT_COVERING', state: 'CAPITAL_OUT_SHORT_COVER', tone: 'constructive',
          label: 'Đóng vị thế Short',
          detail: 'Giá và aggressive buy tăng trong khi OI co lại; gross exposure rời khỏi vị thế short.',
        };
      }
      if (priceDirection === 'down' && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'LONG UNWIND', bias: 'LONG', mechanism: 'LONG_EXIT_OR_LIQUIDATION', state: 'CAPITAL_OUT_LONG_EXIT', tone: 'bearish',
          label: 'Thoát vị thế Long',
          detail: 'Giá, aggressive sell và OI cùng giảm; chưa thể tách voluntary close với liquidation.',
        };
      }
      if (priceDirection === 'up' && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'SELL_ABSORPTION_WITH_OI_OUT', tone: 'constructive',
          label: 'Hấp thụ lực bán',
          detail: 'OI co lại và giá vẫn tăng dù aggressive flow nghiêng bán; lực bán thoát vị thế đang được hấp thụ.',
        };
      }
      if (priceDirection === 'down' && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'BUY_ABSORPTION_WITH_OI_OUT', tone: 'warning',
          label: 'Hấp thụ lực mua',
          detail: 'OI co lại và giá vẫn giảm dù aggressive flow nghiêng mua; lực mua đóng Short bị tường Limit Ask hấp thụ.',
        };
      }
      if (isStrongFlowPinnedPrice && cvdDirection === 'sell') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'SELL_ABSORPTION_WITH_OI_OUT', tone: 'constructive',
          label: 'Hấp thụ lực bán',
          detail: 'Bán chủ động mạnh (thoát vị thế) nhưng giá đi ngang nhờ tường Limit Bid hấp thụ.',
        };
      }
      if (isStrongFlowPinnedPrice && cvdDirection === 'buy') {
        return {
          ...result,
          flow: 'OUT', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'BUY_ABSORPTION_WITH_OI_OUT', tone: 'warning',
          label: 'Hấp thụ lực mua',
          detail: 'Mua chủ động mạnh (đóng Short) nhưng giá bị chặn đi ngang bởi tường Limit Ask hấp thụ.',
        };
      }
      return {
        ...result,
        flow: 'OUT', actionBadge: 'UNWIND', bias: 'MIXED', mechanism: 'POSITION_CLOSING', state: 'CAPITAL_OUT_MIXED', tone: 'warning',
        label: 'Đóng vị thế hỗn hợp',
        detail: 'OI đang co lại nhưng Price và Futures CVD chưa xác định rõ bên rút khỏi exposure.',
      };
    }

    if (priceDirection === 'up' && cvdDirection === 'buy') {
      return {
        ...result,
        flow: 'ROTATION', actionBadge: 'ROTATION', bias: 'LONG', mechanism: 'POSITION_TURNOVER', state: 'FLOW_ROTATION_BULLISH', tone: 'constructive',
        label: 'Luân chuyển tăng',
        detail: 'Giá và aggressive buy cùng tăng trong khi OI gần như không đổi; dòng tiền xoay vòng theo chiều tăng (Long mới thay Short đóng).',
      };
    }

    if (priceDirection === 'down' && cvdDirection === 'sell') {
      return {
        ...result,
        flow: 'ROTATION', actionBadge: 'ROTATION', bias: 'SHORT', mechanism: 'POSITION_TURNOVER', state: 'FLOW_ROTATION_BEARISH', tone: 'bearish',
        label: 'Luân chuyển giảm',
        detail: 'Giá và aggressive sell cùng giảm trong khi OI gần như không đổi; dòng tiền xoay vòng theo chiều giảm (Short mới thay Long thoát).',
      };
    }

    if ((priceDirection === 'up' && cvdDirection === 'sell') || (isStrongFlowPinnedPrice && cvdDirection === 'sell')) {
      return {
        ...result,
        flow: 'ROTATION', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'SELL_ABSORPTION', state: 'FLOW_ROTATION_SELL_ABSORPTION', tone: 'constructive',
        label: 'Luân chuyển · Hấp thụ bán',
        detail: isStrongFlowPinnedPrice
          ? 'Áp lực bán chủ động mạnh nhưng giá bị kìm đi ngang và OI gần như không đổi; dấu hiệu tường Limit Bid hấp thụ.'
          : 'OI gần như không đổi nhưng giá vẫn tăng ngược áp lực bán chủ động; lực bán đang được hấp thụ.',
      };
    }

    if ((priceDirection === 'down' && cvdDirection === 'buy') || (isStrongFlowPinnedPrice && cvdDirection === 'buy')) {
      return {
        ...result,
        flow: 'ROTATION', actionBadge: 'ABSORPTION', bias: 'MIXED', mechanism: 'BUY_ABSORPTION', state: 'FLOW_ROTATION_BUY_ABSORPTION', tone: 'warning',
        label: 'Luân chuyển · Hấp thụ mua',
        detail: isStrongFlowPinnedPrice
          ? 'Áp lực mua chủ động mạnh nhưng giá bị chặn đi ngang và OI gần như không đổi; dấu hiệu tường Limit Ask hấp thụ.'
          : 'OI gần như không đổi nhưng giá vẫn giảm ngược áp lực mua chủ động; lực mua đang bị hấp thụ.',
      };
    }

    return {
      ...result,
      flow: 'NEUTRAL', actionBadge: 'NEUTRAL', bias: 'MIXED', mechanism: 'NO_MATERIAL_CHANGE', state: 'NO_MATERIAL_FLOW_CHANGE', tone: 'neutral',
      label: 'Dòng vốn đi ngang',
      detail: 'ΔOI nằm trong deadband; chưa có thay đổi gross derivatives exposure đáng kể.',
    };
  };

  const finalResult = resolveResult();
  const futuresFlow = finalResult.cvdDirection === 'buy' ? 'BUY'
    : finalResult.cvdDirection === 'sell' ? 'SELL'
    : (finalResult.bias === 'LONG' ? 'BUY' : finalResult.bias === 'SHORT' ? 'SELL' : 'MIXED');
  const spotAlignment = spotAlignmentContext(futuresFlow, spotCvdRatioPct, spotNetDelta);

  return {
    ...finalResult,
    spotAlignment,
  };
}

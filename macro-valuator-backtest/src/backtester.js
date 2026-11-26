import fs from 'node:fs/promises';
import path from 'node:path';
import { barsPerYear, calculateMacroDashboard, ZONES } from './engine.js';

export const DEFAULT_HORIZONS_BY_TF = Object.freeze({
  D: [30, 90, 180, 365],
  W: [4, 12, 26, 52],
  M: [3, 6, 12, 24],
});

const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
};

const summarizeReturns = (samples) => {
  if (samples.length === 0) {
    return {
      count: 0,
      winRatePct: null,
      meanPct: null,
      medianPct: null,
      p25Pct: null,
      p75Pct: null,
      minPct: null,
      maxPct: null,
      meanMaePct: null,
    };
  }
  const returns = samples.map((s) => s.retPct).sort((a, b) => a - b);
  const maes = samples.map((s) => s.maePct);
  const wins = returns.filter((r) => r > 0).length;
  const meanPct = returns.reduce((acc, r) => acc + r, 0) / returns.length;
  const meanMaePct = maes.reduce((acc, m) => acc + m, 0) / maes.length;
  return {
    count: returns.length,
    winRatePct: (wins / returns.length) * 100,
    meanPct,
    medianPct: quantile(returns, 0.5),
    p25Pct: quantile(returns, 0.25),
    p75Pct: quantile(returns, 0.75),
    minPct: returns[0],
    maxPct: returns[returns.length - 1],
    meanMaePct,
  };
};

/**
 * Compute forward-return distributions grouped by a key function on each evaluated bar.
 * Strictly no-lookahead: uses entry = series[i].close (or next bar open if requested)
 * and exit = series[i + horizon].close.
 */
export function computeForwardStudy(series, {
  startIndex = 0,
  endIndex = series.length - 1,
  horizons = [4, 12, 26, 52],
  groupBy = (row) => row.decision,
  executionMode = 'next_open',
} = {}) {
  const buckets = new Map();

  for (let i = startIndex; i <= endIndex; i += 1) {
    const row = series[i];
    const groupKey = groupBy(row);
    if (groupKey == null || groupKey === false) continue;

    const entryIdx = executionMode === 'next_open' ? i + 1 : i;
    if (entryIdx >= series.length) continue;
    const entryPrice = executionMode === 'next_open' ? series[entryIdx].open : series[entryIdx].close;
    if (!(entryPrice > 0)) continue;

    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, { key: String(groupKey), signals: 0, byHorizon: new Map() });
      for (const h of horizons) buckets.get(groupKey).byHorizon.set(h, []);
    }
    const bucket = buckets.get(groupKey);
    bucket.signals += 1;

    for (const h of horizons) {
      const targetIdx = i + h;
      if (targetIdx >= series.length || targetIdx <= entryIdx) continue;
      const exitPrice = series[targetIdx].close;
      let minLow = Infinity;
      for (let k = entryIdx; k <= targetIdx; k += 1) {
        if (series[k].low < minLow) minLow = series[k].low;
      }
      const retPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const maePct = ((minLow - entryPrice) / entryPrice) * 100;
      bucket.byHorizon.get(h).push({ retPct, maePct });
    }
  }

  const rows = [];
  for (const bucket of buckets.values()) {
    const horizonStats = {};
    for (const h of horizons) {
      horizonStats[h] = summarizeReturns(bucket.byHorizon.get(h));
    }
    rows.push({
      key: bucket.key,
      signals: bucket.signals,
      horizons: horizonStats,
    });
  }
  return rows;
}

const computePerformanceMetrics = ({
  equityCurve,
  trades,
  initialCapital,
  timeframe,
  barsInMarket,
  totalFeesPaid,
}) => {
  const n = equityCurve.length;
  if (n === 0) {
    return {
      initialCapital,
      finalEquity: initialCapital,
      totalReturnPct: 0,
      cagrPct: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      sortino: 0,
      calmar: 0,
      timeInMarketPct: 0,
      tradeCount: 0,
      closedTrades: 0,
      winRatePct: null,
      profitFactor: null,
      totalFeesPaid: 0,
    };
  }

  const finalEquity = equityCurve[n - 1].equity;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  const firstTime = equityCurve[0].time.getTime();
  const lastTime = equityCurve[n - 1].time.getTime();
  const elapsedYears = Math.max((lastTime - firstTime) / (365.25 * 24 * 3600 * 1000), n / barsPerYear(timeframe));
  const cagrPct = elapsedYears > 0 && finalEquity > 0
    ? (Math.pow(finalEquity / initialCapital, 1 / elapsedYears) - 1) * 100
    : 0;

  let peak = initialCapital;
  let maxDrawdownPct = 0;
  const barReturns = [];
  for (let i = 0; i < n; i += 1) {
    const eq = equityCurve[i].equity;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    if (i > 0 && equityCurve[i - 1].equity > 0) {
      barReturns.push((eq - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
    }
  }

  const annFactor = barsPerYear(timeframe);
  const meanRet = barReturns.length > 0
    ? barReturns.reduce((s, r) => s + r, 0) / barReturns.length
    : 0;
  const variance = barReturns.length > 1
    ? barReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (barReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(Math.max(variance, 0));
  const sharpe = stdDev > 0 ? (meanRet / stdDev) * Math.sqrt(annFactor) : 0;

  const downsideSq = barReturns.reduce((s, r) => s + (r < 0 ? r * r : 0), 0);
  const downsideDev = barReturns.length > 1 ? Math.sqrt(downsideSq / (barReturns.length - 1)) : 0;
  const sortino = downsideDev > 0 ? (meanRet / downsideDev) * Math.sqrt(annFactor) : 0;
  const calmar = maxDrawdownPct > 0 ? cagrPct / maxDrawdownPct : 0;

  const closedTrades = trades.filter((t) => t.side === 'SELL' || t.side === 'REBALANCE_DOWN' || t.realizedPnl != null);
  const pnlList = closedTrades.map((t) => t.realizedPnl).filter((v) => Number.isFinite(v));
  const wins = pnlList.filter((v) => v > 0);
  const losses = pnlList.filter((v) => v < 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));

  return {
    initialCapital,
    finalEquity,
    totalReturnPct,
    cagrPct,
    maxDrawdownPct,
    sharpe,
    sortino,
    calmar,
    timeInMarketPct: (barsInMarket / n) * 100,
    tradeCount: trades.length,
    closedTrades: pnlList.length,
    winRatePct: pnlList.length > 0 ? (wins.length / pnlList.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    totalFeesPaid,
  };
};

/**
 * Target-exposure strategy simulator (long-only / cash, 0.0 to 1.0).
 * Signal generated at bar `i` close executes at bar `i+1` open (`next_open`) or bar `i` close (`close`).
 */
export function simulateTargetExposureStrategy({
  name,
  description,
  series,
  startIndex,
  endIndex,
  targetExposureAt,
  initialCapital = 10000,
  feeBps = 10,
  timeframe = 'W',
  executionMode = 'next_open',
}) {
  const feeRate = feeBps / 10000;
  let cash = initialCapital;
  let units = 0;
  let avgCost = 0;
  let currentTarget = 0;
  let totalFeesPaid = 0;
  let barsInMarket = 0;
  const trades = [];
  const equityCurve = [];

  // Map scheduled order from bar i signal -> execution bar index
  const pendingTargetByBar = new Map();

  for (let i = startIndex; i <= endIndex; i += 1) {
    const row = series[i];

    // 1. Execute scheduled order at open (if next_open)
    if (executionMode === 'next_open' && pendingTargetByBar.has(i)) {
      const target = pendingTargetByBar.get(i);
      const execPrice = row.open;
      const eqBefore = cash + units * execPrice;
      const desiredValue = eqBefore * target;
      const currentValue = units * execPrice;
      const deltaValue = desiredValue - currentValue;

      if (Math.abs(deltaValue) > 1e-6 && execPrice > 0) {
        if (deltaValue > 0) {
          const spendable = Math.min(cash, deltaValue);
          const unitsBought = spendable / (execPrice * (1 + feeRate));
          const grossCost = unitsBought * execPrice;
          const fee = grossCost * feeRate;
          if (unitsBought > 0) {
            const totalUnits = units + unitsBought;
            avgCost = totalUnits > 0 ? ((units * avgCost) + grossCost + fee) / totalUnits : execPrice;
            units = totalUnits;
            cash -= (grossCost + fee);
            totalFeesPaid += fee;
            trades.push({
              barIndex: i,
              time: row.time.toISOString(),
              side: 'BUY',
              price: execPrice,
              units: unitsBought,
              notional: grossCost,
              fee,
              targetExposure: target,
              realizedPnl: null,
              reason: pendingTargetByBar.get(`${i}:reason`) || '',
            });
          }
        } else {
          const unitsToSell = Math.min(units, Math.abs(deltaValue) / execPrice);
          const grossProceeds = unitsToSell * execPrice;
          const fee = grossProceeds * feeRate;
          const netProceeds = grossProceeds - fee;
          const realizedPnl = netProceeds - unitsToSell * avgCost;
          if (unitsToSell > 0) {
            units -= unitsToSell;
            if (units < 1e-10) {
              units = 0;
              avgCost = 0;
            }
            cash += netProceeds;
            totalFeesPaid += fee;
            trades.push({
              barIndex: i,
              time: row.time.toISOString(),
              side: target === 0 ? 'SELL' : 'REBALANCE_DOWN',
              price: execPrice,
              units: unitsToSell,
              notional: grossProceeds,
              fee,
              targetExposure: target,
              realizedPnl,
              reason: pendingTargetByBar.get(`${i}:reason`) || '',
            });
          }
        }
      }
      currentTarget = target;
    }

    // 2. Evaluate signal at bar i close
    const nextTarget = targetExposureAt(row, currentTarget);
    if (nextTarget !== currentTarget) {
      const reason = `${row.decision} (comp=${row.composite}, val=${row.valZone}, pnl=${row.pnlZone}, div=${row.divergence})`;
      if (executionMode === 'close') {
        const execPrice = row.close;
        const eqBefore = cash + units * execPrice;
        const desiredValue = eqBefore * nextTarget;
        const currentValue = units * execPrice;
        const deltaValue = desiredValue - currentValue;
        if (Math.abs(deltaValue) > 1e-6 && execPrice > 0) {
          if (deltaValue > 0) {
            const spendable = Math.min(cash, deltaValue);
            const unitsBought = spendable / (execPrice * (1 + feeRate));
            const grossCost = unitsBought * execPrice;
            const fee = grossCost * feeRate;
            const totalUnits = units + unitsBought;
            avgCost = totalUnits > 0 ? ((units * avgCost) + grossCost + fee) / totalUnits : execPrice;
            units = totalUnits;
            cash -= (grossCost + fee);
            totalFeesPaid += fee;
            trades.push({
              barIndex: i,
              time: row.time.toISOString(),
              side: 'BUY',
              price: execPrice,
              units: unitsBought,
              notional: grossCost,
              fee,
              targetExposure: nextTarget,
              realizedPnl: null,
              reason,
            });
          } else {
            const unitsToSell = Math.min(units, Math.abs(deltaValue) / execPrice);
            const grossProceeds = unitsToSell * execPrice;
            const fee = grossProceeds * feeRate;
            const netProceeds = grossProceeds - fee;
            const realizedPnl = netProceeds - unitsToSell * avgCost;
            units -= unitsToSell;
            if (units < 1e-10) {
              units = 0;
              avgCost = 0;
            }
            cash += netProceeds;
            totalFeesPaid += fee;
            trades.push({
              barIndex: i,
              time: row.time.toISOString(),
              side: nextTarget === 0 ? 'SELL' : 'REBALANCE_DOWN',
              price: execPrice,
              units: unitsToSell,
              notional: grossProceeds,
              fee,
              targetExposure: nextTarget,
              realizedPnl,
              reason,
            });
          }
        }
        currentTarget = nextTarget;
      } else if (i + 1 <= endIndex) {
        pendingTargetByBar.set(i + 1, nextTarget);
        pendingTargetByBar.set(`${i + 1}:reason`, reason);
      }
    }

    if (units > 0) barsInMarket += 1;
    const equity = cash + units * row.close;
    equityCurve.push({
      barIndex: i,
      time: row.time,
      price: row.close,
      equity,
      exposure: equity > 0 ? (units * row.close) / equity : 0,
    });
  }

  return {
    name,
    description,
    metrics: computePerformanceMetrics({
      equityCurve,
      trades,
      initialCapital,
      timeframe,
      barsInMarket,
      totalFeesPaid,
    }),
    trades,
    equityCurve,
  };
}

/**
 * Compare Equal DCA vs Value-Weighted DCA (scaling contribution by composite decision).
 */
export function simulateDcaComparison({
  series,
  startIndex,
  endIndex,
  dcaBaseAmount = 1000,
  feeBps = 10,
  executionMode = 'next_open',
}) {
  const feeRate = feeBps / 10000;
  const multiplierFor = (row) => {
    if (row.divergence) return 1.0;
    if (row.composite >= 3) return 2.0;
    if (row.composite >= 1) return 1.5;
    if (row.composite <= -3) return 0.0;
    if (row.composite <= -1) return 0.5;
    return 1.0;
  };

  let eqInvested = 0;
  let eqUnits = 0;
  let valInvested = 0;
  let valUnits = 0;
  let valCashReserve = 0;

  for (let i = startIndex; i <= endIndex; i += 1) {
    const signalRow = series[i];
    const execIdx = executionMode === 'next_open' ? i + 1 : i;
    if (execIdx > endIndex) break;
    const execPrice = executionMode === 'next_open' ? series[execIdx].open : series[execIdx].close;
    if (!(execPrice > 0)) continue;

    // Equal DCA
    const eqNet = dcaBaseAmount / (1 + feeRate);
    eqInvested += dcaBaseAmount;
    eqUnits += eqNet / execPrice;

    // Value-Weighted DCA (same total budget available: unspent cash accumulates in reserve and deploys on 1.5x/2x)
    valCashReserve += dcaBaseAmount;
    const desiredSpend = dcaBaseAmount * multiplierFor(signalRow);
    const actualSpend = Math.min(valCashReserve, desiredSpend);
    if (actualSpend > 0) {
      valCashReserve -= actualSpend;
      valInvested += actualSpend;
      valUnits += (actualSpend / (1 + feeRate)) / execPrice;
    }
  }

  const endPrice = series[endIndex].close;
  const totalBudget = eqInvested;
  const eqValue = eqUnits * endPrice;
  const valPortfolioValue = valUnits * endPrice + valCashReserve;

  return {
    dcaBaseAmount,
    totalBudget,
    endPrice,
    equalDca: {
      invested: eqInvested,
      units: eqUnits,
      avgCost: eqUnits > 0 ? eqInvested / eqUnits : 0,
      finalValue: eqValue,
      roiPct: eqInvested > 0 ? ((eqValue - eqInvested) / eqInvested) * 100 : 0,
    },
    valueWeightedDca: {
      invested: valInvested,
      cashReserve: valCashReserve,
      units: valUnits,
      avgCost: valUnits > 0 ? valInvested / valUnits : 0,
      finalValue: valPortfolioValue,
      roiOnTotalBudgetPct: totalBudget > 0 ? ((valPortfolioValue - totalBudget) / totalBudget) * 100 : 0,
      roiOnDeployedPct: valInvested > 0 ? ((valUnits * endPrice - valInvested) / valInvested) * 100 : 0,
    },
  };
}

export function simulateGreenBubbleDcaSuite({
  series,
  startIndex,
  endIndex,
  dcaBaseAmount = 1000,
  feeBps = 10,
  executionMode = 'next_open',
  cashYieldApy = 0,
}) {
  const feeRate = feeBps / 10000;
  const weeklyYield = cashYieldApy > 0 ? Math.pow(1 + cashYieldApy, 1 / 52) - 1 : 0;
  const isGB = (row) => row.composite >= 3 && !row.divergence;
  const isRB = (row) => row.composite <= -3 && !row.divergence;

  const modes = [
    {
      key: 'gb_paced_3x',
      name: 'GB Paced 3x ($3k/GB wk)',
      decide: ({ row }) => (isGB(row) ? { buyUsd: dcaBaseAmount * 3 } : {}),
    },
    {
      key: 'gb_paced_5x',
      name: 'GB Paced 5x ($5k/GB wk)',
      decide: ({ row }) => (isGB(row) ? { buyUsd: dcaBaseAmount * 5 } : {}),
    },
    {
      key: 'gb_confirmed_2w_25pct',
      name: 'GB Confirmed >=2w (25% Reserve)',
      decide: ({ row, reserve, state }) => {
        if (isGB(row)) {
          state.streak = (state.streak || 0) + 1;
          if (state.streak >= 2) return { buyUsd: reserve * 0.25 };
        } else {
          state.streak = 0;
        }
        return {};
      },
    },
    {
      key: 'gb_frac_25_rb_scale_25',
      name: 'GB Frac 25% + RB Scale-Out 25%/wk',
      decide: ({ row, reserve, units }) => {
        if (isGB(row)) return { buyUsd: reserve * 0.25 };
        if (isRB(row) && units > 0) return { sellFraction: 0.25 };
        return {};
      },
    },
    {
      key: 'gb_paced_5x_rb_scale_25',
      name: 'GB Paced 5x + RB Scale-Out 25%/wk',
      decide: ({ row, units }) => {
        if (isGB(row)) return { buyUsd: dcaBaseAmount * 5 };
        if (isRB(row) && units > 0) return { sellFraction: 0.25 };
        return {};
      },
    },
    {
      key: 'gb_frac_50_cy4_ath',
      name: 'GB Frac 50% + CY-4 Once/Cycle',
      decide: ({ row, reserve, units, state }) => {
        if (isGB(row)) {
          state.soldInCycle = false;
          return { buyUsd: reserve * 0.5 };
        }
        if (isRB(row) && !state.soldInCycle && units > 0) {
          state.soldInCycle = true;
          return { sellFraction: 0.5 };
        }
        return {};
      },
    },
    {
      key: 'gb_all_in_100',
      name: 'GB-7: All-In 100% Reserve',
      decide: ({ row, reserve }) => (isGB(row) ? { buyUsd: reserve } : {}),
    },
    {
      key: 'gb_all_in_100_cy4_ath',
      name: 'GB-7: All-In 100% + CY-4 Once/Cycle',
      decide: ({ row, reserve, units, state }) => {
        if (isGB(row)) {
          state.soldInCycle = false;
          return { buyUsd: reserve };
        }
        if (isRB(row) && !state.soldInCycle && units > 0) {
          state.soldInCycle = true;
          return { sellFraction: 0.5 };
        }
        return {};
      },
    },
  ];

  const endPrice = series[endIndex].close;
  return modes.map((mode) => {
    let reserve = 0;
    let totalBudget = 0;
    let totalBought = 0;
    let units = 0;
    let buyCount = 0;
    let sellCount = 0;
    const state = {};

    for (let i = startIndex; i <= endIndex; i += 1) {
      const execIdx = executionMode === 'next_open' ? i + 1 : i;
      if (execIdx > endIndex) break;
      const execPrice = executionMode === 'next_open' ? series[execIdx].open : series[execIdx].close;
      if (!(execPrice > 0)) continue;

      reserve = reserve * (1 + weeklyYield) + dcaBaseAmount;
      totalBudget += dcaBaseAmount;

      const act = mode.decide({ row: series[i], reserve, units, state }) || {};
      if (act.sellFraction && act.sellFraction > 0 && units > 0) {
        const sellUnits = units * Math.min(1, act.sellFraction);
        const net = sellUnits * execPrice * (1 - feeRate);
        units -= sellUnits;
        if (units < 1e-10) units = 0;
        reserve += net;
        sellCount += 1;
      } else if (act.buyUsd && act.buyUsd > 0 && reserve > 0) {
        const spend = Math.min(reserve, act.buyUsd);
        units += (spend / (1 + feeRate)) / execPrice;
        reserve -= spend;
        totalBought += spend;
        buyCount += 1;
      }
    }

    const finalValue = reserve + units * endPrice;
    return {
      key: mode.key,
      name: mode.name,
      totalBudget,
      deployed: totalBought,
      cashReserve: reserve,
      avgCost: units > 0 && sellCount === 0 ? totalBought / units : null,
      finalValue,
      roiPct: totalBudget > 0 ? ((finalValue - totalBudget) / totalBudget) * 100 : 0,
      buyCount,
      sellCount,
    };
  });
}

export const BUILTIN_STRATEGIES = Object.freeze({
  buy_and_hold: {
    name: 'Buy & Hold',
    description: '100% long benchmark from evaluation start to end',
    targetExposureAt: () => 1.0,
  },
  regime_long_flat: {
    name: 'Regime Long/Flat (Score >= +1 / <= -1)',
    description: '100% long on ACCUMULATE/STRONG ACCUM (!div); cash on DISTRIBUTE/STRONG DIST (!div)',
    targetExposureAt: (row, prevTarget) => {
      if (row.divergence) return prevTarget;
      if (row.composite >= 1) return 1.0;
      if (row.composite <= -1) return 0.0;
      return prevTarget;
    },
  },
  extreme_reversal: {
    name: 'Extreme Reversal (Score >= +3 / <= -3)',
    description: '100% long on STRONG ACCUM (!div); exit to cash on STRONG DIST (!div)',
    targetExposureAt: (row, prevTarget) => {
      if (row.divergence) return prevTarget;
      if (row.composite >= 3) return 1.0;
      if (row.composite <= -3) return 0.0;
      return prevTarget;
    },
  },
  composite_allocation: {
    name: 'Composite Dynamic Allocation (0%..100%)',
    description: 'Scales exposure by composite: +3/+4=>100%, +1/+2=>75%, 0=>50%, -1/-2=>25%, -3/-4=>0% (holds on divergence)',
    targetExposureAt: (row, prevTarget) => {
      if (row.divergence) return prevTarget;
      if (row.composite >= 3) return 1.0;
      if (row.composite >= 1) return 0.75;
      if (row.composite === 0) return 0.5;
      if (row.composite >= -2) return 0.25;
      return 0.0;
    },
  },
  valuator_only: {
    name: 'Valuator Only (GIFT/CHEAP vs EXP/BUBBLE)',
    description: '100% long when Valuator is GIFT or CHEAP; cash when EXP or BUBBLE',
    targetExposureAt: (row, prevTarget) => {
      if (row.valZone === ZONES.GIFT || row.valZone === ZONES.CHEAP) return 1.0;
      if (row.valZone === ZONES.EXP || row.valZone === ZONES.BUBBLE) return 0.0;
      return prevTarget;
    },
  },
  pnl_only: {
    name: 'PnL Matrix Only (GIFT/CHEAP vs EXP/BUBBLE)',
    description: '100% long when PnL Matrix is GIFT or CHEAP; cash when EXP or BUBBLE',
    targetExposureAt: (row, prevTarget) => {
      if (row.pnlZone === ZONES.GIFT || row.pnlZone === ZONES.CHEAP) return 1.0;
      if (row.pnlZone === ZONES.EXP || row.pnlZone === ZONES.BUBBLE) return 0.0;
      return prevTarget;
    },
  },
});

export function runBacktest(candles, options = {}) {
  const {
    settings = {},
    closedOnly = true,
    warmupBars = null,
    from = null,
    to = null,
    horizons = null,
    initialCapital = 10000,
    feeBps = 10,
    executionMode = 'next_open',
    dcaBaseAmount = 1000,
    strategies = Object.keys(BUILTIN_STRATEGIES),
  } = options;

  const filteredCandles = closedOnly
    ? candles.filter((c) => c.isClosed !== false)
    : candles;

  const dashboard = calculateMacroDashboard(filteredCandles, settings);
  const { series } = dashboard;
  if (series.length < 2) {
    throw new Error(`Not enough candles to backtest (${series.length} bars)`);
  }

  const tf = dashboard.settings.timeframe;
  const activeHorizons = Array.isArray(horizons) && horizons.length > 0
    ? horizons
    : (DEFAULT_HORIZONS_BY_TF[tf] || DEFAULT_HORIZONS_BY_TF.W);

  const defaultWarmup = Math.min(
    Math.max(dashboard.settings.percentileLookback, dashboard.settings.longLookback),
    Math.floor(series.length * 0.4),
  );
  const effectiveWarmup = warmupBars != null ? Math.max(0, Math.trunc(warmupBars)) : defaultWarmup;

  const fromMs = from ? new Date(from).getTime() : -Infinity;
  const toMs = to ? new Date(to).getTime() : Infinity;

  let startIndex = -1;
  let endIndex = -1;
  for (let i = effectiveWarmup; i < series.length; i += 1) {
    const t = series[i].time.getTime();
    if (t >= fromMs && t <= toMs) {
      if (startIndex === -1) startIndex = i;
      endIndex = i;
    }
  }

  if (startIndex === -1 || endIndex <= startIndex) {
    throw new Error('No bars fall within the requested warmup / date window.');
  }

  const forwardByDecision = computeForwardStudy(series, {
    startIndex,
    endIndex,
    horizons: activeHorizons,
    groupBy: (row) => row.decision,
    executionMode,
  });

  const forwardByValZone = computeForwardStudy(series, {
    startIndex,
    endIndex,
    horizons: activeHorizons,
    groupBy: (row) => row.valZone,
    executionMode,
  });

  const forwardByPnlZone = computeForwardStudy(series, {
    startIndex,
    endIndex,
    horizons: activeHorizons,
    groupBy: (row) => row.pnlZone,
    executionMode,
  });

  const alertKeys = Object.keys(series[0].alerts || {});
  const forwardByAlert = {};
  for (const key of alertKeys) {
    const study = computeForwardStudy(series, {
      startIndex,
      endIndex,
      horizons: activeHorizons,
      groupBy: (row) => (row.alerts?.[key] ? key : null),
      executionMode,
    });
    forwardByAlert[key] = study[0] || { key, signals: 0, horizons: {} };
  }

  const selectedKeys = strategies.includes('buy_and_hold')
    ? strategies
    : ['buy_and_hold', ...strategies];

  const strategyResults = selectedKeys
    .filter((key) => BUILTIN_STRATEGIES[key])
    .map((key) => simulateTargetExposureStrategy({
      name: BUILTIN_STRATEGIES[key].name,
      description: BUILTIN_STRATEGIES[key].description,
      series,
      startIndex,
      endIndex,
      targetExposureAt: BUILTIN_STRATEGIES[key].targetExposureAt,
      initialCapital,
      feeBps,
      timeframe: tf,
      executionMode,
    }));

  const dcaComparison = simulateDcaComparison({
    series,
    startIndex,
    endIndex,
    dcaBaseAmount,
    feeBps,
    executionMode,
  });

  const greenBubbleDca = simulateGreenBubbleDcaSuite({
    series,
    startIndex,
    endIndex,
    dcaBaseAmount,
    feeBps,
    executionMode,
  });

  return {
    meta: {
      totalBars: series.length,
      evalBars: endIndex - startIndex + 1,
      startIndex,
      endIndex,
      warmupBars: effectiveWarmup,
      evalStartTime: series[startIndex].time.toISOString(),
      evalEndTime: series[endIndex].time.toISOString(),
      evalStartPrice: series[startIndex].close,
      evalEndPrice: series[endIndex].close,
      executionMode,
      feeBps,
      initialCapital,
      horizons: activeHorizons,
      settings: dashboard.settings,
    },
    currentSnapshot: dashboard.current,
    forwardStudies: {
      byDecision: forwardByDecision,
      byValZone: forwardByValZone,
      byPnlZone: forwardByPnlZone,
      byAlert: forwardByAlert,
    },
    strategies: strategyResults,
    dcaComparison,
    greenBubbleDca,
    series,
  };
}

export async function exportBacktestArtifacts(outDir, report) {
  await fs.mkdir(outDir, { recursive: true });

  const summaryPayload = {
    meta: report.meta,
    currentSnapshot: report.currentSnapshot,
    forwardStudies: report.forwardStudies,
    dcaComparison: report.dcaComparison,
    strategies: report.strategies.map((s) => ({
      name: s.name,
      description: s.description,
      metrics: s.metrics,
      tradeCount: s.trades.length,
    })),
  };
  await fs.writeFile(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summaryPayload, null, 2),
    'utf8',
  );

  const seriesHeader = [
    'time', 'open', 'high', 'low', 'close', 'volume', 'isClosed',
    'fairValue', 'bandUpper', 'bandLower', 'valZLong', 'valZShort',
    'versusFairValue', 'impliedCagr', 'sigma', 'valZone', 'valBarsInZone',
    'weightedAverage', 'percentile', 'roiMin', 'roiMax', 'underwater',
    'relativeSpread', 'pnlZone', 'pnlBarsInZone', 'composite', 'divergence', 'decision',
  ].join(',');

  const seriesLines = report.series.map((r) => [
    r.time.toISOString(),
    r.open,
    r.high,
    r.low,
    r.close,
    r.volume,
    r.isClosed,
    r.fairValue.toFixed(2),
    r.bandUpper.toFixed(2),
    r.bandLower.toFixed(2),
    r.valZLong.toFixed(4),
    r.valZShort.toFixed(4),
    r.versusFairValue.toFixed(2),
    r.impliedCagr.toFixed(2),
    r.sigma.toFixed(4),
    r.valZone,
    r.valBarsInZone,
    r.weightedAverage.toFixed(2),
    r.percentile.toFixed(2),
    r.roiMin.toFixed(2),
    r.roiMax.toFixed(2),
    r.underwater.toFixed(1),
    r.relativeSpread.toFixed(4),
    r.pnlZone,
    r.pnlBarsInZone,
    r.composite,
    r.divergence,
    `"${r.decision}"`,
  ].join(','));

  await fs.writeFile(
    path.join(outDir, 'series.csv'),
    [seriesHeader, ...seriesLines].join('\n'),
    'utf8',
  );

  const tradeHeader = 'strategy,barIndex,time,side,price,units,notional,fee,targetExposure,realizedPnl,reason';
  const tradeLines = [];
  for (const strat of report.strategies) {
    for (const t of strat.trades) {
      tradeLines.push([
        `"${strat.name}"`,
        t.barIndex,
        t.time,
        t.side,
        t.price.toFixed(2),
        t.units.toFixed(6),
        t.notional.toFixed(2),
        t.fee.toFixed(2),
        t.targetExposure,
        t.realizedPnl != null ? t.realizedPnl.toFixed(2) : '',
        `"${t.reason}"`,
      ].join(','));
    }
  }
  await fs.writeFile(
    path.join(outDir, 'trades.csv'),
    [tradeHeader, ...tradeLines].join('\n'),
    'utf8',
  );
}

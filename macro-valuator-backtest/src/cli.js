import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBinanceKlines, loadCandlesFromFile, saveCandlesToFile } from './dataLoader.js';
import { MACRO_DASHBOARD_DEFAULTS, MACRO_SOP_PRESET } from './engine.js';
import { BUILTIN_STRATEGIES, exportBacktestArtifacts, runBacktest } from './backtester.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`
Macro Dashboard v2 — Valuator + PnL Matrix (Pine Parity) Backtest CLI

Usage:
  node src/cli.js [options]

Data Options:
  --symbol <pair>          Binance spot symbol (default: BTCUSDT)
  --timeframe <D|W|M>      Locked timeframe (default: W)
  --limit <n>              Max klines to fetch (default: 10000)
  --input <path>           Load candles from local .json or .csv instead of Binance
  --save-data <path>       Save fetched/loaded candles to .json or .csv
  --force-fetch            Bypass local disk cache and re-fetch from Binance
  --fetch-only             Fetch & cache data, then exit without running backtest

Engine Options:
  --preset <sop>           Apply preset configuration (e.g. "sop" -> MathClean v3 + VWAP + W)
  --engine-mode <mode>     pine_v2 | math_v3 (default: pine_v2)
  --cost-method <name>     SMA | VWAP | Median HL | EMA (default: SMA)
  --weight-scheme <name>   Equal | Short-heavy | Long-heavy (default: Equal)
  --zone-method <name>     Percentile | Convergence (default: Percentile)
  --z-mode <name>          Structural | Adaptive (default: Structural)
  --sigma-method <name>    "EWMA D²" | "Rolling Std" (default: EWMA D²)
  --long-lookback <n>      Long regression window (default: 200)
  --short-lookback <n>     Short regression window (default: 100)
  --percentile-lookback <n> PnL percentile lookback (default: 208)
  --no-dual                Disable dual-window confirmation
  --no-hysteresis          Disable zone hysteresis

Backtest Options:
  --from <YYYY-MM-DD>      Evaluation window start date
  --to <YYYY-MM-DD>        Evaluation window end date
  --warmup <n>             Bars skipped for indicator warmup (default: auto)
  --include-unclosed       Include live/unclosed final candle in backtest
  --exec <next_open|close> Order execution timing (default: next_open)
  --capital <n>            Initial capital USD (default: 10000)
  --fee-bps <n>            Fee/slippage per trade in bps (default: 10 = 0.10%)
  --horizons <a,b,c,d>     Forward return horizons in bars (default: 4,12,26,52 for W)
  --strategies <list>      Comma-separated keys or "all" (${Object.keys(BUILTIN_STRATEGIES).join(', ')})
  --out-dir <path>         Export summary.json, series.csv, trades.csv (default: ./outputs)
  --no-export              Do not write output files
  --help                   Show this help message
`);
}

function parseArgs(argv) {
  const args = {
    symbol: 'BTCUSDT',
    timeframe: MACRO_DASHBOARD_DEFAULTS.timeframe,
    timeframeExplicit: false,
    preset: null,
    limit: 10000,
    input: null,
    saveData: null,
    forceFetch: false,
    fetchOnly: false,
    includeUnclosed: false,
    from: null,
    to: null,
    warmup: null,
    exec: 'next_open',
    capital: 10000,
    feeBps: 10,
    horizons: null,
    strategies: Object.keys(BUILTIN_STRATEGIES),
    outDir: path.join(ROOT_DIR, 'outputs'),
    exportFiles: true,
    settings: {},
  };

  const parseFiniteArg = (flag, raw, { min = -Infinity } = {}) => {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < min) {
      throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
    }
    return num;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
      i += 1;
      return argv[i];
    };

    switch (flag) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--symbol':
        args.symbol = next().toUpperCase();
        break;
      case '--timeframe':
        args.timeframe = next();
        args.timeframeExplicit = true;
        args.settings.timeframe = args.timeframe;
        break;
      case '--limit':
        args.limit = parseFiniteArg(flag, next(), { min: 2 });
        break;
      case '--input':
        args.input = path.resolve(next());
        break;
      case '--save-data':
        args.saveData = path.resolve(next());
        break;
      case '--force-fetch':
        args.forceFetch = true;
        break;
      case '--fetch-only':
        args.fetchOnly = true;
        break;
      case '--preset': {
        const preset = next().toLowerCase();
        if (preset !== 'sop') throw new Error(`Unknown preset: ${preset}`);
        args.preset = preset;
        break;
      }
      case '--engine-mode':
        args.settings.engineMode = next();
        break;
      case '--cost-method':
        args.settings.costMethod = next();
        break;
      case '--weight-scheme':
        args.settings.weightScheme = next();
        break;
      case '--zone-method':
        args.settings.zoneMethod = next();
        break;
      case '--z-mode':
        args.settings.zMode = next();
        break;
      case '--sigma-method':
        args.settings.sigmaMethod = next();
        break;
      case '--long-lookback':
        args.settings.longLookback = parseFiniteArg(flag, next(), { min: 2 });
        break;
      case '--short-lookback':
        args.settings.shortLookback = parseFiniteArg(flag, next(), { min: 2 });
        break;
      case '--percentile-lookback':
        args.settings.percentileLookback = parseFiniteArg(flag, next(), { min: 2 });
        break;
      case '--no-dual':
        args.settings.useDualWindow = false;
        break;
      case '--no-hysteresis':
        args.settings.useHysteresis = false;
        break;
      case '--from':
        args.from = next();
        break;
      case '--to':
        args.to = next();
        break;
      case '--warmup':
        args.warmup = parseFiniteArg(flag, next(), { min: 0 });
        break;
      case '--include-unclosed':
        args.includeUnclosed = true;
        break;
      case '--exec':
        args.exec = next();
        break;
      case '--capital':
        args.capital = parseFiniteArg(flag, next(), { min: 1 });
        break;
      case '--fee-bps':
        args.feeBps = parseFiniteArg(flag, next(), { min: 0 });
        break;
      case '--horizons':
        args.horizons = next().split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n) && n > 0);
        break;
      case '--strategies': {
        const val = next();
        args.strategies = val === 'all'
          ? Object.keys(BUILTIN_STRATEGIES)
          : val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--out-dir':
        args.outDir = path.resolve(next());
        break;
      case '--no-export':
        args.exportFiles = false;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (args.preset === 'sop') {
    args.settings = { ...MACRO_SOP_PRESET, ...args.settings };
    if (!args.timeframeExplicit) {
      args.timeframe = MACRO_SOP_PRESET.timeframe;
    }
  }
  return args;
}

const fmtPct = (v, digits = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '---');
const fmtNum = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '---');
const fmtUsd = (v) => (Number.isFinite(v) ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '---');

function printForwardTable(title, rows, horizons) {
  console.log(`\n=== ${title} ===`);
  const formatted = rows.map((row) => {
    const entry = { Group: row.key, Bars: row.signals };
    for (const h of horizons) {
      const s = row.horizons[h];
      entry[`+${h}b Med (Win%)`] = s && s.count > 0
        ? `${fmtPct(s.medianPct)} (${s.winRatePct.toFixed(0)}%, n=${s.count})`
        : '---';
    }
    return entry;
  });
  console.table(formatted);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let candles;
  let source;
  if (args.input) {
    candles = await loadCandlesFromFile(args.input);
    source = `file:${args.input}`;
  } else {
    const fetched = await fetchBinanceKlines({
      symbol: args.symbol,
      timeframe: args.timeframe,
      limit: args.limit,
      cacheDir: path.join(ROOT_DIR, 'data'),
      force: args.forceFetch,
    });
    candles = fetched.candles;
    source = fetched.source;
  }

  if (args.saveData && candles.length > 0) {
    await saveCandlesToFile(args.saveData, candles);
    console.log(`Saved ${candles.length} candles -> ${args.saveData}`);
  }

  console.log(`Loaded ${candles.length} candles from ${source}`);
  if (args.fetchOnly) return;

  const report = runBacktest(candles, {
    settings: args.settings,
    closedOnly: !args.includeUnclosed,
    warmupBars: args.warmup,
    from: args.from,
    to: args.to,
    horizons: args.horizons,
    initialCapital: args.capital,
    feeBps: args.feeBps,
    executionMode: args.exec,
    strategies: args.strategies,
  });

  const { meta, currentSnapshot, forwardStudies, strategies, dcaComparison } = report;

  console.log('\n====================================================================');
  console.log('MACRO DASHBOARD v2 · VALUATOR + PNL MATRIX (PINE PARITY) BACKTEST');
  console.log('====================================================================');
  console.log(`Timeframe: ${meta.settings.timeframe} | Total Bars: ${meta.totalBars} | Warmup: ${meta.warmupBars} | Eval Bars: ${meta.evalBars}`);
  console.log(`Eval Window: ${meta.evalStartTime.slice(0, 10)} (${fmtUsd(meta.evalStartPrice)}) -> ${meta.evalEndTime.slice(0, 10)} (${fmtUsd(meta.evalEndPrice)})`);
  console.log(`Execution: ${meta.executionMode} | Fee: ${meta.feeBps} bps | Capital: ${fmtUsd(meta.initialCapital)}`);
  const scaleLabel = meta.settings.engineMode === 'math_v3' ? 'MAD 4Y + RV2Y' : meta.settings.sigmaMethod;
  console.log(`Settings: Engine=${meta.settings.engineMode}, Cost=${meta.settings.costMethod}, Weight=${meta.settings.weightScheme}, PnLZone=${meta.settings.zoneMethod}, ZMode=${meta.settings.zMode}, Scale=${scaleLabel}, Dual=${meta.settings.useDualWindow}, Hysteresis=${meta.settings.useHysteresis}`);

  console.log('\n--- Latest Closed Bar Snapshot ---');
  console.log(
    `Date: ${currentSnapshot.time.toISOString().slice(0, 10)} | Price: ${fmtUsd(currentSnapshot.price)} | Fair Value: ${fmtUsd(currentSnapshot.fairValue)} (${fmtPct(currentSnapshot.versusFairValue)})`,
  );
  console.log(
    `Decision: ${currentSnapshot.decision} (Score ${currentSnapshot.composite}) | Valuator: ${currentSnapshot.valZone} (Z_L=${currentSnapshot.valZLong.toFixed(2)}, Z_S=${currentSnapshot.valZShort.toFixed(2)}) | PnL: ${currentSnapshot.pnlZone} (${currentSnapshot.percentile.toFixed(1)}%ile, wAvg=${fmtPct(currentSnapshot.weightedAverage)})`,
  );

  printForwardTable('Forward Returns by Decision', forwardStudies.byDecision, meta.horizons);
  printForwardTable('Forward Returns by Valuator Zone', forwardStudies.byValZone, meta.horizons);
  printForwardTable('Forward Returns by PnL Zone', forwardStudies.byPnlZone, meta.horizons);

  const alertRows = Object.values(forwardStudies.byAlert).filter((r) => r.signals > 0);
  if (alertRows.length > 0) {
    printForwardTable('Forward Returns by Alert Trigger', alertRows, meta.horizons);
  }

  console.log('\n=== Strategy Performance Comparison ===');
  console.table(strategies.map((s) => ({
    Strategy: s.name,
    'Final Equity': fmtUsd(s.metrics.finalEquity),
    'Return %': fmtPct(s.metrics.totalReturnPct),
    'CAGR %': fmtPct(s.metrics.cagrPct),
    'Max DD %': `-${s.metrics.maxDrawdownPct.toFixed(1)}%`,
    Sharpe: fmtNum(s.metrics.sharpe),
    Sortino: fmtNum(s.metrics.sortino),
    'Time in Mkt': `${s.metrics.timeInMarketPct.toFixed(0)}%`,
    Trades: s.metrics.tradeCount,
    'Win Rate': s.metrics.winRatePct != null ? `${s.metrics.winRatePct.toFixed(1)}%` : '---',
    PF: s.metrics.profitFactor === Infinity ? 'INF' : fmtNum(s.metrics.profitFactor),
  })));

  console.log('\n=== DCA Comparison ($1,000/bar base budget) ===');
  console.table([
    {
      Mode: 'Equal DCA (1.0x every bar)',
      'Total Budget': fmtUsd(dcaComparison.totalBudget),
      Deployed: fmtUsd(dcaComparison.equalDca.invested),
      'Cash Reserve': '$0',
      'Avg Cost': fmtUsd(dcaComparison.equalDca.avgCost),
      'Final Value': fmtUsd(dcaComparison.equalDca.finalValue),
      'ROI %': fmtPct(dcaComparison.equalDca.roiPct),
    },
    {
      Mode: 'Value-Weighted DCA (0x..2x by Score)',
      'Total Budget': fmtUsd(dcaComparison.totalBudget),
      Deployed: fmtUsd(dcaComparison.valueWeightedDca.invested),
      'Cash Reserve': fmtUsd(dcaComparison.valueWeightedDca.cashReserve),
      'Avg Cost': fmtUsd(dcaComparison.valueWeightedDca.avgCost),
      'Final Value': fmtUsd(dcaComparison.valueWeightedDca.finalValue),
      'ROI %': fmtPct(dcaComparison.valueWeightedDca.roiOnTotalBudgetPct),
    },
    ...(report.greenBubbleDca || []).map((row) => ({
      Mode: row.name,
      'Total Budget': fmtUsd(row.totalBudget),
      Deployed: fmtUsd(row.deployed),
      'Cash Reserve': fmtUsd(row.cashReserve),
      'Avg Cost': row.avgCost != null ? fmtUsd(row.avgCost) : '---',
      'Final Value': fmtUsd(row.finalValue),
      'ROI %': fmtPct(row.roiPct),
    })),
  ]);

  if (args.exportFiles) {
    await exportBacktestArtifacts(args.outDir, report);
    console.log(`\nExported artifacts -> ${args.outDir} (summary.json, series.csv, trades.csv)`);
  }
}

main().catch((error) => {
  console.error('[Backtest Error]', error.message);
  process.exitCode = 1;
});

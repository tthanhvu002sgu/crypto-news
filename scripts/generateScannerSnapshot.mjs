#!/usr/bin/env node
/**
 * CLI Worker: Generate Scanner v9 Snapshot
 * Usage:
 *   node scripts/generateScannerSnapshot.mjs [--as-of YYYY-MM-DD] [--out-dir ./data] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateDailySnapshot,
  getUtcMidnightDate,
} from '../src/services/scannerDataEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    asOf: new Date(),
    outDir: path.join(projectRoot, 'data'),
    publicDir: path.join(projectRoot, 'public', 'data'),
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--as-of' && args[i + 1]) {
      options.asOf = new Date(args[i + 1]);
      i += 1;
    } else if (arg === '--out-dir' && args[i + 1]) {
      options.outDir = path.resolve(args[i + 1]);
      i += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
Scanner v9 Snapshot Generator CLI
Options:
  --as-of <YYYY-MM-DD>   Snapshot date (analyzing data up to 00:00 UTC of that date)
  --out-dir <path>       Directory to save manifest and snapshot JSON files
  --dry-run              Generate snapshot and output summary without writing to disk
  --help                 Show this help message
`);
    process.exit(0);
  }

  const asOfMidnight = getUtcMidnightDate(options.asOf);
  const dateStr = asOfMidnight.toISOString().slice(0, 10);

  // Calculate prior dates to load snapshots for OI continuity
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const date7dStr = new Date(asOfMidnight.getTime() - 7 * MS_PER_DAY).toISOString().slice(0, 10);
  const date30dStr = new Date(asOfMidnight.getTime() - 30 * MS_PER_DAY).toISOString().slice(0, 10);

  // Read existing manifest if available to resolve the current active revision file
  let existingManifest = null;
  const manifestPaths = [
    path.join(options.outDir, 'manifest.json'),
    path.join(options.publicDir, 'manifest.json'),
  ];
  for (const mPath of manifestPaths) {
    if (fs.existsSync(mPath)) {
      try {
        existingManifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
        break;
      } catch {}
    }
  }

  const priorSnapshots = {};
  const loadPriorSnap = (dateS) => {
    try {
      const entry = existingManifest?.snapshots?.find(s => s.date === dateS);
      const fileName = entry?.file || `${dateS}.json`;

      const candidateDirs = [options.outDir, options.publicDir];
      for (const dir of candidateDirs) {
        const snapPath = path.join(dir, 'snapshots', fileName);
        if (fs.existsSync(snapPath)) {
          const parsed = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
          // Check that asOf matches expected date
          if (parsed && (parsed.asOf?.startsWith(dateS) || parsed.date === dateS)) {
            return parsed;
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  const snap7d = loadPriorSnap(date7dStr);
  if (snap7d) priorSnapshots['7d'] = snap7d;
  
  const snap30d = loadPriorSnap(date30dStr);
  if (snap30d) priorSnapshots['30d'] = snap30d;

  console.log(`[ScannerWorker] Starting Scanner v9 Snapshot generation for ${dateStr} (asOf: ${asOfMidnight.toISOString()})...`);

  try {
    const snapshot = await generateDailySnapshot({
      asOf: asOfMidnight,
      sourceOverrides: { priorSnapshots },
    });

    console.log(`[ScannerWorker] Snapshot generated successfully:`);
    console.log(` - Total Assets: ${snapshot.assets.length}`);
    console.log(` - Complete 7D Assets: ${snapshot.summary['7d'].completeCount}/${snapshot.summary['7d'].totalAssets}`);
    console.log(` - Benchmark BTC: $${snapshot.benchmarks.btc.current} (7D: ${((snapshot.benchmarks.btc.current / snapshot.benchmarks.btc.prior7d - 1) * 100).toFixed(2)}%)`);
    console.log(` - Benchmark ETH: $${snapshot.benchmarks.eth.current} (7D: ${((snapshot.benchmarks.eth.current / snapshot.benchmarks.eth.prior7d - 1) * 100).toFixed(2)}%)`);

    if (options.dryRun) {
      console.log(`[ScannerWorker] DRY RUN: Snapshot created in memory, skipping write.`);
      process.exit(0);
    }

    // Write snapshot file to outDir and publicDir
    const targets = [options.outDir, options.publicDir];
    
    // Find next revision number
    let revision = 1;
    let baseFileName = `${dateStr}.json`;
    const checkDir = path.join(options.outDir, 'snapshots');
    if (fs.existsSync(checkDir)) {
      while (fs.existsSync(path.join(checkDir, baseFileName))) {
        baseFileName = `${dateStr}-rev${revision}.json`;
        revision++;
      }
    }
    
    snapshot.revision = revision;

    for (const targetDir of targets) {
      const snapshotsDir = path.join(targetDir, 'snapshots');
      fs.mkdirSync(snapshotsDir, { recursive: true });

      const snapshotFilePath = path.join(snapshotsDir, baseFileName);
      fs.writeFileSync(snapshotFilePath, JSON.stringify(snapshot, null, 2), 'utf-8');
      console.log(`[ScannerWorker] Saved snapshot to: ${snapshotFilePath}`);

      // Update manifest.json
      const manifestPath = path.join(targetDir, 'manifest.json');
      let manifest = {
        schemaVersion: snapshot.schemaVersion,
        modelVersion: snapshot.modelVersion,
        latestDate: dateStr,
        updatedAt: new Date().toISOString(),
        snapshots: [],
      };

      if (fs.existsSync(manifestPath)) {
        try {
          const raw = fs.readFileSync(manifestPath, 'utf-8');
          manifest = { ...manifest, ...JSON.parse(raw) };
        } catch {}
      }

      // Filter existing entry for this date and prepend new one
      const otherSnapshots = (manifest.snapshots || []).filter(s => s.date !== dateStr);
      const newEntry = {
        date: dateStr,
        file: baseFileName,
        revision: revision,
        asOf: snapshot.asOf,
        generatedAt: snapshot.generatedAt,
        assetCount: snapshot.assets.length,
        completeCount: snapshot.summary['7d'].completeCount,
        schemaVersion: snapshot.schemaVersion,
        modelVersion: snapshot.modelVersion,
      };

      manifest.snapshots = [newEntry, ...otherSnapshots].sort((a, b) => b.date.localeCompare(a.date));
      manifest.latestDate = manifest.snapshots[0]?.date || dateStr;
      manifest.updatedAt = new Date().toISOString();

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      console.log(`[ScannerWorker] Updated manifest at: ${manifestPath}`);
    }

    console.log(`[ScannerWorker] All done!`);
  } catch (err) {
    console.error(`[ScannerWorker] Fatal error generating snapshot:`, err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

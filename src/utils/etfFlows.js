/**
 * Helpers for parsing and aggregating Spot Bitcoin ETF net flow history.
 */

const DAY_MS = 86_400_000;

/**
 * Parse an ETF date string (`DD/MM/YY`, `DD/MM`, or `YYYY-MM-DD`) into a UTC Date.
 * Returns null if the input cannot be parsed into a valid calendar date.
 */
export function parseEtfDateToUtc(dateStr, defaultShortYear = 26) {
  if (typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  let year;
  let month;
  let day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    year = y;
    month = m;
    day = d;
  } else if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(trimmed)) {
    const parts = trimmed.split('/').map(Number);
    day = parts[0];
    month = parts[1];
    if (parts.length === 2) {
      year = 2000 + defaultShortYear;
    } else {
      year = parts[2] < 100 ? 2000 + parts[2] : parts[2];
    }
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utcMs = Date.UTC(year, month - 1, day);
  const dt = new Date(utcMs);
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

function formatDdMmYy(utcDate) {
  const dd = String(utcDate.getUTCDate()).padStart(2, '0');
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(utcDate.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatDdMm(utcDate) {
  const dd = String(utcDate.getUTCDate()).padStart(2, '0');
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Aggregate daily ETF net flows into Monday-start calendar weeks.
 *
 * @param {Array<{date: string, flow: number}>} etfHistory
 * @returns {Array<{weekStartDate: string, label: string, firstDate: string, lastDate: string, flow: number, sessions: number}>}
 */
export function aggregateWeeklyEtfFlows(etfHistory) {
  if (!Array.isArray(etfHistory) || etfHistory.length === 0) return [];

  const buckets = new Map();

  for (const item of etfHistory) {
    if (!item) continue;
    const flow = Number(item.flow);
    if (!Number.isFinite(flow)) continue;

    const dt = parseEtfDateToUtc(item.date);
    if (!dt) continue;

    // Monday = 0 .. Sunday = 6
    const dayOfWeek = (dt.getUTCDay() + 6) % 7;
    const mondayMs = dt.getTime() - dayOfWeek * DAY_MS;
    const itemDateFormatted = formatDdMmYy(dt);

    let bucket = buckets.get(mondayMs);
    if (!bucket) {
      const mondayDate = new Date(mondayMs);
      bucket = {
        weekStartMs: mondayMs,
        weekStartDate: formatDdMmYy(mondayDate),
        label: formatDdMm(mondayDate),
        firstDate: itemDateFormatted,
        lastDate: itemDateFormatted,
        firstMs: dt.getTime(),
        lastMs: dt.getTime(),
        flowSum: 0,
        sessions: 0,
      };
      buckets.set(mondayMs, bucket);
    }

    bucket.flowSum += flow;
    bucket.sessions += 1;
    if (dt.getTime() < bucket.firstMs) {
      bucket.firstMs = dt.getTime();
      bucket.firstDate = itemDateFormatted;
    }
    if (dt.getTime() > bucket.lastMs) {
      bucket.lastMs = dt.getTime();
      bucket.lastDate = itemDateFormatted;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.weekStartMs - b.weekStartMs)
    .map(({ weekStartDate, label, firstDate, lastDate, flowSum, sessions }) => ({
      weekStartDate,
      label,
      firstDate,
      lastDate,
      flow: Math.round(flowSum * 10) / 10,
      sessions,
    }));
}

/**
 * Build Chart.js bar chart data for either daily or weekly ETF net flows.
 */
export function buildEtfFlowBarData(items, theme, { labelKey = 'date', datasetLabel = 'Net Flow (M USD)' } = {}) {
  const list = Array.isArray(items) ? items : [];
  return {
    labels: list.map((item) => item[labelKey]),
    datasets: [
      {
        label: datasetLabel,
        data: list.map((item) => item.flow),
        backgroundColor: list.map((item) => {
          if (item.flow >= 0) {
            return theme === 'light' ? '#047857' : '#10b981';
          }
          return theme === 'light' ? '#be123c' : '#f43f5e';
        }),
        borderColor: list.map((item) => {
          if (item.flow >= 0) {
            return theme === 'light' ? '#064e3b' : '#059669';
          }
          return theme === 'light' ? '#881337' : '#e11d48';
        }),
        borderWidth: 1,
        borderRadius: 2,
      },
    ],
  };
}

/**
 * Scanner v9: Qualitative Rubric Registry
 * Two criteria with equal 50% weight:
 * 1. Product (0: none, 50: live without paid proof, 100: live with paid proof)
 * 2. Token Value Accrual (0: none, 50: proposed, 100: live with proof)
 * Rubric expires after 90 days from evaluation date.
 * Anti-lookahead: Cannot use rubric evaluated after snapshot asOf date.
 */

import rubricsData from '../data/rubrics.json' with { type: 'json' };

export const RUBRIC_VERSION = rubricsData.version || '1.0.0';
export const RUBRIC_MAX_AGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RUBRIC_ENTRIES = new Map();
for (const entry of rubricsData.entries || []) {
  if (entry.symbol) {
    const key = entry.symbol.toUpperCase();
    if (!RUBRIC_ENTRIES.has(key)) {
      RUBRIC_ENTRIES.set(key, []);
    }
    RUBRIC_ENTRIES.get(key).push(entry);
  }
}
for (const list of RUBRIC_ENTRIES.values()) {
  list.sort((a, b) => new Date(a.evaluatedAt).getTime() - new Date(b.evaluatedAt).getTime());
}

/**
 * Evaluate rubric validity for a given asset as of a specific date.
 * Picks the latest evaluation with evaluatedAt <= asOf (anti-lookahead).
 * @param {string} symbol - Binance symbol (e.g. 'SOLUSDT')
 * @param {string|Date} asOf - Snapshot date
 * @returns {object} Evaluation result
 */
export function evaluateRubricForDate(symbol, asOf = new Date()) {
  if (!symbol) {
    return {
      productScore: null,
      tokenAccrualScore: null,
      rubricScore: null,
      reason: 'missing_symbol',
      isExpired: false,
    };
  }

  const sym = symbol.toUpperCase();
  const entries = RUBRIC_ENTRIES.get(sym);

  if (!entries || entries.length === 0) {
    return {
      productScore: null,
      tokenAccrualScore: null,
      rubricScore: null,
      reason: 'rubric_not_evaluated',
      isExpired: false,
      productEvidence: null,
      tokenAccrualEvidence: null,
      sourceUrl: null,
    };
  }

  const asOfTime = new Date(asOf).getTime();

  // Anti-lookahead: select only evaluations made at or before snapshot asOfTime
  let entry = null;
  if (Number.isFinite(asOfTime)) {
    const eligible = entries.filter(e => {
      const t = new Date(e.evaluatedAt).getTime();
      return Number.isFinite(t) && t <= asOfTime;
    });
    if (eligible.length === 0) {
      return {
        productScore: null,
        tokenAccrualScore: null,
        rubricScore: null,
        reason: 'rubric_future_lookahead',
        isExpired: false,
        evaluatedAt: entries[0].evaluatedAt,
        productEvidence: null,
        tokenAccrualEvidence: null,
        sourceUrl: null,
      };
    }
    entry = eligible[eligible.length - 1];
  } else {
    entry = entries[entries.length - 1];
  }

  const evalTime = new Date(entry.evaluatedAt).getTime();

  // 90-day Expiration check
  const ageMs = asOfTime - evalTime;
  const isExpired = ageMs > (RUBRIC_MAX_AGE_DAYS * MS_PER_DAY);

  if (isExpired) {
    return {
      productScore: null,
      tokenAccrualScore: null,
      rubricScore: null,
      reason: 'rubric_expired_over_90d',
      isExpired: true,
      evaluatedAt: entry.evaluatedAt,
      expiresAt: entry.expiresAt,
      productEvidence: entry.productEvidence,
      tokenAccrualEvidence: entry.tokenAccrualEvidence,
      sourceUrl: entry.sourceUrl,
    };
  }

  // Valid rubric
  const pScore = typeof entry.productScore === 'number' ? entry.productScore : null;
  const tScore = typeof entry.tokenAccrualScore === 'number' ? entry.tokenAccrualScore : null;

  if (pScore === null || tScore === null) {
    return {
      productScore: pScore,
      tokenAccrualScore: tScore,
      rubricScore: null,
      reason: 'incomplete_rubric_criteria',
      isExpired: false,
      evaluatedAt: entry.evaluatedAt,
      sourceUrl: entry.sourceUrl,
    };
  }

  const rubricScore = (pScore + tScore) / 2;

  return {
    productScore: pScore,
    tokenAccrualScore: tScore,
    rubricScore,
    reason: 'valid',
    isExpired: false,
    evaluatedAt: entry.evaluatedAt,
    expiresAt: entry.expiresAt,
    productEvidence: entry.productEvidence,
    tokenAccrualEvidence: entry.tokenAccrualEvidence,
    sourceUrl: entry.sourceUrl,
  };
}

export function getAllRubricEntries() {
  return rubricsData.entries || [];
}

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
    RUBRIC_ENTRIES.set(entry.symbol.toUpperCase(), entry);
  }
}

/**
 * Evaluate rubric validity for a given asset as of a specific date.
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
  const entry = RUBRIC_ENTRIES.get(sym);

  if (!entry) {
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
  const evalTime = new Date(entry.evaluatedAt).getTime();

  // Anti-lookahead: Rubric evaluated after snapshot date cannot be used in past snapshot
  if (Number.isFinite(asOfTime) && Number.isFinite(evalTime) && evalTime > asOfTime) {
    return {
      productScore: null,
      tokenAccrualScore: null,
      rubricScore: null,
      reason: 'rubric_future_lookahead',
      isExpired: false,
      evaluatedAt: entry.evaluatedAt,
      productEvidence: null,
      tokenAccrualEvidence: null,
      sourceUrl: null,
    };
  }

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

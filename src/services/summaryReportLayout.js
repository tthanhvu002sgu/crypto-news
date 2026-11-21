const normalizeText = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase();

// Only split on top-level topic bullets (0-1 leading spaces), never inside indented sub-bullets.
const TOPIC_LABEL = /^ ?[-*]\s+\*\*([^*]+)\*\*/;
const MARKDOWN_HEADING = /^\s*(#{2,4})\s+(.+)/;

// Match CME / COT on raw text so Vietnamese words like "cốt lõi" / "trụ cột"
// (which lose their diacritics to "cot") never collide with Commitment of Traders.
const hasCotKeyword = (value = '') =>
  /(?:^|[\s(/\-–—:;,.'"])(?:cme|cot|commitment of traders)(?=$|[\s)/\-–—:;,.'"])/i.test(String(value));

const semanticTopic = /(macro|vi mo|real[- ]?rate|real yield|institutional|dong tien to chuc|etf|on[- ]?chain|dinh gia|derivatives|phai sinh|open interest|\boi\b|leverage|don bay|funding|cvd|taker flow|liquidation|thanh ly|options|gamma|max pain|call wall|put wall)/;

const isSemanticTopic = (label = '') =>
  semanticTopic.test(normalizeText(label)) || hasCotKeyword(label);

/**
 * Split a long AI memo at report headings and at bold top-level topic labels.
 * Tracks the owning H2 section and H3 subsection so synthesis/decision sections
 * never steal evidence charts from primary analysis sections.
 */
export function splitReportIntoEvidenceBlocks(markdown = '') {
  const lines = String(markdown).split('\n');
  const blocks = [];
  let current = [];
  let anchor = '';
  let anchorType = 'body';
  let anchorLevel = 0;
  let currentSection = '';
  let currentSubsection = '';

  const pushCurrent = () => {
    const markdownBlock = current.join('\n').trim();
    if (!markdownBlock) return;
    blocks.push({
      markdown: markdownBlock,
      anchor,
      anchorType,
      anchorLevel,
      sectionAnchor: currentSection,
      subsectionAnchor: currentSubsection,
      charts: [],
    });
  };

  lines.forEach((line) => {
    const headingMatch = line.match(MARKDOWN_HEADING);
    const topicMatch = line.match(TOPIC_LABEL);
    const topicLabel = topicMatch?.[1] || '';
    const isTopicBoundary = Boolean(topicLabel && isSemanticTopic(topicLabel));

    if ((headingMatch || isTopicBoundary) && current.some((item) => item.trim())) {
      pushCurrent();
      current = [];
    }

    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      anchor = title;
      anchorType = 'heading';
      anchorLevel = level;
      if (level === 2) {
        currentSection = title;
        currentSubsection = '';
      } else if (level === 3) {
        currentSubsection = title;
      }
    } else if (isTopicBoundary) {
      anchor = topicLabel;
      anchorType = 'topic';
      anchorLevel = 0;
    }

    current.push(line);
  });

  pushCurrent();
  return blocks;
}

const chartRules = {
  macro: [
    [/macro.*(?:liquidity|real)|vi mo.*(?:thanh khoan|real)|real[- ]?rate|real yield/, 180],
    [/\bmacro\b|\bvi mo\b/, 100],
  ],
  etf: [
    [/\betf\b/, 180],
    [/institutional (?:flow|demand)|dong tien to chuc/, 90],
  ],
  cot: [
    [(_norm, raw) => hasCotKeyword(raw), 180],
    [/institutional (?:flow|demand)|dong tien to chuc/, 90],
  ],
  onchain: [
    [/on[- ]?chain|dinh gia on/, 180],
    [/mvrv|nupl|production cost|chi phi khai thac/, 120],
  ],
  oi: [
    [/open interest|\boi\b/, 180],
    [/\b(?:leverage|don bay|funding)\b/, 150],
    [/derivatives|phai sinh/, 90],
  ],
  cvd: [
    [/price vs (?:taker flow|cvd)|gia vs (?:taker flow|cvd)/, 240],
    [/\bcvd\b|taker flow/, 160],
    [/derivatives|phai sinh/, 60],
  ],
  liq: [
    [/(?:liquidation|dong thanh ly|thanh ly).*(?:vs|doi chieu).*(?:price|gia|cvd)/, 240],
    [/liquidation|thanh ly/, 200],
    [/doi chieu|cross[- ]?exam|conflict/, 120],
    [/derivatives|phai sinh/, 70],
  ],
  options: [
    [/options|gamma|max pain|call wall|put wall/, 200],
  ],
};

const getSectionKind = (block) => {
  const container = normalizeText(block.sectionAnchor || block.subsectionAnchor || block.anchor || '');
  if (/^(?:0[\s.)-]*)?(?:tom tat dieu hanh|executive summary)\b/.test(container)) {
    return 'executive_summary';
  }
  if (/^(?:[56][\s.)-]*)?(?:khuyen nghi hanh dong|ban do chien luoc|executive decision|multi[- ]horizon.*playbook|nhan dinh phi dong thuan|ke hoach phan bo von|asymmetric insights|staged spot accumulation|hanh dong chuyen nghiep|bai hoc thuc chien|professional playbook)\b/.test(container)) {
    return 'playbook';
  }
  if (/^(?:[45][\s.)-]*)?(?:kich ban dau tu|ma tran kich ban|spot investment scenarios|scenario matrix|three[- ]path scenarios|ban do kich ban)\b/.test(container)) {
    return 'scenarios';
  }
  if (/^(?:[234][\s.)-]*)?(?:doi chieu tin hieu|signal cross[- ]?examination|ma tran doi chieu|cross[- ]?examination|bat benh tin hieu xung dot)\b/.test(container)) {
    return 'cross_exam';
  }
  return 'analysis';
};

const scoreBlock = (block, rules, chartId) => {
  const sectionKind = getSectionKind(block);
  const rawAnchor = block.anchor || '';
  const anchor = normalizeText(rawAnchor);

  // Never attach evidence charts to Executive Summary (Section 0) or Action/Playbook/Capital Plan (Sections 5 & 6).
  if (sectionKind === 'executive_summary' || sectionKind === 'playbook') {
    return 0;
  }

  // Scenario blocks only host the Options chart when an explicit Options subsection/bullet exists.
  if (sectionKind === 'scenarios') {
    if (chartId !== 'options' || !/options|gamma|max pain|call wall|put wall|tuong dinh vi/.test(anchor)) {
      return 0;
    }
  }

  let score = 0;
  rules.forEach(([matcher, weight]) => {
    const matched = typeof matcher === 'function'
      ? matcher(anchor, rawAnchor)
      : matcher.test(anchor);
    if (matched) score = Math.max(score, weight);
  });

  if (!score) return 0;

  // Prefer specific subtopics (topic label or H3/H4 subsection) over broad H2 section headings.
  if (block.anchorType === 'topic') {
    score += 20;
  } else if (block.anchorType === 'heading') {
    if (block.anchorLevel >= 4) score += 15;
    else if (block.anchorLevel === 3) score += 10;
  }

  // Cross-examination (Section 3) is reserved for CVD and Liquidation comparisons;
  // keep primary-data charts (Macro, ETF, COT, On-chain, OI, Options) in Sections 1 & 2.
  if (sectionKind === 'cross_exam' && chartId !== 'cvd' && chartId !== 'liq') {
    score = Math.max(0, score - 120);
  }

  return score;
};

/** Assign every chart once, to the block whose own heading/label best matches it. */
export function placeChartsByEvidence(blocks = []) {
  const placed = blocks.map((block) => ({ ...block, charts: [] }));

  Object.entries(chartRules).forEach(([chartId, rules]) => {
    let bestIndex = -1;
    let bestScore = 0;

    placed.forEach((block, index) => {
      const score = scoreBlock(block, rules, chartId);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });

    if (bestIndex >= 0) placed[bestIndex].charts.push(chartId);
  });

  return placed;
}

export function buildProfessionalReportLayout(markdown = '') {
  return placeChartsByEvidence(splitReportIntoEvidenceBlocks(markdown));
}

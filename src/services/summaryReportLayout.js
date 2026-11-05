const normalizeText = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase();

const TOPIC_LABEL = /^\s*[-*]\s+\*\*([^*]+)\**/;
const MARKDOWN_HEADING = /^\s*(#{2,4})\s+(.+)/;

const semanticTopic = /(macro|vi mo|real[- ]?rate|real yield|institutional|dong tien to chuc|etf|cme|cot|on[- ]?chain|dinh gia|derivatives|phai sinh|open interest|\boi\b|cvd|taker flow|liquidation|thanh ly|options|gamma|max pain|call wall|put wall)/;

/**
 * Split a long AI memo at report headings and at bold topic labels. The model's
 * professional format puts several unrelated topics below the same heading,
 * so heading and topic boundaries allow precise evidence-chart placement.
 */
export function splitReportIntoEvidenceBlocks(markdown = '') {
  const lines = String(markdown).split('\n');
  const blocks = [];
  let current = [];
  let anchor = '';
  let anchorType = 'body';
  let anchorLevel = 0;

  const pushCurrent = () => {
    const markdownBlock = current.join('\n').trim();
    if (!markdownBlock) return;
    blocks.push({ markdown: markdownBlock, anchor, anchorType, anchorLevel, charts: [] });
  };

  lines.forEach((line) => {
    const headingMatch = line.match(MARKDOWN_HEADING);
    const topicMatch = line.match(TOPIC_LABEL);
    const topicLabel = topicMatch?.[1] || '';
    const isTopicBoundary = topicLabel && semanticTopic.test(normalizeText(topicLabel));

    if ((headingMatch || isTopicBoundary) && current.some((item) => item.trim())) {
      pushCurrent();
      current = [];
    }

    if (headingMatch) {
      anchor = headingMatch[2];
      anchorType = 'heading';
      anchorLevel = headingMatch[1].length;
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
    [/\bcot\b|\bcme\b/, 180],
    [/institutional (?:flow|demand)|dong tien to chuc/, 90],
  ],
  onchain: [
    [/on[- ]?chain|dinh gia on/, 180],
    [/mvrv|nupl|production cost/, 120],
  ],
  oi: [
    [/open interest|\boi\b/, 180],
    [/derivatives|phai sinh/, 90],
  ],
  cvd: [
    [/price vs (?:taker flow|cvd)|gia vs (?:taker flow|cvd)/, 240],
    [/\bcvd\b|taker flow/, 160],
    [/derivatives|phai sinh/, 60],
  ],
  liq: [
    [/liquidation|thanh ly/, 200],
    [/doi chieu|cross[- ]?exam|conflict/, 120],
    [/derivatives|phai sinh/, 70],
  ],
  options: [
    [/options|gamma|max pain|call wall|put wall/, 200],
    [/scenario|kich ban|activation trigger/, 160],
  ],
};

const scoreBlock = (block, rules) => {
  const anchor = normalizeText(block.anchor);
  let score = 0;
  rules.forEach(([pattern, weight]) => {
    if (pattern.test(anchor)) score = Math.max(score, weight);
  });
  // Prefer specific subtopics (topic label or H3/H4 subsection) over broad H2 section headings.
  if (score) {
    if (block.anchorType === 'topic') {
      score += 20;
    } else if (block.anchorType === 'heading') {
      if (block.anchorLevel >= 4) score += 15;
      else if (block.anchorLevel === 3) score += 10;
    }
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
      const score = scoreBlock(block, rules);
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

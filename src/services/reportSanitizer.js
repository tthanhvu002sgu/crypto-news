/**
 * Report Sanitizer & Markdown Hierarchy Engine
 *
 * Cleans LLM output artifacts, strips raw thinking/monologues/checklists,
 * corrects LaTeX and math formatting, and enforces strict bullet hierarchy
 * between section headers and nested content items.
 */

/**
 * Remove orphaned ** markers while preserving valid **word** bold pairs.
 */
export const stripOrphanedBold = (text) => {
  if (!text || !text.includes('**')) return text;

  const markers = [];
  let pos = 0;
  while ((pos = text.indexOf('**', pos)) !== -1) {
    const before = pos > 0 ? text[pos - 1] : ' ';
    const after = pos + 2 < text.length ? text[pos + 2] : ' ';
    const isOpening = /\s|[([{"'`.,:;!?~-]/.test(before) && !/\s/.test(after);
    const isClosing = !/\s/.test(before) && (/\s|[)\]}"'`.,:;!?~-]/.test(after) || after === '');
    markers.push({ pos, isOpening, isClosing });
    pos += 2;
  }

  const paired = new Set();
  const stack = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (m.isOpening && !m.isClosing) {
      stack.push(i);
    } else if (m.isClosing && stack.length > 0) {
      const openIdx = stack.pop();
      paired.add(markers[openIdx].pos);
      paired.add(m.pos);
    }
  }

  let result = '';
  let lastIdx = 0;
  for (const m of markers) {
    result += text.substring(lastIdx, m.pos);
    if (paired.has(m.pos)) { result += '**'; }
    lastIdx = m.pos + 2;
  }
  result += text.substring(lastIdx);
  return result;
};

/**
 * Clean and format raw AI markdown output:
 * 1. Strips thinking tags (<think>...</think>).
 * 2. Removes raw monologue / persona repeat / raw input bullets prior to official Heading 1.
 * 3. Removes self-verification checklist lines at the end.
 * 4. Cleans LaTeX and math dollar artifacts.
 * 5. Normalizes headings and structural linebreaks.
 * 6. Enforces hierarchical bullet indentation (sub-bullets under group headers).
 */
export function cleanReportMarkdown(text) {
  if (!text) return text;

  let cleaned = text;

  // ── Phase 1: Strip thinking tags (<think>...</think>, <thought>...</thought>) ──
  cleaned = cleaned
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '');

  // ── Phase 2: Strip raw pre-text / monologue before the first official report heading ──
  // Search for the first primary report heading (e.g., "## 1.", "# 1.", "## 1 ", "# BÁO CÁO", "## 💥")
  const headingMatch = cleaned.match(/(?:^|\n)(#{1,3}\s+(?:1[\s.:)]|[💥🎯🔮🗺️]|BÁO CÁO|REPORT))/i);
  if (headingMatch && headingMatch.index !== undefined) {
    const preText = cleaned.substring(0, headingMatch.index).trim();
    // Check if preText consists of raw monologue, persona recital, or raw input bullet recaps
    const hasRawSignals =
      /buy-side|crypto research|role:|persona:|hướng dẫn|- macro:|- net liquidity:|- price structure:|wait, the report date/i.test(preText);
    const hasNoOtherHeadings = !/^\s*#{1,2}\s+/m.test(preText);

    if (hasRawSignals || (preText.length > 0 && hasNoOtherHeadings && preText.includes('- '))) {
      // Cut off raw pre-text
      cleaned = cleaned.substring(headingMatch.index).trimStart();
    }
  }

  // ── Phase 3: Strip self-verification checklist items ──
  // Matches lines like "- Check: No LaTeX? Yes." or "Check: Bold key metrics? Yes."
  cleaned = cleaned.replace(/^\s*[-•*]?\s*(?:Check|Checking|Self-check|Kiểm tra)\s*:\s*.+$/gim, '');

  // If there is an end-of-report anchor (e.g., TÍN HIỆU THEN CHỐT...), strip any following checklist
  const anchorRegex = /(\*\*(?:TÍN HIỆU THEN CHỐT ĐẦU TIÊN BUỘC PHẢI THAY ĐỔI GÓC NHÌN|FIRST FACT THAT WOULD INVALIDATE THIS VIEW):\*\*.*)/i;
  const anchorMatch = cleaned.match(anchorRegex);
  if (anchorMatch && anchorMatch.index !== undefined) {
    const afterAnchor = cleaned.substring(anchorMatch.index + anchorMatch[0].length);
    // If the text after anchor contains leftover checks or section notes, remove them
    const cleanedAfter = afterAnchor
      .replace(/^\s*[-•*]?\s*(?:Check|Checking|Self-check|Kiểm tra).*$/gim, '')
      .replace(/^\s*[-•*]\s*(?:Section|Phần)\s+\d+:.*$/gim, '')
      .trim();
    cleaned = cleaned.substring(0, anchorMatch.index + anchorMatch[0].length) + (cleanedAfter ? '\n\n' + cleanedAfter : '');
  }

  // ── Phase 4: LaTeX symbol cleanup ──
  cleaned = cleaned
    .replace(/\\sim\b/gi, '~')
    .replace(/\\approx\b/gi, '≈')
    .replace(/\\Delta\b/gi, 'Δ')
    .replace(/\\delta\b/gi, 'δ')
    .replace(/\\rightarrow\b/gi, '->')
    .replace(/\\leftarrow\b/gi, '<-')
    .replace(/\\geq?\b/gi, '>=')
    .replace(/\\leq?\b/gi, '<=')
    .replace(/\\times\b/gi, 'x')
    .replace(/\\ref\{[^}]+\}/gi, '')
    .replace(/\\text\{([^}]+)\}/gi, '$1')
    .replace(/\\mathrm\{([^}]+)\}/gi, '$1')
    // Fix dollar math wrappers
    .replace(/\$\s*\\?sim\s*\$?\s*\$?\s*([0-9.,]+[KMBkmb]?)\$?\)?/gi, '~$1')
    .replace(/\$\s*\\?approx\s*\$?\s*\$?\s*([0-9.,]+[KMBkmb]?)\$?\)?/gi, '≈$1')
    .replace(/\$\s*\\?Delta\s*\$?\s*([A-Z0-9.,_]+)\$?/gi, 'Δ $1');

  // ── Phase 5: Pre-clean asterisks ──
  cleaned = cleaned
    .replace(/\*{3,}/g, '**')      // collapse ***+ → **
    .replace(/\*\*\s*\*\*/g, '');  // remove empty ** **

  // ── Phase 6: Structural line-break insertion ──
  cleaned = cleaned.replace(/([^\n#])\s*(#{1,4}\s+)/g, '$1\n\n$2');
  cleaned = cleaned.replace(/([^\n#])\s*(#{1,4}\s+)/g, '$1\n\n$2');

  // Split heading lines that contain an embedded bullet
  cleaned = cleaned
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      const m = trimmed.match(/^(#{1,4}\s+)(.*)$/);
      if (!m) return [line];

      const prefix = m[1];
      const content = m[2];

      let parenDepth = 0;
      let bracketDepth = 0;
      let splitIdx = -1;

      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);

        if (parenDepth === 0 && bracketDepth === 0) {
          const remainder = content.substring(i);
          const bulletMatch = remainder.match(/^(\s*-\s*)(.*)$/);
          if (bulletMatch && i > 0) {
            const afterHyphen = bulletMatch[2];
            const isBullet =
              /^\*{0,2}(?:Đợt\s+biến\s+động|Cú\s+giật|Đợt\s+sóng|Phe\s+|Bể\s+|Vùng\s+|Biên\s+độ|Dòng\s+lệnh|Biến\s+động|Phản\s+ứng|Cơ\s+chế|Kiểu|Move|Impulse|Wave|Trapped|Liquidity)/i.test(afterHyphen) ||
              /^\*{1,2}[^*]+?\*{1,2}\s*:/i.test(afterHyphen) ||
              /^[^:\n]{2,60}:(?:\s+|$)/i.test(afterHyphen) ||
              /^-\s+/.test(afterHyphen);

            if (isBullet) {
              splitIdx = i;
              break;
            }
          }
        }
      }

      if (splitIdx > 0) {
        const heading = (prefix + content.substring(0, splitIdx)).trim();
        const rest = content.substring(splitIdx).replace(/^\s*-\s*/, '');
        return [heading, '- ' + rest];
      }

      return [line];
    })
    .join('\n');

  // Force bullet points onto separate lines (only when preceded by non-newline and not already indented)
  cleaned = cleaned.replace(
    /(?:([^\n\s])\s+-\s*|([)\]])\s*-\s+)(?=\*{0,2}\s*\p{L}[\p{L}\s/&(),'0-9@$]{1,70}?:\s*)/gu,
    (match, p1, p2) => (p1 || p2) + '\n- '
  );

  // ── Phase 7: Hierarchical Bullet Indentation & Formatting ──
  // Identify parent group bullets (e.g., "- Phe Short bị kẹp (Trapped Shorts):")
  // and ensure child content items beneath them are indented with 2 spaces ("  - ").
  const rawLines = cleaned.split('\n');
  const formattedLines = [];
  let inGroupHeader = false;
  let groupBaseIndent = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      formattedLines.push(line);
      continue;
    }

    // Reset group context on markdown headings or horizontal rules
    if (/^#{1,4}\s/.test(trimmed) || /^---/.test(trimmed)) {
      inGroupHeader = false;
      formattedLines.push(line);
      continue;
    }

    // Extract leading indentation
    const indentMatch = line.match(/^(\s*)/);
    let indent = indentMatch ? indentMatch[1] : '';

    if (/^[-•*]\s/.test(trimmed)) {
      // Clean leading bullet symbol to standard '- '
      const contentAfterBullet = trimmed.replace(/^[-•*]\s+/, '');

      // Check if this bullet line is a pure Group Header
      // E.g. ends with ":" or ":**" and has NO long description body after the colon
      const isGroupHeader = /:\s*\*{0,2}$/.test(contentAfterBullet.trim());

      if (isGroupHeader) {
        // This is a parent category bullet
        inGroupHeader = true;
        groupBaseIndent = indent.length;

        // Format header bullet: e.g. "- **Phe Short bị kẹp (Trapped Shorts):**"
        const cleanHeaderLabel = contentAfterBullet.replace(/\*{1,2}/g, '').trim();
        formattedLines.push(`${indent}- **${cleanHeaderLabel}**`);
        continue;
      }

      // If this is a content bullet under an active Group Header:
      if (inGroupHeader) {
        if (indent.length <= groupBaseIndent) {
          // It was unindented (same level as parent), promote it to child level (groupBaseIndent + 2 spaces)
          indent = ' '.repeat(groupBaseIndent + 2);
        } else if (indent.length === groupBaseIndent + 2) {
          // Preserve 2 spaces
          indent = ' '.repeat(groupBaseIndent + 2);
        } else if (indent.length > groupBaseIndent + 2) {
          // Deep child (e.g. 4 spaces)
          indent = ' '.repeat(groupBaseIndent + 4);
        }
      }

      // Parse bullet content: "- [**]Label:[**] Content"
      // Ensure colon is not part of a timestamp (e.g. 21:00)
      const m = contentAfterBullet.match(/^\*{0,2}\s*([^:\n]{1,60}?(?<!\d):(?!\d))\s*\*{0,2}\s*(.*)/);
      if (m) {
        let [, rawLabel, content] = m;
        const label = rawLabel.replace(/\*{1,2}/g, '').trim();
        content = stripOrphanedBold(content);
        formattedLines.push(`${indent}- **${label}** ${content}`.trimEnd());
      } else {
        formattedLines.push(`${indent}- ${stripOrphanedBold(contentAfterBullet)}`.trimEnd());
      }
    } else {
      // Non-bullet lines:
      // If we encounter a plain paragraph text that isn't indented, it breaks the group header context
      if (!indent && trimmed) {
        inGroupHeader = false;
      }
      formattedLines.push(`${indent}${stripOrphanedBold(trimmed)}`);
    }
  }

  cleaned = formattedLines.join('\n');

  // ── Phase 8: Final spacing & formatting polish ──
  cleaned = cleaned
    // Fix missing space between words and dollar amounts
    .replace(/([a-zA-Zà-ỹÀ-Ỹ])(\$[0-9])/g, '$1 $2')
    // Fix missing space after ) before words
    .replace(/([\)])([a-zA-Zà-ỹÀ-Ỹ])/g, '$1 $2')
    // Ensure space after bullet hyphen
    .replace(/^(\s*)-\s*([^\s])/gm, '$1- $2')
    // Tilde / strikethrough prevention
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/~([^~\n]{1,60})~/g, '≈$1')
    .replace(/(?<![~])~(?![~])/g, '');

  return cleaned.trim();
}

/**
 * Backward compatibility alias for cleanLatex
 */
export const cleanLatex = cleanReportMarkdown;

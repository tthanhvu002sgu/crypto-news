import { triggerFileDownload } from './scannerClient.js';

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Format a Date in GMT+7 (Vietnam time) for filenames and report headers.
 */
export function formatTimestampVn(dateInput = new Date()) {
  const date = dateInput instanceof Date && !Number.isNaN(dateInput.getTime())
    ? dateInput
    : new Date();
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  const yyyy = vn.getUTCFullYear();
  const mm = pad2(vn.getUTCMonth() + 1);
  const dd = pad2(vn.getUTCDate());
  const hh = pad2(vn.getUTCHours());
  const min = pad2(vn.getUTCMinutes());
  return {
    compact: `${yyyy}${mm}${dd}-${hh}${min}`,
    display: `${yyyy}-${mm}-${dd} ${hh}:${min} (GMT+7)`,
  };
}

/**
 * Build a clean, filesystem-safe filename with timestamp and extension.
 */
export function buildReportFilename(prefix = 'ai-analysis', extension = 'md', dateInput = new Date()) {
  const safePrefix = String(prefix || 'ai-analysis')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'ai-analysis';
  const safeExt = String(extension || 'md').replace(/^\.+/, '').toLowerCase();
  const { compact } = formatTimestampVn(dateInput);
  return `${safePrefix}-${compact}.${safeExt}`;
}

/**
 * Escape HTML special characters for safe interpolation in printable HTML templates.
 */
export function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Copy plain text (Markdown) to clipboard with a textarea fallback.
 */
export async function copyTextToClipboard(text) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (!value.trim()) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(ok);
  } catch {
    return false;
  }
}

/**
 * Download AI analysis Markdown content as a UTF-8 .md file.
 */
export function exportReportToMarkdown(markdown, { filenamePrefix = 'ai-analysis', date = new Date() } = {}) {
  const content = typeof markdown === 'string' ? markdown.trim() : '';
  if (!content) {
    return { ok: false, filename: null };
  }
  const filename = buildReportFilename(filenamePrefix, 'md', date);
  triggerFileDownload(`${content}\n`, filename, 'text/markdown;charset=utf-8;');
  return { ok: true, filename };
}

/**
 * Clone a rendered report DOM element and replace any live <canvas> charts
 * with crisp static PNG <img> snapshots so they print cleanly in PDF.
 */
export function cloneRenderedContentWithCanvasSnapshots(sourceElement) {
  if (!sourceElement || typeof sourceElement.cloneNode !== 'function') {
    return '';
  }

  const clone = sourceElement.cloneNode(true);

  // Remove any explicitly non-printable UI chrome inside the container
  clone.querySelectorAll('.no-print').forEach((node) => node.remove());

  const originalCanvases = sourceElement.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');

  originalCanvases.forEach((canvas, idx) => {
    const targetCanvas = clonedCanvases[idx];
    if (!targetCanvas || !targetCanvas.parentNode) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl !== 'data:,') {
        const img = sourceElement.ownerDocument.createElement('img');
        img.src = dataUrl;
        img.alt = canvas.getAttribute('aria-label') || 'Chart snapshot';
        img.className = 'pdf-chart-snapshot';
        targetCanvas.parentNode.replaceChild(img, targetCanvas);
      }
    } catch {
      // Ignore tainted canvas errors and leave placeholder
    }
  });

  return clone.innerHTML;
}

/**
 * Build a standalone, print-ready HTML document styled for A4 PDF export
 * with full Vietnamese Unicode support and institutional typography.
 */
export function buildPrintablePdfHtml({
  title = 'AI Market Analysis Report',
  subtitle = '',
  bodyHtml = '',
  generatedAt = formatTimestampVn().display,
} = {}) {
  const safeTitle = escapeHtml(title);
  const safeSubtitle = escapeHtml(subtitle);
  const safeGeneratedAt = escapeHtml(generatedAt);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 15mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1e293b;
      font-family: 'Inter', 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 10.5pt;
      line-height: 1.65;
    }

    .pdf-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
    }

    .pdf-title {
      margin: 0;
      font-size: 15pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
    }

    .pdf-subtitle {
      margin: 4px 0 0;
      font-size: 8.5pt;
      color: #475569;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .pdf-meta {
      text-align: right;
      font-size: 8pt;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
    }

    .pdf-content h1,
    .pdf-content h2,
    .pdf-content h3,
    .pdf-content h4 {
      color: #0f172a;
      break-after: avoid;
      page-break-after: avoid;
      line-height: 1.35;
    }

    .pdf-content h1 {
      font-size: 14pt;
      font-weight: 800;
      margin: 18px 0 8px;
      padding-bottom: 5px;
      border-bottom: 1.5px solid #cbd5e1;
    }

    .pdf-content h2 {
      font-size: 12pt;
      font-weight: 700;
      margin: 16px 0 7px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }

    .pdf-content h3 {
      font-size: 10.8pt;
      font-weight: 700;
      margin: 13px 0 5px;
      padding-left: 8px;
      border-left: 3px solid #059669;
    }

    .pdf-content h4 {
      font-size: 10pt;
      font-weight: 700;
      color: #334155;
      margin: 10px 0 4px;
    }

    .pdf-content p {
      margin: 0 0 9px;
      color: #1e293b;
    }

    .pdf-content ul,
    .pdf-content ol {
      margin: 0 0 10px;
      padding-left: 20px;
    }

    .pdf-content li {
      margin-bottom: 4px;
    }

    .pdf-content strong,
    .pdf-content b {
      color: #0f172a;
      font-weight: 700;
    }

    .pdf-content hr {
      border: 0;
      border-top: 1px solid #cbd5e1;
      margin: 14px 0;
    }

    .pdf-content blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      border-left: 3px solid #059669;
      background: #f8fafc;
      color: #334155;
      break-inside: avoid;
    }

    .pdf-content blockquote p:last-child {
      margin-bottom: 0;
    }

    .pdf-content .table-responsive-wrapper {
      width: 100%;
      overflow: visible;
      margin: 10px 0 14px;
    }

    .pdf-content table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      margin: 8px 0 12px;
    }

    .pdf-content thead {
      display: table-header-group;
    }

    .pdf-content tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .pdf-content th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
      text-align: left;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
    }

    .pdf-content td {
      padding: 5px 8px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }

    .pdf-content tr:nth-child(even) td {
      background: #f8fafc;
    }

    .pdf-content code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 8.8pt;
      background: #f1f5f9;
      color: #0f172a;
      padding: 1px 4px;
      border-radius: 3px;
    }

    .pdf-content pre {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 10px 12px;
      overflow-x: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      break-inside: avoid;
    }

    .pdf-content pre code {
      background: transparent;
      padding: 0;
    }

    .pdf-content .num-highlight {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-weight: 700;
      color: #0f172a;
    }

    .pdf-content .num-highlight.positive {
      color: #047857;
    }

    .pdf-content .num-highlight.negative {
      color: #be123c;
    }

    .pdf-content .summary-evidence-group {
      margin: 12px 0 16px;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #f8fafc;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .pdf-content .summary-evidence-label {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 8pt;
      font-weight: 700;
      color: #475569;
      margin-bottom: 8px;
      letter-spacing: 0.05em;
    }

    .pdf-content .summary-evidence-charts {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .pdf-content .pdf-chart-snapshot {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 4px auto;
      border-radius: 4px;
      background: #0f172a;
      padding: 6px;
    }

    .pdf-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 7.5pt;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <header class="pdf-header">
    <div>
      <h1 class="pdf-title">${safeTitle}</h1>
      ${safeSubtitle ? `<p class="pdf-subtitle">${safeSubtitle}</p>` : ''}
    </div>
    <div class="pdf-meta">${safeGeneratedAt}</div>
  </header>
  <main class="pdf-content">
    ${bodyHtml}
  </main>
  <footer class="pdf-footer">
    <span>AI Market Decision Lab</span>
    <span>${safeGeneratedAt}</span>
  </footer>
</body>
</html>`;
}

/**
 * Export rendered AI report to PDF via a hidden printable iframe.
 * Uses native browser print-to-PDF for crisp vector text, full Vietnamese Unicode,
 * proper A4 pagination, and embedded Chart.js snapshots.
 */
export async function exportReportToPdf({
  element = null,
  markdown = '',
  title = 'AI Market Analysis Report',
  subtitle = '',
  filenamePrefix = 'ai-analysis',
  date = new Date(),
} = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, filename: null };
  }

  const rawText = typeof markdown === 'string' ? markdown.trim() : '';
  const bodyHtml = element
    ? cloneRenderedContentWithCanvasSnapshots(element)
    : rawText
      ? `<pre>${escapeHtml(rawText)}</pre>`
      : '';

  if (!bodyHtml.trim()) {
    return { ok: false, filename: null };
  }

  const filename = buildReportFilename(filenamePrefix, 'pdf', date);
  const { display: generatedAt } = formatTimestampVn(date);
  const html = buildPrintablePdfHtml({
    title,
    subtitle,
    bodyHtml,
    generatedAt,
  });

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';

    const previousTitle = document.title;
    const pdfBaseName = filename.replace(/\.pdf$/i, '');
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      document.title = previousTitle;
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 300);
    };

    document.body.appendChild(iframe);

    const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
    const frameWin = iframe.contentWindow;
    if (!frameDoc || !frameWin) {
      cleanup();
      resolve({ ok: false, filename: null });
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    const triggerPrint = () => {
      try {
        document.title = pdfBaseName;
        frameWin.focus();
        const onAfterPrint = () => {
          frameWin.removeEventListener('afterprint', onAfterPrint);
          window.removeEventListener('afterprint', onAfterPrint);
          cleanup();
        };
        frameWin.addEventListener('afterprint', onAfterPrint);
        window.addEventListener('afterprint', onAfterPrint);
        // Fallback cleanup in case afterprint does not fire in some browsers
        setTimeout(cleanup, 60000);
        frameWin.print();
        resolve({ ok: true, filename });
      } catch {
        cleanup();
        resolve({ ok: false, filename: null });
      }
    };

    // Wait briefly for any snapshot <img> elements to decode before printing
    const images = Array.from(frameDoc.images || []);
    if (images.length === 0) {
      setTimeout(triggerPrint, 60);
      return;
    }

    Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((imgResolve) => {
          img.onload = imgResolve;
          img.onerror = imgResolve;
          setTimeout(imgResolve, 1500);
        });
      })
    ).then(() => {
      setTimeout(triggerPrint, 60);
    });
  });
}

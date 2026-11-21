import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportFilename,
  buildPrintablePdfHtml,
  escapeHtml,
  exportReportToMarkdown,
  formatTimestampVn,
} from './aiReportExport.js';

test('formatTimestampVn formats UTC date into GMT+7 compact and display strings', () => {
  const utcDate = new Date('2026-11-21T03:25:00.000Z');
  const formatted = formatTimestampVn(utcDate);
  assert.equal(formatted.compact, '20261121-1025');
  assert.equal(formatted.display, '2026-11-21 10:25 (GMT+7)');
});

test('buildReportFilename sanitizes prefix and applies .md or .pdf extension', () => {
  const utcDate = new Date('2026-11-21T03:25:00.000Z');
  assert.equal(
    buildReportFilename('AI Analysis / Professional', '.md', utcDate),
    'ai-analysis-professional-20261121-1025.md'
  );
  assert.equal(
    buildReportFilename('ai-trade-audit-LONG', 'PDF', utcDate),
    'ai-trade-audit-long-20261121-1025.pdf'
  );
});

test('escapeHtml escapes special HTML characters', () => {
  assert.equal(
    escapeHtml('<script>alert("x" & \'y\')</script>'),
    '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
  );
});

test('exportReportToMarkdown rejects empty content and succeeds for valid markdown', () => {
  assert.deepEqual(exportReportToMarkdown('   '), { ok: false, filename: null });

  const utcDate = new Date('2026-11-21T03:25:00.000Z');
  const res = exportReportToMarkdown('# Phân tích BTC\n\nNội dung chi tiết.', {
    filenamePrefix: 'ai-analysis-compact',
    date: utcDate,
  });
  assert.equal(res.ok, true);
  assert.equal(res.filename, 'ai-analysis-compact-20261121-1025.md');
});

test('buildPrintablePdfHtml generates A4 print HTML with escaped metadata and body content', () => {
  const html = buildPrintablePdfHtml({
    title: 'Báo cáo <AI> & Thị trường',
    subtitle: 'gemma-4-31b-it • VI',
    bodyHtml: '<h2>Kết luận</h2><p>Giá BTC đang ở vùng hỗ trợ.</p>',
    generatedAt: '2026-11-21 10:25 (GMT+7)',
  });

  assert.match(html, /@page\s*\{\s*size:\s*A4;/);
  assert.match(html, /Báo cáo &lt;AI&gt; &amp; Thị trường/);
  assert.match(html, /gemma-4-31b-it • VI/);
  assert.match(html, /<h2>Kết luận<\/h2><p>Giá BTC đang ở vùng hỗ trợ\.<\/p>/);
  assert.match(html, /2026-11-21 10:25 \(GMT\+7\)/);
});

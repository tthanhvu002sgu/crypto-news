import { useState, useRef, useEffect } from 'react';
import { Copy, Check, Download, ChevronDown, FileText, Printer, Loader2 } from 'lucide-react';
import {
  copyTextToClipboard,
  exportReportToMarkdown,
  exportReportToPdf,
} from '../services/aiReportExport';

export default function AiReportActions({
  content = '',
  contentRef = null,
  isLoading = false,
  isVi = true,
  filenamePrefix = 'ai-analysis',
  reportTitle = 'AI Market Analysis Report',
  reportSubtitle = '',
  label = '',
}) {
  const [copied, setCopied] = useState(false);
  const [exportStatus, setExportStatus] = useState(''); // '' | 'md' | 'pdf'
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const dropdownRef = useRef(null);
  const copyTimerRef = useRef(null);
  const exportTimerRef = useRef(null);

  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const isDisabled = !hasContent || isLoading;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleCopy = async () => {
    if (isDisabled) return;
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportMd = () => {
    if (isDisabled) return;
    setMenuOpen(false);
    const result = exportReportToMarkdown(content, { filenamePrefix });
    if (result.ok) {
      setExportStatus('md');
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
      exportTimerRef.current = setTimeout(() => setExportStatus(''), 2200);
    }
  };

  const handleExportPdf = async () => {
    if (isDisabled || isExportingPdf) return;
    setMenuOpen(false);
    setIsExportingPdf(true);
    try {
      const result = await exportReportToPdf({
        element: contentRef?.current || null,
        markdown: content,
        title: reportTitle,
        subtitle: reportSubtitle,
        filenamePrefix,
      });
      if (result.ok) {
        setExportStatus('pdf');
        if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
        exportTimerRef.current = setTimeout(() => setExportStatus(''), 2200);
      }
    } finally {
      setIsExportingPdf(false);
    }
  };

  const displayLabel = label || (isVi ? 'BÀI PHÂN TÍCH AI' : 'AI ANALYSIS REPORT');

  return (
    <div className="ai-report-toolbar no-print">
      <div className="ai-report-toolbar-meta font-mono">
        <span className="ai-report-toolbar-title">{displayLabel}</span>
        {isLoading && (
          <span className="ai-report-toolbar-streaming">
            <Loader2 size={12} className="spinning" />
            {isVi ? 'Đang tạo...' : 'Streaming...'}
          </span>
        )}
      </div>

      <div className="ai-report-toolbar-actions">
        <button
          type="button"
          className={`ai-report-btn font-mono ${copied ? 'is-success' : ''}`}
          onClick={handleCopy}
          disabled={isDisabled}
          title={isVi ? 'Sao chép toàn bộ nội dung Markdown' : 'Copy full Markdown report'}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>
            {copied
              ? (isVi ? 'ĐÃ COPY' : 'COPIED')
              : (isVi ? 'COPY' : 'COPY')}
          </span>
        </button>

        <div className="ai-report-export-wrap" ref={dropdownRef}>
          <button
            type="button"
            className={`ai-report-btn ai-report-btn-export font-mono ${exportStatus ? 'is-success' : ''}`}
            onClick={() => setMenuOpen((prev) => !prev)}
            disabled={isDisabled || isExportingPdf}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={isVi ? 'Xuất bài phân tích ra file .md hoặc .pdf' : 'Export report as .md or .pdf'}
          >
            {isExportingPdf ? (
              <Loader2 size={13} className="spinning" />
            ) : exportStatus ? (
              <Check size={13} />
            ) : (
              <Download size={13} />
            )}
            <span>
              {isExportingPdf
                ? (isVi ? 'ĐANG XUẤT PDF...' : 'EXPORTING PDF...')
                : exportStatus === 'md'
                  ? (isVi ? 'ĐÃ XUẤT .MD' : 'EXPORTED .MD')
                  : exportStatus === 'pdf'
                    ? (isVi ? 'ĐÃ MỞ IN PDF' : 'PDF READY')
                    : (isVi ? 'EXPORT' : 'EXPORT')}
            </span>
            <ChevronDown size={12} className={`ai-report-chevron ${menuOpen ? 'is-open' : ''}`} />
          </button>

          {menuOpen && (
            <div className="ai-report-export-menu" role="menu">
              <button
                type="button"
                className="ai-report-export-item"
                role="menuitem"
                onClick={handleExportMd}
              >
                <FileText size={14} className="ai-report-export-icon md" />
                <div className="ai-report-export-text">
                  <span className="ai-report-export-name font-mono">Markdown (.md)</span>
                  <span className="ai-report-export-desc">
                    {isVi ? 'Tải file .md chuẩn giữ nguyên định dạng' : 'Download raw UTF-8 Markdown file'}
                  </span>
                </div>
              </button>

              <button
                type="button"
                className="ai-report-export-item"
                role="menuitem"
                onClick={handleExportPdf}
              >
                <Printer size={14} className="ai-report-export-icon pdf" />
                <div className="ai-report-export-text">
                  <span className="ai-report-export-name font-mono">PDF (.pdf)</span>
                  <span className="ai-report-export-desc">
                    {isVi ? 'Xuất bản in PDF khổ A4 kèm bảng & biểu đồ' : 'Print-ready A4 PDF with tables & charts'}
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

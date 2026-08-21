/**
 * Google Apps Script for Crypto News Dashboard Sync
 * 
 * HƯỚNG DẪN CÀI ĐẶT:
 * 1. Tạo một Google Sheet mới trên Google Drive của bạn.
 * 2. Vào Tiện ích mở rộng (Extensions) > Apps Script.
 * 3. Xóa hết mã cũ và dán toàn bộ đoạn code này vào.
 * 4. Nhấn "Triển khai" (Deploy) > "Triển khai mới" (New deployment).
 * 5. Chọn loại: "Ứng dụng web" (Web app).
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me).
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone).
 * 6. Nhấn "Triển khai" (Deploy), cấp quyền và copy đường link "URL của ứng dụng web" (Webhook URL).
 * 7. Dán Webhook URL này vào GitHub Repo Secrets (tên: GOOGLE_SHEET_WEBHOOK_URL) hoặc Settings trên Web Dashboard.
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "No post data received"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Tab: OVERVIEW_BIAS
    if (payload.overview && Array.isArray(payload.overview)) {
      writeTableToSheet(ss, "OVERVIEW_BIAS", payload.overview, "#1e293b", "#38bdf8");
    }

    // 2. Tab: DERIVATIVES_FLOW
    if (payload.derivatives && Array.isArray(payload.derivatives)) {
      writeTableToSheet(ss, "DERIVATIVES_FLOW", payload.derivatives, "#1e293b", "#10b981");
    }

    // 3. Tab: ETF_ONCHAIN
    if (payload.etf_onchain && Array.isArray(payload.etf_onchain)) {
      writeTableToSheet(ss, "ETF_ONCHAIN", payload.etf_onchain, "#1e293b", "#f59e0b");
    }

    // 4. Tab: MACRO_CALENDAR
    if (payload.macro && Array.isArray(payload.macro)) {
      writeTableToSheet(ss, "MACRO_CALENDAR", payload.macro, "#1e293b", "#ec4899");
    }

    // 5. Tab: AI_PROMPT_SUMMARY (Markdown text format)
    if (payload.ai_summary_md) {
      writeMarkdownSummarySheet(ss, "AI_PROMPT_SUMMARY", payload.ai_summary_md, payload.sessionName || "SESSION UPDATE", payload.timestamp);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      timestamp: new Date().toISOString(),
      session: payload.sessionName || "UNKNOWN",
      message: "Data synced successfully to Google Sheets!"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    service: "Crypto News Google Sheets Sync Endpoint",
    time: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ghi đè bảng dữ liệu 2D lên một Sheet và căn chỉnh format
 */
function writeTableToSheet(ss, sheetName, dataRows, headerBgColor, accentColor) {
  if (!dataRows || dataRows.length === 0) return;

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  var numRows = dataRows.length;
  var numCols = dataRows[0].length;
  var range = sheet.getRange(1, 1, numRows, numCols);

  range.setValues(dataRows);

  // Format Header Row
  var headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground(headerBgColor);
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontFamily("Roboto Mono");
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment("center");

  // Format Data Rows
  if (numRows > 1) {
    var dataRange = sheet.getRange(2, 1, numRows - 1, numCols);
    dataRange.setFontFamily("Roboto Mono");
    dataRange.setFontSize(9);
    dataRange.setVerticalAlignment("middle");
  }

  // Auto-resize columns
  for (var col = 1; col <= numCols; col++) {
    sheet.autoResizeColumn(col);
    var width = sheet.getColumnWidth(col);
    sheet.setColumnWidth(col, Math.max(width + 20, 110));
  }

  sheet.setFrozenRows(1);
}

/**
 * Ghi đoạn văn bản tổng kết Markdown hoàn chỉnh cho AI đọc
 */
function writeMarkdownSummarySheet(ss, sheetName, markdownText, sessionName, timestamp) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  sheet.setColumnWidth(1, 950);

  // Title Banner
  var titleCell = sheet.getRange("A1");
  titleCell.setValue("🤖 AI MARKET CONTEXT PROMPT & SUMMARY (" + sessionName + " - " + (timestamp || new Date().toISOString()) + ")");
  titleCell.setBackground("#0f172a");
  titleCell.setFontColor("#38bdf8");
  titleCell.setFontWeight("bold");
  titleCell.setFontSize(12);
  titleCell.setFontFamily("Roboto Mono");

  // Subtitle
  var guideCell = sheet.getRange("A2");
  guideCell.setValue("Hướng dẫn: AI hoặc người dùng có thể sao chép toàn bộ nội dung ô A4 bên dưới để nạp ngữ cảnh phân tích thị trường.");
  guideCell.setFontStyle("italic");
  guideCell.setFontColor("#64748b");
  guideCell.setFontFamily("Roboto Mono");
  guideCell.setFontSize(9);

  // Markdown Content Cell
  var contentCell = sheet.getRange("A4");
  contentCell.setValue(markdownText);
  contentCell.setWrap(true);
  contentCell.setFontFamily("Roboto Mono");
  contentCell.setFontSize(9.5);
  contentCell.setBackground("#f8fafc");
  contentCell.setFontColor("#0f172a");
  contentCell.setVerticalAlignment("top");
  sheet.setRowHeight(4, 700);
}

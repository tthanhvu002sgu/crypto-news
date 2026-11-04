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

    var rawContents = e.postData.contents;
    var payload;
    try {
      payload = JSON.parse(rawContents);
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "JSON parse error: " + parseErr.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Tab: OVERVIEW_BIAS
    if (payload.overview && Array.isArray(payload.overview)) {
      writeTableToSheet(ss, "OVERVIEW_BIAS", payload.overview, "#0f172a", "#38bdf8");
    }

    // 2. Tab: DERIVATIVES_FLOW
    if (payload.derivatives && Array.isArray(payload.derivatives)) {
      writeTableToSheet(ss, "DERIVATIVES_FLOW", payload.derivatives, "#0f172a", "#10b981");
    }

    // 3. Tab: ETF_ONCHAIN
    if (payload.etf_onchain && Array.isArray(payload.etf_onchain)) {
      writeTableToSheet(ss, "ETF_ONCHAIN", payload.etf_onchain, "#0f172a", "#f59e0b");
    }

    // 4. Tab: MACRO_CALENDAR
    if (payload.macro && Array.isArray(payload.macro)) {
      writeTableToSheet(ss, "MACRO_CALENDAR", payload.macro, "#0f172a", "#ec4899");
    }

    // 5. Tab: AI_PROMPT_SUMMARY (Markdown text format)
    if (payload.ai_summary_md) {
      writeMarkdownSummarySheet(ss, "AI_PROMPT_SUMMARY", payload.ai_summary_md, payload.sessionName || "SESSION UPDATE", payload.timestamp);
    }

    // 6. Tab: MOVES_HISTORY_LOG (Append time-series permanent log)
    if (payload.history_log_row && Array.isArray(payload.history_log_row)) {
      appendHistoryLogRow(ss, "MOVES_HISTORY_LOG", payload.history_log_row);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      timestamp: new Date().toISOString(),
      session: payload.sessionName || "UNKNOWN",
      completeness: payload.validation ? payload.validation.completenessScore : 100,
      message: "Data synced successfully to Google Spreadsheets (including MOVES_HISTORY_LOG)!"
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
 * Ghi đè bảng dữ liệu 2D lên một Sheet và căn chỉnh format chuẩn đẹp
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
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 35);

  // Format Data Rows
  if (numRows > 1) {
    var dataRange = sheet.getRange(2, 1, numRows - 1, numCols);
    dataRange.setFontFamily("Roboto Mono");
    dataRange.setFontSize(9);
    dataRange.setVerticalAlignment("middle");

    // Alternating row background for readability
    for (var r = 2; r <= numRows; r++) {
      sheet.setRowHeight(r, 26);
      var rowRange = sheet.getRange(r, 1, 1, numCols);
      if (r % 2 === 0) {
        rowRange.setBackground("#f8fafc");
      } else {
        rowRange.setBackground("#ffffff");
      }
    }

    // Align First Column Left, Others Center/Right
    var col1Range = sheet.getRange(2, 1, numRows - 1, 1);
    col1Range.setHorizontalAlignment("left");
    col1Range.setFontWeight("bold");
  }

  // Auto-resize columns
  for (var col = 1; col <= numCols; col++) {
    sheet.autoResizeColumn(col);
    var width = sheet.getColumnWidth(col);
    sheet.setColumnWidth(col, Math.max(width + 25, 120));
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

  sheet.setColumnWidth(1, 1000);

  // Title Banner
  var titleCell = sheet.getRange("A1");
  titleCell.setValue("🤖 AI MARKET CONTEXT PROMPT & SUMMARY (" + sessionName + " - " + (timestamp || new Date().toISOString()) + ")");
  titleCell.setBackground("#0f172a");
  titleCell.setFontColor("#38bdf8");
  titleCell.setFontWeight("bold");
  titleCell.setFontSize(12);
  titleCell.setFontFamily("Roboto Mono");
  titleCell.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  // Subtitle
  var guideCell = sheet.getRange("A2");
  guideCell.setValue("Hướng dẫn: Sao chép toàn bộ nội dung ô A4 bên dưới để nạp ngữ cảnh vào Claude / ChatGPT / Gemini theo chuẩn AI Market Decision Lab.");
  guideCell.setFontStyle("italic");
  guideCell.setFontColor("#64748b");
  guideCell.setFontFamily("Roboto Mono");
  guideCell.setFontSize(9.5);
  guideCell.setVerticalAlignment("middle");
  sheet.setRowHeight(2, 25);

  // Markdown Content Cell
  var contentCell = sheet.getRange("A4");
  contentCell.setValue(markdownText);
  contentCell.setWrap(true);
  contentCell.setFontFamily("Roboto Mono");
  contentCell.setFontSize(9.5);
  contentCell.setBackground("#f8fafc");
  contentCell.setFontColor("#0f172a");
  contentCell.setVerticalAlignment("top");
  sheet.setRowHeight(4, 800);
}

/**
 * Append row vào Sheet MOVES_HISTORY_LOG mà không xóa dữ liệu cũ (lưu trữ nối tiếp vĩnh viễn)
 */
function appendHistoryLogRow(ss, sheetName, rowData) {
  if (!rowData || rowData.length === 0) return;

  var sheet = ss.getSheetByName(sheetName);
  var isNewSheet = false;
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    isNewSheet = true;
  }

  // Nếu sheet mới tạo hoặc trống rỗng (getLastRow() === 0), tạo hàng tiêu đề (Headers)
  if (isNewSheet || sheet.getLastRow() === 0) {
    var headers = [
      "Thời Gian (GMT+7)",
      "Thời Gian (UTC)",
      "Phiên Giao Dịch",
      "Giá BTC (USD)",
      "Biến Động 24h (%)",
      "Tổng Vốn Hóa (Total Cap)",
      "Open Interest (BTC)",
      "Funding Rate 8h (%)",
      "Bias Total Score",
      "Bias Label",
      "CVD Spot 24h",
      "CVD Futures 24h",
      "Tóm Tắt Cú Giật 24h Mạnh Nhất",
      "Nguồn Đồng Bộ"
    ];
    sheet.appendRow(headers);

    var numCols = headers.length;
    var headerRange = sheet.getRange(1, 1, 1, numCols);
    headerRange.setBackground("#0f172a");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontFamily("Roboto Mono");
    headerRange.setFontSize(10);
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");
    sheet.setRowHeight(1, 35);
    sheet.setFrozenRows(1);

    for (var col = 1; col <= numCols; col++) {
      sheet.autoResizeColumn(col);
      var width = sheet.getColumnWidth(col);
      sheet.setColumnWidth(col, Math.max(width + 25, 130));
    }
  }

  // Append row mới
  sheet.appendRow(rowData);
  var newRowNum = sheet.getLastRow();
  sheet.setRowHeight(newRowNum, 26);
  var rowRange = sheet.getRange(newRowNum, 1, 1, rowData.length);
  rowRange.setFontFamily("Roboto Mono");
  rowRange.setFontSize(9);
  rowRange.setVerticalAlignment("middle");
  if (newRowNum % 2 === 0) {
    rowRange.setBackground("#f8fafc");
  } else {
    rowRange.setBackground("#ffffff");
  }
}



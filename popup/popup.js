import {
  buildOutputCsv,
  buildOutputText,
  buildOutputJson,
  buildMergedOutput,
  extractEmailsFromText,
  extractTrustworthyEmails,
  extractEmailFromCell,
  findEmailColumnIndex,
  getUniqueEmails,
  getPreviewTable,
  parseColumnConfig,
  applyColumnMap,
  rowLooksLikeHeader,
  normalizeHeader,
  splitDelimitedLine,
} from "../scripts/csv.js";
import { runOcrScan } from "../scripts/ocr-scan.js";
import {
  VALIDATION_BATCH_SIZE,
  VALIDATION_EMAILS_PER_SEC,
} from "../scripts/config.js";

const STORAGE_KEY = "emailValidatorSettings";

const scanBtn = document.getElementById("scanBtn");
const ocrBtn = document.getElementById("ocrBtn");
const validateBtn = document.getElementById("validateBtn");
const scanInfo = document.getElementById("scanInfo");
const sourceLabel = document.getElementById("sourceLabel");
const rowCount = document.getElementById("rowCount");
const emailCount = document.getElementById("emailCount");
const validateCount = document.getElementById("validateCount");
const warningMsg = document.getElementById("warningMsg");
const progressPanel = document.getElementById("progressPanel");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const batchText = document.getElementById("batchText");
const previewPanel = document.getElementById("previewPanel");
const previewTable = document.getElementById("previewTable");
const statusMsg = document.getElementById("statusMsg");
const exportCsvCheckbox = document.getElementById("exportCsv");
const exportJsonCheckbox = document.getElementById("exportJson");
const deliveryDownloadCheckbox = document.getElementById("deliveryDownload");
const deliveryCopyCheckbox = document.getElementById("deliveryCopy");
const deliveryNewSpreadsheetCheckbox = document.getElementById("deliveryNewSpreadsheet");
const deliveryNewBlankSheetCheckbox = document.getElementById("deliveryNewBlankSheet");
const deliveryUpdateCurrentSheetCheckbox = document.getElementById("deliveryUpdateCurrentSheet");
const exportValidUnknownCheckbox = document.getElementById("exportValidUnknown");
const accountAvatar = document.getElementById("accountAvatar");
const accountName = document.getElementById("accountName");
const accountEmail = document.getElementById("accountEmail");
const accountSignInBtn = document.getElementById("accountSignInBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const copyPanel = document.getElementById("copyPanel");
const copySummary = document.getElementById("copySummary");
const copyTxtBtn = document.getElementById("copyTxtBtn");
const copyCsvBtn = document.getElementById("copyCsvBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const sheetLinkPanel = document.getElementById("sheetLinkPanel");
const createdSheetLink = document.getElementById("createdSheetLink");
const pasteInput = document.getElementById("pasteInput");
const columnConfigInput = document.getElementById("columnConfig");
const usePasteBtn = document.getElementById("usePasteBtn");
const clearPasteBtn = document.getElementById("clearPasteBtn");
const resultFilter = document.getElementById("resultFilter");
const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;

let scannedData = null;
let lastExportPayload = { txt: "", csv: "", json: "" };
let lastMergedOutput = null;

function scrollToSection(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getPreviewRowsByFilter(headers, rows, filterValue) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return rows || [];
  const validColIdx = headers.findIndex((h) => String(h || "").trim().toLowerCase() === "valid");
  if (validColIdx === -1 || !filterValue || filterValue === "all") return rows;

  if (filterValue === "valid") {
    return rows.filter((row) => {
      const v = String(row?.[validColIdx] || "").trim().toLowerCase();
      return v === "valid";
    });
  }
  if (filterValue === "invalid") {
    return rows.filter((row) => {
      const v = String(row?.[validColIdx] || "").trim().toLowerCase();
      return v === "invalid";
    });
  }
  return rows;
}

function renderMergedPreview() {
  if (!lastMergedOutput) return;
  const filterValue = resultFilter?.value || "all";
  const filteredRows = getPreviewRowsByFilter(
    lastMergedOutput.headers,
    lastMergedOutput.rows,
    filterValue
  );
  const preview = getPreviewTable(
    lastMergedOutput.headers,
    filteredRows,
    Math.max(filteredRows.length, 1)
  );
  renderPreview(preview.headers, preview.rows);
}

function getSettings() {
  return {
    columnConfig: columnConfigInput.value.trim(),
    exportCsv: exportCsvCheckbox.checked,
    exportJson: exportJsonCheckbox.checked,
    exportValidUnknownOnly: exportValidUnknownCheckbox?.checked !== false,
    deliveryDownload: deliveryDownloadCheckbox.checked,
    deliveryCopy: deliveryCopyCheckbox.checked,
    deliveryNewSpreadsheet: deliveryNewSpreadsheetCheckbox?.checked || false,
    deliveryNewBlankSheet: deliveryNewBlankSheetCheckbox?.checked || false,
    deliveryUpdateCurrentSheet: deliveryUpdateCurrentSheetCheckbox?.checked || false,
    theme: root.getAttribute("data-theme") === "dark" ? "dark" : "light",
  };
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  root.setAttribute("data-theme", next);
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const s = stored[STORAGE_KEY];
    if (!s) return;
    if (typeof s.columnConfig === "string") columnConfigInput.value = s.columnConfig;
    if (typeof s.exportCsv === "boolean") exportCsvCheckbox.checked = s.exportCsv;
    if (typeof s.exportJson === "boolean") exportJsonCheckbox.checked = s.exportJson;
    if (typeof s.deliveryDownload === "boolean") {
      deliveryDownloadCheckbox.checked = s.deliveryDownload;
    }
    if (typeof s.deliveryCopy === "boolean") {
      deliveryCopyCheckbox.checked = s.deliveryCopy;
    }
    if (typeof s.exportValidUnknownOnly === "boolean" && exportValidUnknownCheckbox) {
      exportValidUnknownCheckbox.checked = s.exportValidUnknownOnly;
    }
    if (typeof s.deliveryNewSpreadsheet === "boolean" && deliveryNewSpreadsheetCheckbox) {
      deliveryNewSpreadsheetCheckbox.checked = s.deliveryNewSpreadsheet;
    }
    if (typeof s.deliveryNewBlankSheet === "boolean" && deliveryNewBlankSheetCheckbox) {
      deliveryNewBlankSheetCheckbox.checked = s.deliveryNewBlankSheet;
    }
    if (typeof s.deliveryUpdateCurrentSheet === "boolean" && deliveryUpdateCurrentSheetCheckbox) {
      deliveryUpdateCurrentSheetCheckbox.checked = s.deliveryUpdateCurrentSheet;
    }
    if (s.theme === "dark" || s.theme === "light") {
      applyTheme(s.theme);
    }
  } catch {
    /* ignore */
  }
}

function saveSettings() {
  chrome.storage.local.set({ [STORAGE_KEY]: getSettings() }).catch(() => {});
}

for (const el of [
  columnConfigInput,
  exportCsvCheckbox,
  exportJsonCheckbox,
  exportValidUnknownCheckbox,
  deliveryDownloadCheckbox,
  deliveryCopyCheckbox,
  deliveryNewSpreadsheetCheckbox,
  deliveryNewBlankSheetCheckbox,
  deliveryUpdateCurrentSheetCheckbox,
]) {
  if (!el) continue;
  el.addEventListener("change", () => {
    saveSettings();
    updateValidateCount();
  });
}

function canWriteValidColumnToCurrentSheet() {
  return Boolean(
    deliveryUpdateCurrentSheetCheckbox?.checked &&
      scannedData?.spreadsheetId &&
      scannedData?.worksheetName
  );
}

function ensureDeliverySelection() {
  if (
    deliveryDownloadCheckbox.checked ||
    deliveryCopyCheckbox.checked ||
    deliveryNewSpreadsheetCheckbox?.checked ||
    deliveryNewBlankSheetCheckbox?.checked ||
    canWriteValidColumnToCurrentSheet()
  ) {
    return true;
  }
  showStatus(
    "Select Download, Copy, New spreadsheet, New blank sheet, or Update current sheet.",
    "error"
  );
  return false;
}

/** Status buckets for export filter: valid | invalid | unknown */
function emailExportBucket(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "valid") return "valid";
  if (s === "invalid") return "invalid";
  return "unknown";
}

function filterEmailsForExport(emails, validationMap, validUnknownOnly) {
  if (!validUnknownOnly) return emails;
  return emails.filter((email) => {
    const bucket = emailExportBucket(validationMap.get(email));
    return bucket === "valid" || bucket === "unknown";
  });
}

function filterMergedForExport(merged, validUnknownOnly) {
  if (!merged || !validUnknownOnly) return merged;
  const validIdx = (merged.headers || []).findIndex(
    (h) => String(h || "").trim().toLowerCase() === "valid"
  );
  if (validIdx === -1) return merged;
  const rows = (merged.rows || []).filter((row) => {
    const bucket = emailExportBucket(row?.[validIdx]);
    return bucket === "valid" || bucket === "unknown";
  });
  return { headers: merged.headers, rows };
}

function filterExtractedDataForExport(extractedData, validationMap, validUnknownOnly) {
  if (!validUnknownOnly || !extractedData) return extractedData;
  const { headers, rows, source } = extractedData;

  if (source === "plain-text" || source === "dom-scrape" || source === "pasted-input") {
    const filteredRows = (rows || []).filter((row) => {
      const email = extractEmailFromCell(row?.[0]);
      if (!email) return false;
      const bucket = emailExportBucket(validationMap.get(email));
      return bucket === "valid" || bucket === "unknown";
    });
    return { ...extractedData, rows: filteredRows };
  }

  const emailColIdx = findEmailColumnIndex(headers || [], rows || []);
  if (emailColIdx === -1) return extractedData;

  const filteredRows = (rows || []).filter((row) => {
    const email = extractEmailFromCell(row?.[emailColIdx]);
    if (!email) return false;
    const bucket = emailExportBucket(validationMap.get(email));
    return bucket === "valid" || bucket === "unknown";
  });
  return { ...extractedData, rows: filteredRows };
}

function renderAccountStrip(profile, signedIn) {
  if (!accountName || !accountEmail) return;

  if (signedIn && profile) {
    accountName.textContent = profile.name || "Google account";
    accountEmail.textContent = profile.email || "Signed in";
    if (accountSignInBtn) {
      accountSignInBtn.classList.add("hidden");
    }
    if (accountAvatar) {
      if (profile.picture) {
        accountAvatar.innerHTML = "";
        const img = document.createElement("img");
        img.src = profile.picture;
        img.alt = "";
        accountAvatar.appendChild(img);
      } else {
        accountAvatar.textContent = (profile.name || profile.email || "G").charAt(0).toUpperCase();
      }
    }
  } else {
    accountName.textContent = "Google Sheets";
    accountEmail.textContent = "Not signed in";
    if (accountSignInBtn) {
      accountSignInBtn.classList.remove("hidden");
    }
    if (accountAvatar) {
      accountAvatar.textContent = "G";
    }
  }
}

async function refreshAccountStrip() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_AUTH_STATUS" });
    if (response?.success) {
      renderAccountStrip(response.profile, response.signedIn);
    }
  } catch {
    renderAccountStrip(null, false);
  }
}

function setCopyState(payload = { txt: "", csv: "", json: "" }) {
  lastExportPayload = payload;
  copyTxtBtn.disabled = !payload.txt;
  copyCsvBtn.disabled = !payload.csv;
  copyJsonBtn.disabled = !payload.json;

  const formats = [];
  if (payload.txt) formats.push("TXT");
  if (payload.csv) formats.push("CSV");
  if (payload.json) formats.push("JSON");
  copySummary.textContent = formats.length ? `${formats.join(" + ")} ready` : "No output yet";
  copyPanel.classList.toggle("hidden", formats.length === 0);
}

function clearPageResults() {
  scannedData = null;
  lastMergedOutput = null;
  scanInfo.classList.add("hidden");
  validateBtn.classList.add("hidden");
  previewPanel.classList.add("hidden");
  progressPanel.classList.add("hidden");
  copyPanel.classList.add("hidden");
  hideCreatedSheetLink();
  setCopyState();
}

function hideCreatedSheetLink() {
  if (!sheetLinkPanel) return;
  sheetLinkPanel.classList.add("hidden");
  if (createdSheetLink) {
    createdSheetLink.href = "#";
    createdSheetLink.textContent = "Open in Google Sheets";
  }
}

function showCreatedSheetLink(url, label) {
  if (!sheetLinkPanel || !createdSheetLink || !url) return;
  createdSheetLink.href = url;
  createdSheetLink.textContent = label || "Open in Google Sheets";
  sheetLinkPanel.classList.remove("hidden");
  scrollToSection(sheetLinkPanel);
}

function usePastedInput() {
  const raw = pasteInput.value.trim();
  if (!raw) {
    showStatus("Paste text first.", "error");
    return;
  }

  const columnConfig = parseColumnConfig(columnConfigInput.value);
  let parsedRows = null;

  function mapJsonObjects(items) {
    const headers =
      columnConfig.length > 0
        ? columnConfig
        : Array.from(new Set(items.flatMap((item) => Object.keys(item || {}))));
    return [
      headers,
      ...items.map((item) =>
        headers.map((header) => {
          const key = Object.keys(item || {}).find(
            (k) => normalizeHeader(k) === normalizeHeader(header)
          );
          return String(key ? item[key] : "");
        })
      ),
    ];
  }

  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json) && json.length > 0) {
      if (typeof json[0] === "object" && !Array.isArray(json[0])) {
        parsedRows = mapJsonObjects(json);
      } else if (Array.isArray(json[0])) {
        parsedRows =
          columnConfig.length > 0
            ? applyColumnMap(
                json.map((row) => row.map((cell) => String(cell ?? ""))),
                columnConfig
              )
            : json.map((row) => row.map((cell) => String(cell ?? "")));
      }
    }
  } catch {
    /* not JSON */
  }

  if (!parsedRows) {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      showStatus("Paste text first.", "error");
      return;
    }

    const rows = lines.map((line) => splitDelimitedLine(line));

    if (lines.length === 1 && columnConfig.length <= 1) {
      const inlineEmails = extractTrustworthyEmails(lines[0]);
      if (inlineEmails.length > 0) {
        const header = columnConfig[0] || "email";
        parsedRows = [[header], ...inlineEmails.map((email) => [email])];
      }
    }

    if (!parsedRows) {
      parsedRows =
        columnConfig.length > 0
          ? applyColumnMap(rows, columnConfig)
          : rows.length > 1 && rowLooksLikeHeader(rows[0])
            ? rows
            : applyColumnMap(rows, ["email"]);
    }
  }

  const headers = parsedRows[0] || [];
  const dataRows = parsedRows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim()));

  if (dataRows.length === 0) {
    showStatus("No usable rows found in pasted input.", "error");
    return;
  }

  const extractedData = {
    source: "pasted-input",
    sourceLabel: "MailMiner Paste",
    headers,
    rows: dataRows,
  };

  const emails = getUniqueEmails(extractedData);
  if (emails.length === 0) {
    showStatus("No emails found in pasted input.", "error");
    return;
  }

  scannedData = {
    ...extractedData,
    emailCount: emails.length,
    rowCount: dataRows.length,
    warning: null,
  };

  sourceLabel.textContent = scannedData.sourceLabel;
  rowCount.textContent = String(scannedData.rowCount);
  emailCount.textContent = String(scannedData.emailCount);
  updateValidateCount();
  scanInfo.classList.remove("hidden");
  warningMsg.classList.add("hidden");
  validateBtn.classList.remove("hidden");
  validateBtn.disabled = false;
  showStatus(`Loaded ${emails.length} email(s) from pasted input.`, "success");
  scrollToSection(scanInfo);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function showStatus(message, type = "info") {
  statusMsg.textContent = message;
  statusMsg.className = `toast ${type}`;
  statusMsg.classList.remove("hidden");
}

function hideStatus() {
  statusMsg.classList.add("hidden");
}

function updateValidateCount() {
  if (!scannedData) {
    validateCount.textContent = "—";
    return;
  }
  const all = getUniqueEmails(scannedData);
  validateCount.textContent = String(all.length);
}

function renderPreview(headers, rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      td.title = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  previewTable.innerHTML = "";
  previewTable.appendChild(table);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "VALIDATION_PROGRESS") {
    const { completed, total } = message;
    const pct = total > 0 ? (completed / total) * 100 : 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${completed} / ${total} validated`;
  }
  if (message.type === "VALIDATION_BATCH") {
    const rate = message.emailsPerSec || VALIDATION_EMAILS_PER_SEC;
    batchText.textContent = `Batch ${message.batchIndex} / ${message.batchCount} · ${rate}/sec`;
  }
});

function waitForScanResult(tabId) {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    let settleTimer = null;

    function finish() {
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      chrome.runtime.onMessage.removeListener(listener);
      if (results.length > 0) {
        results.sort((a, b) => (b.data?.emailCount || 0) - (a.data?.emailCount || 0));
        resolve(results[0]);
        return;
      }
      if (errors.length > 0) {
        resolve(errors[0]);
        return;
      }
      reject(new Error("Scan timed out. Try refreshing the page."));
    }

    const timeout = setTimeout(finish, 10000);

    function listener(message, _sender, sendResponse) {
      if (message.type === "VALIDATION_PROGRESS" || message.type === "VALIDATION_BATCH") return;
      if (message.success === true && message.data) {
        results.push(message);
        sendResponse();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, 400);
        return;
      }
      if (message.success === false && message.error) {
        errors.push(message);
        sendResponse();
      }
    }

    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        files: ["scripts/sheets-bootstrap.js", "scripts/content.js"],
      })
      .catch((err) => {
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        chrome.runtime.onMessage.removeListener(listener);
        reject(err);
      });
  });
}

function isGoogleSheetsUrl(url) {
  return (
    typeof url === "string" &&
    url.includes("docs.google.com") &&
    url.includes("/spreadsheets/")
  );
}

function applyColumnMapToScanData(data) {
  const columnConfig = parseColumnConfig(columnConfigInput.value.trim());
  if (!columnConfig.length || !data?.headers?.length) return data;

  const mapped = applyColumnMap([data.headers, ...data.rows], columnConfig);
  if (mapped.length < 2) return data;

  const headers = mapped[0];
  const rows = mapped
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  if (!rows.length) return data;

  const emails = getUniqueEmails({ ...data, headers, rows });
  return {
    ...data,
    headers,
    rows,
    emailCount: emails.length,
    rowCount: rows.length,
  };
}

function applyScanResult(scanResult, pageMeta = {}) {
  scannedData = applyColumnMapToScanData(scanResult.data);
  scannedData.pageUrl = pageMeta.pageUrl || scannedData.pageUrl || "";
  scannedData.pageTitle = pageMeta.pageTitle || scannedData.pageTitle || "";
  sourceLabel.textContent = scannedData.sourceLabel;
  rowCount.textContent = String(scannedData.rowCount);
  emailCount.textContent = String(scannedData.emailCount);
  updateValidateCount();
  scanInfo.classList.remove("hidden");

  if (scannedData.warning) {
    warningMsg.textContent = scannedData.warning;
    warningMsg.classList.remove("hidden");
  } else {
    warningMsg.classList.add("hidden");
  }

  scrollToSection(scanInfo);
}

function finishSuccessfulScan(scanResult, tab) {
  applyScanResult(scanResult, {
    pageUrl: tab?.url || "",
    pageTitle: tab?.title || "",
  });

  if (scanResult.data?.spreadsheetId) {
    scannedData.spreadsheetId = scanResult.data.spreadsheetId;
    scannedData.spreadsheetTitle = scanResult.data.spreadsheetTitle || "";
    scannedData.worksheetName = scanResult.data.worksheetName || "";
    scannedData.sheetId = scanResult.data.sheetId;
    scannedData.emailColIdx = scanResult.data.emailColIdx;
  }

  if (scannedData.emailCount === 0) {
    const onSheets =
      scannedData.source === "google-sheets" ||
      scannedData.source === "google-sheets-api" ||
      scannedData.source === "google-sheets-ocr" ||
      isGoogleSheetsUrl(tab?.url);
    showStatus(
      onSheets
        ? "No emails found. For image-heavy sheets, try OCR parse."
        : "No emails found on this page.",
      "error"
    );
    return false;
  }

  validateBtn.classList.remove("hidden");
  validateBtn.disabled = false;
  showStatus(
    scannedData.source === "google-sheets-ocr"
      ? `OCR found ${scannedData.emailCount} email(s). Validate when ready.`
      : scannedData.source === "google-sheets-api"
        ? `Found ${scannedData.emailCount} email(s) in this sheet. Enable “Update current sheet” to write Valid here, or use New spreadsheet.`
        : `Found ${scannedData.emailCount} email(s). Will validate all of them.`,
    "success"
  );
  return true;
}

scanBtn.addEventListener("click", async () => {
  hideStatus();
  clearPageResults();
  validateBtn.disabled = true;
  scanBtn.disabled = true;
  if (ocrBtn) ocrBtn.disabled = true;
  scanBtn.textContent = "Scanning…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showStatus("No active tab found.", "error");
      return;
    }

    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      showStatus("Cannot scan browser internal pages.", "error");
      return;
    }

    let scanResult = null;

    if (isGoogleSheetsUrl(tab.url)) {
      scanBtn.textContent = "Reading sheet…";
      showStatus("Reading the current Google Sheet…", "info");
      const apiResponse = await chrome.runtime.sendMessage({
        type: "SCAN_CURRENT_SHEET",
        pageUrl: tab.url,
      });

      if (apiResponse?.success && apiResponse.data) {
        scanResult = { success: true, data: apiResponse.data };
      } else {
        showStatus(
          `${apiResponse?.error || "Sheets API scan failed."} Trying page scan…`,
          "info"
        );
        scanBtn.textContent = "Scanning page…";
        scanResult = await waitForScanResult(tab.id);
      }
    } else {
      scanResult = await waitForScanResult(tab.id);
    }

    if (!scanResult?.success) {
      showStatus(scanResult?.error || "Scan failed.", "error");
      return;
    }

    finishSuccessfulScan(scanResult, tab);
  } catch (err) {
    showStatus(`Scan failed: ${err.message}`, "error");
  } finally {
    scanBtn.disabled = false;
    if (ocrBtn) ocrBtn.disabled = false;
    scanBtn.textContent = "Scan current page";
  }
});

ocrBtn?.addEventListener("click", async () => {
  hideStatus();
  clearPageResults();
  validateBtn.disabled = true;
  scanBtn.disabled = true;
  ocrBtn.disabled = true;
  ocrBtn.textContent = "OCR parsing…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showStatus("No active tab found.", "error");
      return;
    }

    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      showStatus("Cannot OCR browser internal pages.", "error");
      return;
    }

    const scanResult = await runOcrScan(tab.id, {
      onStatus: (message) => {
        ocrBtn.textContent = message;
        showStatus(message, "info");
      },
    });

    if (!scanResult?.success) {
      showStatus(scanResult?.error || "OCR parse failed.", "error");
      return;
    }

    if (isGoogleSheetsUrl(tab.url)) {
      try {
        const meta = await chrome.runtime.sendMessage({
          type: "SCAN_CURRENT_SHEET",
          pageUrl: tab.url,
        });
        if (meta?.success && meta.data?.spreadsheetId) {
          scanResult.data.spreadsheetId = meta.data.spreadsheetId;
          scanResult.data.spreadsheetTitle = meta.data.spreadsheetTitle;
          scanResult.data.worksheetName = meta.data.worksheetName;
          scanResult.data.sheetId = meta.data.sheetId;
        }
      } catch {
        /* OCR results remain usable without write-back metadata */
      }
    }

    finishSuccessfulScan(scanResult, tab);
  } catch (err) {
    showStatus(err.message || "OCR parse failed.", "error");
  } finally {
    scanBtn.disabled = false;
    ocrBtn.disabled = false;
    ocrBtn.textContent = "OCR parse (images)";
  }
});

validateBtn.addEventListener("click", async () => {
  if (!scannedData) return;

  const settings = getSettings();
  const writeBackCurrent = canWriteValidColumnToCurrentSheet();
  if (
    !settings.exportCsv &&
    !settings.exportJson &&
    !settings.deliveryNewSpreadsheet &&
    !settings.deliveryNewBlankSheet &&
    !writeBackCurrent
  ) {
    showStatus(
      "Select CSV/JSON export, New spreadsheet, New blank sheet, or Update current sheet.",
      "error"
    );
    return;
  }
  if (!ensureDeliverySelection()) {
    return;
  }
  if (settings.deliveryUpdateCurrentSheet && !scannedData?.spreadsheetId) {
    showStatus(
      "Update current sheet only works after scanning a Google Sheet. Scan first, or turn that option off.",
      "error"
    );
    return;
  }
  if (settings.deliveryNewBlankSheet && !scannedData.spreadsheetId) {
    showStatus("New blank sheet requires scanning a Google Sheet first.", "error");
    return;
  }

  hideStatus();
  validateBtn.disabled = true;
  scanBtn.disabled = true;
  if (ocrBtn) ocrBtn.disabled = true;
  progressPanel.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressText.textContent = "0 / 0 validated";
  batchText.textContent = "";

  const extractedData = {
    source: scannedData.source,
    headers: scannedData.headers,
    rows: scannedData.rows,
  };

  const allEmails = getUniqueEmails(extractedData);
  const emails = allEmails;

  if (emails.length === 0) {
    showStatus("No emails to validate.", "error");
    validateBtn.disabled = false;
    scanBtn.disabled = false;
    if (ocrBtn) ocrBtn.disabled = false;
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "VALIDATE_EMAILS",
      emails,
      options: {
        batchSize: VALIDATION_BATCH_SIZE,
        emailsPerSec: VALIDATION_EMAILS_PER_SEC,
      },
    });

    if (!response?.success) {
      showStatus(response?.error || "Validation failed.", "error");
      return;
    }

    const validationMap = new Map(Object.entries(response.results));
    const merged = buildMergedOutput(extractedData, validationMap);
    lastMergedOutput = merged;
    if (resultFilter) {
      resultFilter.value = "all";
    }
    renderMergedPreview();
    previewPanel.classList.remove("hidden");
    scrollToSection(previewPanel);

    const exportEmails = filterEmailsForExport(
      emails,
      validationMap,
      settings.exportValidUnknownOnly
    );
    const exportExtracted = filterExtractedDataForExport(
      extractedData,
      validationMap,
      settings.exportValidUnknownOnly
    );
    const exportMerged = filterMergedForExport(merged, settings.exportValidUnknownOnly);

    if (
      (settings.exportCsv ||
        settings.exportJson ||
        settings.deliveryCopy ||
        settings.deliveryDownload ||
        settings.deliveryNewSpreadsheet ||
        settings.deliveryNewBlankSheet) &&
      exportEmails.length === 0
    ) {
      showStatus(
        settings.exportValidUnknownOnly
          ? "No Valid or Unknown emails to export (all were Invalid)."
          : "No emails to export.",
        "error"
      );
      // Still allow Valid-column write-back below when possible
      if (!writeBackCurrent) {
        return;
      }
    }

    const slug = timestampSlug();
    const exported = [];
    const copied = [];
    const payload = { txt: "", csv: "", json: "" };

    if (exportEmails.length > 0) {
      const txt = buildOutputText(exportExtracted, validationMap);
      payload.txt = txt;

      if (settings.exportCsv) {
        const csv = buildOutputCsv(exportExtracted, validationMap);
        payload.csv = csv;
        if (settings.deliveryDownload) {
          downloadFile(csv, `validated-emails-${slug}.csv`, "text/csv;charset=utf-8;");
          exported.push("CSV");
        }
      }

      if (settings.exportJson) {
        const json = buildOutputJson(exportExtracted, validationMap, {
          totalEmailsFound: allEmails.length,
          emailsValidated: emails.length,
          emailsExported: exportEmails.length,
          exportFilter: settings.exportValidUnknownOnly ? "valid+unknown" : "all",
          batchSize: VALIDATION_BATCH_SIZE,
          emailsPerSec: VALIDATION_EMAILS_PER_SEC,
        });
        payload.json = json;
        if (settings.deliveryDownload) {
          downloadFile(json, `validated-emails-${slug}.json`, "application/json;charset=utf-8;");
          exported.push("JSON");
        }
      }

      setCopyState(payload);

      if (settings.deliveryCopy && payload.txt) {
        await copyText(payload.txt);
        copied.push("TXT");
      }
    } else {
      setCopyState(payload);
    }

    // Write Valid column onto the live Google Sheet (ignores column-map layout).
    let writeBackOk = false;
    let writeBackDetail = "";
    if (writeBackCurrent) {
      try {
        const writeResponse = await chrome.runtime.sendMessage({
          type: "WRITE_VALID_COLUMN",
          spreadsheetId: scannedData.spreadsheetId,
          worksheetName: scannedData.worksheetName,
          sheetId: scannedData.sheetId,
          validationMap: Object.fromEntries(validationMap),
        });
        if (!writeResponse?.success) {
          writeBackDetail =
            writeResponse?.error ||
            "Could not update this sheet. You may not have Editor access.";
        } else {
          writeBackOk = true;
          writeBackDetail = `updated current sheet (${writeResponse.updatedRows} rows${
            writeResponse.invalidCount
              ? `, ${writeResponse.invalidCount} Invalid`
              : ""
          })`;
          if (writeResponse.spreadsheetUrl) {
            showCreatedSheetLink(
              writeResponse.spreadsheetUrl,
              "Open updated spreadsheet"
            );
          }
        }
      } catch (writeErr) {
        writeBackDetail =
          writeErr.message ||
          "Could not update this sheet. You may not have Editor access.";
      }
    } else if (scannedData?.spreadsheetId && !settings.deliveryUpdateCurrentSheet) {
      // Tip so users know why the sheet was not changed.
      writeBackDetail = "";
    }

    let newSpreadsheetOk = false;
    let newSpreadsheetDetail = "";
    let createdSpreadsheetUrl = "";
    if (settings.deliveryNewSpreadsheet && exportEmails.length > 0) {
      try {
        const table = exportMerged || { headers: [], rows: [] };
        const createResponse = await chrome.runtime.sendMessage({
          type: "EXPORT_NEW_SPREADSHEET",
          headers: table.headers,
          rows: table.rows,
          title: "MailMiner Results",
        });
        if (!createResponse?.success) {
          newSpreadsheetDetail = createResponse?.error || "Could not create spreadsheet.";
        } else {
          newSpreadsheetOk = true;
          createdSpreadsheetUrl =
            createResponse.spreadsheetUrl ||
            (createResponse.spreadsheetId
              ? `https://docs.google.com/spreadsheets/d/${createResponse.spreadsheetId}`
              : "");
          newSpreadsheetDetail = `created spreadsheet (${createResponse.updatedRows} rows)`;
        }
      } catch (err) {
        newSpreadsheetDetail = err.message || "Could not create spreadsheet.";
      }
    }

    let blankSheetOk = false;
    let blankSheetDetail = "";
    let blankSheetUrl = "";
    if (settings.deliveryNewBlankSheet && exportEmails.length > 0) {
      try {
        const table = exportMerged || { headers: [], rows: [] };
        const blankResponse = await chrome.runtime.sendMessage({
          type: "EXPORT_NEW_BLANK_SHEET",
          spreadsheetId: scannedData.spreadsheetId,
          headers: table.headers,
          rows: table.rows,
          sheetTitle: `MailMiner Valid ${slug}`,
        });
        if (!blankResponse?.success) {
          blankSheetDetail = blankResponse?.error || "Could not create blank sheet.";
        } else {
          blankSheetOk = true;
          blankSheetUrl =
            blankResponse.spreadsheetUrl ||
            (blankResponse.spreadsheetId
              ? `https://docs.google.com/spreadsheets/d/${blankResponse.spreadsheetId}`
              : "");
          blankSheetDetail = `created sheet “${blankResponse.worksheetName}” (${blankResponse.updatedRows} rows)`;
        }
      } catch (err) {
        blankSheetDetail = err.message || "Could not create blank sheet.";
      }
    }

    if (createdSpreadsheetUrl) {
      showCreatedSheetLink(createdSpreadsheetUrl, "Open created spreadsheet");
    } else if (blankSheetUrl) {
      showCreatedSheetLink(blankSheetUrl, "Open sheet with new tab");
    } else {
      hideCreatedSheetLink();
    }

    const actions = [];
    if (exported.length) actions.push(`downloaded ${exported.join(" & ")}`);
    if (copied.length) actions.push(`copied ${copied.join(" & ")}`);
    if (writeBackOk) actions.push(writeBackDetail);
    if (newSpreadsheetOk) actions.push(newSpreadsheetDetail);
    if (blankSheetOk) actions.push(blankSheetDetail);
    if (settings.exportValidUnknownOnly && exportEmails.length > 0) {
      actions.push(`exported ${exportEmails.length} Valid/Unknown`);
    }

    const failures = [];
    if (writeBackCurrent && !writeBackOk) {
      failures.push(`Update current sheet: ${writeBackDetail}`);
    }    if (settings.deliveryNewSpreadsheet && exportEmails.length > 0 && !newSpreadsheetOk) {
      failures.push(`New spreadsheet: ${newSpreadsheetDetail}`);
    }
    if (settings.deliveryNewBlankSheet && exportEmails.length > 0 && !blankSheetOk) {
      failures.push(`Blank sheet: ${blankSheetDetail}`);
    }

    if (failures.length) {
      const base = actions.length
        ? `Validated ${emails.length} email(s). ${actions.join(" · ")}.`
        : `Validated ${emails.length} email(s).`;
      showStatus(`${base} ${failures.join(" ")}`, "error");
    } else {
      let msg = `Validated ${emails.length} email(s)${actions.length ? `. ${actions.join(" · ")}.` : "."}`;
      if (
        scannedData?.spreadsheetId &&
        !settings.deliveryUpdateCurrentSheet &&
        !settings.deliveryNewSpreadsheet &&
        !settings.deliveryNewBlankSheet
      ) {
        msg += " Tip: enable “Update current sheet” to write Valid into this Google Sheet.";
      }
      showStatus(msg, "success");
    }
  } catch (err) {
    showStatus(`Validation failed: ${err.message}`, "error");
  } finally {
    validateBtn.disabled = false;
    scanBtn.disabled = false;
    if (ocrBtn) ocrBtn.disabled = false;
  }
});

usePasteBtn.addEventListener("click", () => {
  hideStatus();
  clearPageResults();
  usePastedInput();
});

clearPasteBtn.addEventListener("click", () => {
  pasteInput.value = "";
  hideStatus();
  clearPageResults();
  showStatus("Pasted input cleared.", "info");
});

resultFilter?.addEventListener("change", () => {
  renderMergedPreview();
});

copyCsvBtn.addEventListener("click", async () => {
  if (!lastExportPayload.csv) return;
  try {
    await copyText(lastExportPayload.csv);
    showStatus("CSV copied to clipboard.", "success");
  } catch (err) {
    showStatus(`Copy failed: ${err.message}`, "error");
  }
});

copyJsonBtn.addEventListener("click", async () => {
  if (!lastExportPayload.json) return;
  try {
    await copyText(lastExportPayload.json);
    showStatus("JSON copied to clipboard.", "success");
  } catch (err) {
    showStatus(`Copy failed: ${err.message}`, "error");
  }
});

copyTxtBtn.addEventListener("click", async () => {
  if (!lastExportPayload.txt) return;
  try {
    await copyText(lastExportPayload.txt);
    showStatus("TXT copied to clipboard.", "success");
  } catch (err) {
    showStatus(`Copy failed: ${err.message}`, "error");
  }
});

themeToggle?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  saveSettings();
});

openSettingsBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

accountSignInBtn?.addEventListener("click", async () => {
  hideStatus();
  accountSignInBtn.disabled = true;
  accountSignInBtn.textContent = "…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_SIGN_IN" });
    if (!response?.success) {
      showStatus(response?.error || "Sign-in failed.", "error");
      return;
    }
    renderAccountStrip(response.profile, true);
    showStatus(`Signed in as ${response.profile?.email || "Google account"}.`, "success");
  } catch (err) {
    showStatus(err.message || "Sign-in failed.", "error");
  } finally {
    accountSignInBtn.disabled = false;
    accountSignInBtn.textContent = "Sign in";
  }
});

loadSettings();
refreshAccountStrip();

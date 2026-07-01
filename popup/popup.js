import {
  buildOutputCsv,
  buildOutputText,
  buildOutputJson,
  buildMergedOutput,
  extractEmailsFromText,
  getUniqueEmails,
  getPreviewTable,
  limitEmailList,
} from "../scripts/csv.js";
import { runOcrScan } from "../scripts/ocr-scan.js";

const STORAGE_KEY = "emailValidatorSettings";

const scanBtn = document.getElementById("scanBtn");
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
const copyPanel = document.getElementById("copyPanel");
const copySummary = document.getElementById("copySummary");
const copyTxtBtn = document.getElementById("copyTxtBtn");
const copyCsvBtn = document.getElementById("copyCsvBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const pasteInput = document.getElementById("pasteInput");
const usePasteBtn = document.getElementById("usePasteBtn");
const clearPasteBtn = document.getElementById("clearPasteBtn");

let scannedData = null;
let lastExportPayload = { txt: "", csv: "", json: "" };

function getSettings() {
  return {
    exportCsv: exportCsvCheckbox.checked,
    exportJson: exportJsonCheckbox.checked,
    deliveryDownload: deliveryDownloadCheckbox.checked,
    deliveryCopy: deliveryCopyCheckbox.checked,
  };
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const s = stored[STORAGE_KEY];
    if (!s) return;
    if (typeof s.exportCsv === "boolean") exportCsvCheckbox.checked = s.exportCsv;
    if (typeof s.exportJson === "boolean") exportJsonCheckbox.checked = s.exportJson;
    if (typeof s.deliveryDownload === "boolean") {
      deliveryDownloadCheckbox.checked = s.deliveryDownload;
    }
    if (typeof s.deliveryCopy === "boolean") {
      deliveryCopyCheckbox.checked = s.deliveryCopy;
    }
  } catch {
    /* ignore */
  }
}

function saveSettings() {
  chrome.storage.local.set({ [STORAGE_KEY]: getSettings() }).catch(() => {});
}

for (const el of [
  exportCsvCheckbox,
  exportJsonCheckbox,
  deliveryDownloadCheckbox,
  deliveryCopyCheckbox,
]) {
  el.addEventListener("change", () => {
    saveSettings();
    updateValidateCount();
  });
}

function ensureDeliverySelection() {
  if (deliveryDownloadCheckbox.checked || deliveryCopyCheckbox.checked) {
    return true;
  }
  showStatus("Select Download or Copy before validating.", "error");
  return false;
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
  scanInfo.classList.add("hidden");
  validateBtn.classList.add("hidden");
  previewPanel.classList.add("hidden");
  progressPanel.classList.add("hidden");
  copyPanel.classList.add("hidden");
  setCopyState();
}

function usePastedInput() {
  const raw = pasteInput.value.trim();
  if (!raw) {
    showStatus("Paste text first.", "error");
    return;
  }

  const emails = extractEmailsFromText(raw);
  if (emails.length === 0) {
    showStatus("No emails found in pasted input.", "error");
    return;
  }

  scannedData = {
    source: "pasted-input",
    sourceLabel: "Pasted Input",
    headers: ["email"],
    rows: emails.map((email) => [email]),
    emailCount: emails.length,
    rowCount: emails.length,
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
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function showStatus(message, type = "info") {
  statusMsg.textContent = message;
  statusMsg.className = `status ${type}`;
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
    batchText.textContent = `Batch ${message.batchIndex} / ${message.batchCount}`;
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

function applyScanResult(scanResult) {
  scannedData = scanResult.data;
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
}

scanBtn.addEventListener("click", async () => {
  hideStatus();
  clearPageResults();
  validateBtn.disabled = true;
  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="btn-icon" aria-hidden="true">&#8987;</span> Scanning & scrolling...';

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

    let scanResult = await waitForScanResult(tab.id);

    const weakSource = ["plain-text", "dom-scrape"].includes(scanResult?.data?.source);
    const needsOcr =
      isGoogleSheetsUrl(tab.url) &&
      (!scanResult?.success || (scanResult.data?.emailCount ?? 0) === 0 || weakSource);

    if (needsOcr) {
      showStatus("DOM scan found no emails. Trying screenshot OCR…", "info");
      scanBtn.innerHTML =
        '<span class="btn-icon" aria-hidden="true">&#8987;</span> Capturing sheet…';
      try {
        scanResult = await runOcrScan(tab.id, {
          onStatus: (message) => {
            scanBtn.innerHTML = `<span class="btn-icon" aria-hidden="true">&#8987;</span> ${message}`;
            showStatus(message, "info");
          },
        });
      } catch (ocrErr) {
        showStatus(ocrErr.message || "OCR scan failed.", "error");
        return;
      }
    }

    if (!scanResult?.success) {
      showStatus(scanResult?.error || "Scan failed.", "error");
      return;
    }

    applyScanResult(scanResult);

    if (scannedData.emailCount === 0) {
      showStatus("No emails found on this page.", "error");
      return;
    }

    validateBtn.classList.remove("hidden");
    validateBtn.disabled = false;
    showStatus(
      `Found ${scannedData.emailCount} email(s). Will validate all of them.`,
      "success"
    );
  } catch (err) {
    showStatus(`Scan failed: ${err.message}`, "error");
  } finally {
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<span class="btn-icon" aria-hidden="true">&#128269;</span> Scan Current Page (Auto Scroll)';
  }
});

validateBtn.addEventListener("click", async () => {
  if (!scannedData) return;

  const settings = getSettings();
  if (!settings.exportCsv && !settings.exportJson) {
    showStatus("Select at least one export format (CSV or JSON).", "error");
    return;
  }
  if (!ensureDeliverySelection()) {
    return;
  }

  hideStatus();
  validateBtn.disabled = true;
  scanBtn.disabled = true;
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
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "VALIDATE_EMAILS",
      emails,
      options: { batchSize: 0, concurrency: 1000 },
    });

    if (!response?.success) {
      showStatus(response?.error || "Validation failed.", "error");
      return;
    }

    const validationMap = new Map(Object.entries(response.results));
    const merged = buildMergedOutput(extractedData, validationMap);
    const preview = getPreviewTable(merged.headers, merged.rows, 5);
    renderPreview(preview.headers, preview.rows);
    previewPanel.classList.remove("hidden");

    const slug = timestampSlug();
    const exported = [];
    const copied = [];
    const payload = { txt: "", csv: "", json: "" };

    const txt = buildOutputText(extractedData, validationMap);
    payload.txt = txt;

    if (settings.exportCsv) {
      const csv = buildOutputCsv(extractedData, validationMap);
      payload.csv = csv;
      if (settings.deliveryDownload) {
        downloadFile(csv, `validated-emails-${slug}.csv`, "text/csv;charset=utf-8;");
        exported.push("CSV");
      }
    }

    if (settings.exportJson) {
      const json = buildOutputJson(extractedData, validationMap, {
        totalEmailsFound: allEmails.length,
        emailsValidated: emails.length,
        batchSize: 0,
        concurrency: 1000,
      });
      payload.json = json;
      if (settings.deliveryDownload) {
        downloadFile(json, `validated-emails-${slug}.json`, "application/json;charset=utf-8;");
        exported.push("JSON");
      }
    }

    setCopyState(payload);

    if (settings.deliveryCopy) {
      if (payload.txt) {
        await copyText(payload.txt);
        copied.push("TXT");
      }
    }

    const actions = [];
    if (exported.length) actions.push(`downloaded ${exported.join(" & ")}`);
    if (copied.length) actions.push(`copied ${copied.join(" & ")}`);
    if (!actions.length) actions.push("prepared copy output");
    showStatus(`Validated ${emails.length} email(s). ${actions.join(" and ")}.`, "success");
  } catch (err) {
    showStatus(`Validation failed: ${err.message}`, "error");
  } finally {
    validateBtn.disabled = false;
    scanBtn.disabled = false;
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

loadSettings();

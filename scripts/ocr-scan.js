import { parseOcrTextToTable } from "./ocr-parse.js";
import {
  getUniqueEmails,
  extractTrustworthyEmails,
  extractEmailsFromText,
} from "./csv.js";

const ROW_NUMBER_TRIM_PX = 40;

function callOcrApi(dataUrl) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "OCR_REQUEST", dataUrl }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || "OCR request failed."));
        return;
      }
      resolve(response.text || "");
    });
  });
}

function parseOcrResult(text) {
  const parsed = parseOcrTextToTable(text);
  if (parsed?.rows?.length) return parsed;

  const rawEmails = [
    ...new Set([
      ...extractTrustworthyEmails(text),
      ...extractEmailsFromText(text),
    ]),
  ];
  if (rawEmails.length > 0) {
    return {
      source: "google-sheets-ocr",
      headers: ["email"],
      rows: rawEmails.map((email) => [email]),
      warning:
        "OCR could not build full columns. Emails were extracted from the image. Scroll for more rows and run OCR again if needed.",
    };
  }

  return null;
}

async function getGridBounds(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ["scripts/grid-bounds.js"],
  });

  const [result] = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => window.__gridBounds ?? null,
  });

  return result?.result ?? null;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load screenshot image."));
    img.src = dataUrl;
  });
}

async function cropScreenshot(dataUrl, bounds) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const dpr = bounds?.dpr || 1;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const trimLeft = Math.min(ROW_NUMBER_TRIM_PX * dpr, bounds.width * dpr * 0.15);
    sx = Math.max(0, Math.floor(bounds.x * dpr + trimLeft));
    sy = Math.max(0, Math.floor(bounds.y * dpr));
    sw = Math.min(img.width - sx, Math.floor(bounds.width * dpr - trimLeft));
    sh = Math.min(img.height - sy, Math.floor(bounds.height * dpr));
  }

  if (sw < 10 || sh < 10) {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  } else {
    canvas.width = sw;
    canvas.height = sh;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return canvas.toDataURL("image/png");
}

export async function runOcrScan(tabId, callbacks = {}) {
  const { onStatus } = callbacks;
  const tab = await chrome.tabs.get(tabId);

  onStatus?.("Getting grid bounds…");
  const bounds = await getGridBounds(tabId);

  onStatus?.("Capturing screenshot…");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  onStatus?.("Preparing image…");
  const croppedDataUrl = await cropScreenshot(dataUrl, bounds);

  onStatus?.("Running OCR…");
  const text = await callOcrApi(croppedDataUrl);

  const parsed = parseOcrResult(text);
  if (!parsed || !parsed.rows?.length) {
    throw new Error(
      "OCR found no emails in the visible sheet area. Scroll so rows are visible and try again."
    );
  }

  const emails = getUniqueEmails(parsed);

  return {
    success: true,
    data: {
      source: parsed.source,
      sourceLabel: "MailMiner OCR",
      headers: parsed.headers,
      rows: parsed.rows,
      emailCount: emails.length,
      rowCount: parsed.rows.length,
      warning: parsed.warning,
    },
  };
}

import { validateEmails } from "./validator.js";
import { OCR_API_URL } from "./config.js";
import {
  signIn,
  signOut,
  getAuthStatus,
} from "./auth-service.js";
import {
  scanCurrentSpreadsheet,
  writeValidationColumn,
  createSpreadsheetWithTable,
  createBlankSheetWithValues,
} from "./google-sheets-service.js";

function ok(data = {}) {
  return { success: true, ...data };
}

function fail(error) {
  return {
    success: false,
    error: error?.message || String(error) || "Request failed.",
  };
}

/** Normalize OCR worker response into plain text for the parser. */
function normalizeOcrPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return normalizeOcrPayload(JSON.parse(trimmed));
      } catch {
        return payload;
      }
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return item.text || item.line || item.content || JSON.stringify(item);
        }
        return String(item ?? "");
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof payload === "object") {
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.result === "string") return payload.result;
    if (typeof payload.data === "string") return payload.data;
    if (typeof payload.ocr_text === "string") return payload.ocr_text;
    if (typeof payload.content === "string") return payload.content;
    if (payload.data != null) return normalizeOcrPayload(payload.data);
    if (Array.isArray(payload.lines)) return normalizeOcrPayload(payload.lines);
    if (Array.isArray(payload.results)) return normalizeOcrPayload(payload.results);
  }
  return String(payload);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OCR_REQUEST") {
    const dataUrl = message.dataUrl;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const formData = new FormData();
        // New OCR worker expects multipart field name "file" (Postman-compatible).
        formData.append("file", blob, "capture.png");
        return fetch(OCR_API_URL, {
          method: "POST",
          body: formData,
          referrerPolicy: "no-referrer",
        });
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`OCR worker failed: HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await response.json();
          return normalizeOcrPayload(json);
        }
        const text = await response.text();
        return normalizeOcrPayload(text);
      })
      .then((text) => {
        sendResponse({ success: true, text: text || "" });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "VALIDATE_EMAILS") {
    const options = message.options || {};
    validateEmails(
      message.emails,
      (completed, total) => {
        chrome.runtime.sendMessage({
          type: "VALIDATION_PROGRESS",
          completed,
          total,
        }).catch(() => {});
      },
      {
        batchSize: options.batchSize,
        emailsPerSec: options.emailsPerSec,
        onBatch: (batchIndex, batchCount, batchLength, meta) => {
          chrome.runtime.sendMessage({
            type: "VALIDATION_BATCH",
            batchIndex,
            batchCount,
            batchLength,
            emailsPerSec: meta?.emailsPerSec,
          }).catch(() => {});
        },
      }
    )
      .then((results) => {
        const map = Object.fromEntries(results);
        sendResponse({ success: true, results: map });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === "GOOGLE_SIGN_IN") {
    signIn()
      .then((profile) => sendResponse(ok({ profile })))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "GOOGLE_SIGN_OUT") {
    signOut()
      .then(() => sendResponse(ok()))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "GOOGLE_AUTH_STATUS") {
    getAuthStatus()
      .then((status) => sendResponse(ok(status)))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "SCAN_CURRENT_SHEET") {
    (async () => {
      const auth = await getAuthStatus();
      if (!auth.signedIn) {
        throw new Error("Sign in with Google to read this spreadsheet via the Sheets API.");
      }
      if (!message.pageUrl) {
        throw new Error("Missing page URL.");
      }
      return scanCurrentSpreadsheet(message.pageUrl);
    })()
      .then((data) => sendResponse(ok({ data })))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "WRITE_VALID_COLUMN") {
    (async () => {
      const auth = await getAuthStatus();
      if (!auth.signedIn) {
        throw new Error("Sign in with Google before writing the Valid column.");
      }
      return writeValidationColumn({
        spreadsheetId: message.spreadsheetId,
        worksheetName: message.worksheetName,
        sheetId: message.sheetId,
        validationMap: message.validationMap || {},
      });
    })()
      .then((data) => sendResponse(ok(data)))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "EXPORT_NEW_SPREADSHEET") {
    (async () => {
      const auth = await getAuthStatus();
      if (!auth.signedIn) {
        throw new Error("Sign in with Google to create a spreadsheet.");
      }
      const headers = Array.isArray(message.headers) ? message.headers : [];
      const rows = Array.isArray(message.rows) ? message.rows : [];
      if (!headers.length || !rows.length) {
        throw new Error("No rows to export.");
      }
      return createSpreadsheetWithTable(headers, rows, message.title);
    })()
      .then((data) => sendResponse(ok(data)))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }

  if (message.type === "EXPORT_NEW_BLANK_SHEET") {
    (async () => {
      const auth = await getAuthStatus();
      if (!auth.signedIn) {
        throw new Error("Sign in with Google to create a blank sheet.");
      }
      if (!message.spreadsheetId) {
        throw new Error("Scan the current Google Sheet first, then create a blank sheet.");
      }
      const headers = Array.isArray(message.headers) ? message.headers : [];
      const rows = Array.isArray(message.rows) ? message.rows : [];
      if (!headers.length || !rows.length) {
        throw new Error("No rows to export.");
      }
      const title =
        message.sheetTitle ||
        `MailMiner ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      return createBlankSheetWithValues(message.spreadsheetId, title, [headers, ...rows]);
    })()
      .then((data) => sendResponse(ok(data)))
      .catch((err) => sendResponse(fail(err)));
    return true;
  }
});

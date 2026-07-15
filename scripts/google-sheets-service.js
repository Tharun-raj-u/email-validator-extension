/**
 * Google Sheets API helpers for MailMiner OCR / validation export.
 */

import { withValidToken } from "./auth-service.js";
import {
  findEmailColumnIndex,
  getUniqueEmails,
  extractEmailCandidateFromCell,
  resolveValidationStatusForEmail,
  isTrustworthyEmail,
  extractTrustworthyEmails,
} from "./csv.js";

export const DEFAULT_SPREADSHEET_TITLE = "MailMiner Results";
export const DEFAULT_WORKSHEET_NAME = "Results";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * @param {string} urlOrId
 * @returns {string}
 */
export function parseSpreadsheetId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  if (!raw) {
    throw new Error("Enter a Spreadsheet URL or ID.");
  }

  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;

  throw new Error("Could not parse Spreadsheet ID. Paste a docs.google.com URL or the ID.");
}

async function readApiError(response) {
  try {
    const json = await response.json();
    const message = json?.error?.message;
    const status = json?.error?.status;
    const reasons = (json?.error?.errors || [])
      .map((e) => e?.reason)
      .filter(Boolean);
    return {
      message: message || null,
      status: status || null,
      reasons,
      raw: json?.error || null,
    };
  } catch {
    return { message: null, status: null, reasons: [], raw: null };
  }
}

/**
 * @param {Response} response
 */
async function throwFriendlyHttpError(response) {
  const api = await readApiError(response);
  const apiMessage = api.message || "";
  const lower = apiMessage.toLowerCase();

  if (response.status === 404) {
    throw new Error("Spreadsheet not found. Check the URL or spreadsheet ID.");
  }

  if (response.status === 401) {
    throw new Error("Session expired. Please sign in again.");
  }

  if (response.status === 403) {
    if (
      lower.includes("has not been used") ||
      lower.includes("is disabled") ||
      lower.includes("access not configured") ||
      api.reasons.includes("accessNotConfigured")
    ) {
      throw new Error(
        "Google Sheets API is not enabled for this Cloud project. Enable Sheets API (and Drive API) in Google Cloud Console, then try again."
      );
    }
    if (
      lower.includes("insufficient") ||
      lower.includes("access_token_scope") ||
      api.reasons.includes("insufficientPermissions") ||
      (api.status === "PERMISSION_DENIED" && lower.includes("scope"))
    ) {
      const err = new Error(
        "Missing Google permission. Sign out, sign in again, and approve Sheets access."
      );
      err.code = "INSUFFICIENT_SCOPES";
      throw err;
    }
    if (
      lower.includes("permission") ||
      lower.includes("does not have access") ||
      lower.includes("forbidden") ||
      api.reasons.includes("forbidden")
    ) {
      throw new Error(
        "You don't have Editor access to this spreadsheet. Ask the owner to share it with edit rights, or turn off “Update current sheet” and use New spreadsheet instead."
      );
    }
    if (apiMessage) {
      throw new Error(apiMessage);
    }
    throw new Error(
      "You don't have permission to edit this spreadsheet. Ask the owner for Editor access, or use New spreadsheet / New blank sheet instead."
    );
  }

  if (apiMessage) {
    throw new Error(apiMessage);
  }
  if (response.status >= 500) {
    throw new Error("Google Sheets request failed. Please try again later.");
  }
  throw new Error("Google Sheets request failed.");
}

/**
 * Authenticated Sheets fetch that returns parsed JSON (or null for empty bodies).
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function sheetsFetchJson(url, init = {}) {
  return withValidToken(
    async (token) => {
      let response;
      try {
        response = await fetch(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
          },
        });
      } catch {
        throw new Error("Network error. Check your connection and try again.");
      }

      // Return 401 to withValidToken so it can clear the cache and retry once.
      if (response.status === 401) {
        return { response, data: null };
      }

      if (!response.ok) {
        await throwFriendlyHttpError(response);
      }

      if (response.status === 204) {
        return { response, data: null };
      }

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      return { response, data };
    },
    { interactive: true, retryInsufficientScopes: true }
  );
}

/**
 * @param {string} spreadsheetId
 */
export async function getSpreadsheet(spreadsheetId) {
  const data = await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`
  );
  return data;
}

/**
 * Create a new blank worksheet in an existing spreadsheet and write a table.
 * @param {string} spreadsheetId
 * @param {string} title
 * @param {Array<Array<string|number>>} values
 */
export async function createBlankSheetWithValues(spreadsheetId, title, values) {
  if (!spreadsheetId) {
    throw new Error("Open and scan a Google Sheet first to add a blank sheet.");
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("No rows to write.");
  }

  const meta = await getSpreadsheet(spreadsheetId);
  const existing = new Set(
    (meta?.sheets || []).map((s) => String(s?.properties?.title || ""))
  );

  let finalTitle = String(title || "MailMiner Export").trim() || "MailMiner Export";
  if (existing.has(finalTitle)) {
    let n = 2;
    while (existing.has(`${finalTitle} (${n})`)) n++;
    finalTitle = `${finalTitle} (${n})`;
  }

  await sheetsFetchJson(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: { title: finalTitle },
          },
        },
      ],
    }),
  });

  const quoted = `'${finalTitle.replace(/'/g, "''")}'`;
  await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quoted)}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    }
  );

  return {
    spreadsheetId,
    spreadsheetTitle: meta?.properties?.title || "",
    worksheetName: finalTitle,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    updatedRows: Math.max(0, values.length - 1),
  };
}

/**
 * Create a spreadsheet and write a full table (headers + rows).
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {string} [title]
 */
export async function createSpreadsheetWithTable(headers, rows, title = DEFAULT_SPREADSHEET_TITLE) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error("No columns to export.");
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No rows to export.");
  }

  const data = await sheetsFetchJson(SHEETS_API, {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: DEFAULT_WORKSHEET_NAME } }],
    }),
  });

  const spreadsheetId = data.spreadsheetId;
  if (!spreadsheetId) {
    throw new Error("Google Sheets request failed.");
  }

  const width = Math.max(headers.length, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  const paddedHeaders = [...headers.map((h) => String(h ?? ""))];
  while (paddedHeaders.length < width) paddedHeaders.push(`Column ${paddedHeaders.length + 1}`);
  const paddedRows = rows.map((row) => {
    const next = Array.isArray(row) ? row.map((c) => (c == null ? "" : c)) : [];
    while (next.length < width) next.push("");
    return next.slice(0, width);
  });

  const quoted = `'${DEFAULT_WORKSHEET_NAME.replace(/'/g, "''")}'`;
  await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quoted)}!A1?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [paddedHeaders, ...paddedRows] }),
    }
  );

  return {
    spreadsheetId,
    spreadsheetTitle: title,
    worksheetName: DEFAULT_WORKSHEET_NAME,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    updatedRows: paddedRows.length,
  };
}

/**
 * @param {string} url
 * @returns {{ spreadsheetId: string, gid: string | null }}
 */
export function parseGoogleSheetsUrl(url) {
  const spreadsheetId = parseSpreadsheetId(url);
  let gid = null;
  try {
    const u = new URL(url);
    gid = u.searchParams.get("gid");
    if (!gid) {
      const m = (u.hash || "").match(/gid=(\d+)/);
      if (m) gid = m[1];
    }
  } catch {
    /* ignore */
  }
  return { spreadsheetId, gid };
}

/**
 * @param {number} index zero-based column index
 */
export function columnIndexToA1(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function resolveSheetByGid(meta, gid) {
  const sheets = meta?.sheets || [];
  if (!sheets.length) {
    throw new Error("This spreadsheet has no worksheets.");
  }
  if (gid == null || gid === "") {
    return sheets[0];
  }
  const match = sheets.find((s) => String(s?.properties?.sheetId) === String(gid));
  return match || sheets[0];
}

function padRow(row, width) {
  const next = Array.isArray(row) ? row.map((c) => String(c ?? "")) : [];
  while (next.length < width) next.push("");
  return next;
}

function looksLikeHeaderRow(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  const cells = row.map((c) => String(c || "").trim()).filter(Boolean);
  if (cells.length === 0) return false;
  const emailish = cells.filter((c) => isTrustworthyEmail(c) || extractTrustworthyEmails(c).length).length;
  if (emailish / cells.length >= 0.5) return false;
  return cells.some((c) => {
    const n = c.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      n.includes("email") ||
      n.includes("mail") ||
      n.includes("name") ||
      n.includes("company") ||
      n.includes("phone") ||
      n.includes("website") ||
      n.includes("url")
    );
  });
}

/**
 * Read the open Google Sheet via the Sheets API (current spreadsheet + active gid).
 * @param {string} pageUrl
 */
export async function scanCurrentSpreadsheet(pageUrl) {
  const { spreadsheetId, gid } = parseGoogleSheetsUrl(pageUrl);
  const meta = await getSpreadsheet(spreadsheetId);
  const sheet = resolveSheetByGid(meta, gid);
  const worksheetName = sheet?.properties?.title;
  const sheetId = sheet?.properties?.sheetId;
  if (!worksheetName) {
    throw new Error("Could not resolve the active worksheet.");
  }

  const quoted = `'${String(worksheetName).replace(/'/g, "''")}'`;
  const valuesPayload = await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quoted)}?majorDimension=ROWS`
  );
  const values = Array.isArray(valuesPayload?.values) ? valuesPayload.values : [];
  if (values.length === 0) {
    throw new Error("The active worksheet is empty.");
  }

  const width = Math.max(...values.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
  const matrix = values.map((r) => padRow(r, width));

  let headers;
  let rows;
  if (looksLikeHeaderRow(matrix[0])) {
    headers = matrix[0].map((h, i) => String(h || "").trim() || `Column ${i + 1}`);
    rows = matrix.slice(1).filter((row) => row.some((c) => String(c || "").trim()));
  } else {
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    rows = matrix.filter((row) => row.some((c) => String(c || "").trim()));
  }

  if (rows.length === 0) {
    throw new Error("No data rows found in this Google Sheet.");
  }

  const emailColIdx = findEmailColumnIndex(headers, rows);
  if (emailColIdx === -1) {
    throw new Error("No email column detected in this Google Sheet.");
  }

  const emails = getUniqueEmails({
    source: "google-sheets-api",
    headers,
    rows,
  });

  return {
    source: "google-sheets-api",
    sourceLabel: "Google Sheets",
    headers,
    rows,
    emailCount: emails.length,
    rowCount: rows.length,
    warning: null,
    spreadsheetId,
    spreadsheetTitle: meta?.properties?.title || "",
    worksheetName,
    sheetId,
    gid: gid != null ? String(gid) : String(sheetId ?? ""),
    emailColIdx,
  };
}

/**
 * Write Valid / Invalid / Unknown into the live worksheet.
 * Always re-reads the sheet so column-map filtering cannot target the wrong columns.
 */
export async function writeValidationColumn(opts = {}) {
  const {
    spreadsheetId,
    worksheetName,
    sheetId: sheetIdOpt,
    validationMap,
  } = opts;

  if (!spreadsheetId || !worksheetName) {
    throw new Error("Missing spreadsheet information for writing the Valid column.");
  }

  const map =
    validationMap instanceof Map
      ? validationMap
      : new Map(Object.entries(validationMap || {}));

  if (map.size === 0) {
    throw new Error("No validation results to write.");
  }

  const meta = await getSpreadsheet(spreadsheetId);
  const sheet =
    (meta?.sheets || []).find(
      (s) => String(s?.properties?.title || "") === String(worksheetName)
    ) || null;
  const resolvedSheetId = sheetIdOpt ?? sheet?.properties?.sheetId;
  if (resolvedSheetId == null) {
    throw new Error("Could not resolve the worksheet to update.");
  }

  const quoted = `'${String(worksheetName).replace(/'/g, "''")}'`;
  const valuesPayload = await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quoted)}?majorDimension=ROWS`
  );
  const values = Array.isArray(valuesPayload?.values) ? valuesPayload.values : [];
  if (values.length === 0) {
    throw new Error("The worksheet is empty.");
  }

  const width = Math.max(...values.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
  const matrix = values.map((r) => padRow(r, width));
  const hasHeader = looksLikeHeaderRow(matrix[0]);

  let headers;
  let rows;
  if (hasHeader) {
    headers = matrix[0].map((h, i) => String(h || "").trim() || `Column ${i + 1}`);
    rows = matrix.slice(1);
  } else {
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    rows = matrix;
  }

  const emailColIdx = findEmailColumnIndex(headers, rows);
  if (emailColIdx < 0) {
    throw new Error("No email column found in the current sheet to update.");
  }

  let validColIdx = headers.findIndex(
    (h) => String(h || "").trim().toLowerCase() === "valid"
  );

  if (validColIdx === -1) {
    validColIdx = emailColIdx + 1;
    await sheetsFetchJson(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: resolvedSheetId,
                  dimension: "COLUMNS",
                  startIndex: validColIdx,
                  endIndex: validColIdx + 1,
                },
                inheritFromBefore: true,
              },
            },
          ],
        }),
      }
    );
  }

  const colLetter = columnIndexToA1(validColIdx);
  const columnValues = [];
  if (hasHeader) {
    columnValues.push(["Valid"]);
  }

  let filled = 0;
  let invalidCount = 0;
  for (const row of rows) {
    // Include truncated / incomplete emails so Invalid is written, not left blank.
    const email = extractEmailCandidateFromCell(row[emailColIdx]);
    if (!email) {
      columnValues.push([""]);
      continue;
    }
    const status = resolveValidationStatusForEmail(email, map);
    columnValues.push([status]);
    filled++;
    if (status === "Invalid") invalidCount++;
  }

  const startRow = 1;
  const endRow = columnValues.length;
  const range = `${quoted}!${colLetter}${startRow}:${colLetter}${endRow}`;

  await sheetsFetchJson(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: columnValues }),
    }
  );

  if (filled === 0) {
    throw new Error(
      "Could not match validated emails to rows in the current sheet. Check the email column and try again."
    );
  }

  return {
    spreadsheetId,
    worksheetName,
    validColIdx,
    updatedRows: filled,
    invalidCount,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

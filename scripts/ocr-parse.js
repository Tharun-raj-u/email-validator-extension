import {
  extractEmailsFromText,
  normalizeHeader,
  findEmailColumnIndex,
} from "./csv.js";

const OCR_WARNING =
  "OCR reads only visible rows. Scroll and scan again for more.";

function isValidEmailFormat(value) {
  if (!value || typeof value !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function cellHasEmail(value) {
  const str = String(value ?? "");
  if (!str) return false;
  if (isValidEmailFormat(str)) return true;
  return extractEmailsFromText(str).length > 0;
}

function cellText(value) {
  return String(value ?? "").trim();
}

/**
 * Fix OCR-mangled emails where a space was inserted before the TLD.
 * e.g. "user@domain. com" → "user@domain.com"
 */
function fixOcrEmailSpaces(line) {
  return line
    .replace(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)\.\s+([a-zA-Z]{2,})/g, "$1.$2")
    .replace(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)\s+\.([a-zA-Z]{2,})/g, "$1.$2");
}

/**
 * Detect spreadsheet column-letter header rows from OCR, e.g. "A 8 c D E F s H '"
 * All tokens are 1-2 chars (letters, digits, or quotes).
 */
function isColumnLetterLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4) return false;
  return tokens.every((t) => /^[A-Za-z0-9'"]{1,2}$/.test(t));
}

function isNoiseLine(line) {
  const t = cellText(line);
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[A-Z]{1,3}$/.test(t)) return true;
  // Lines that are only dashes, underscores, equals or similar OCR noise
  if (/^[\s\-_=~|]+$/.test(t)) return true;
  // Spreadsheet column letter rows: "A 8 c D E F s H '"
  if (isColumnLetterLine(t)) return true;
  return false;
}

/** Remove URLs, leading underscores/dashes/equals, and collapse whitespace. */
function cleanNameText(text) {
  return text
    .replace(/https?:\/\/[^\s]*/gi, "")   // strip URLs
    .replace(/\s*https?[^\s]*/gi, "")       // strip partial https artifacts
    .replace(/^[\s_=\-–—\/\\|.]+/, "")     // strip leading noise chars
    .replace(/[\s_=\-–—\/\\|.]+$/, "")     // strip trailing noise chars
    .replace(/\s+/g, " ")
    .trim();
}

function isHeaderRow(row) {
  return row.some((cell) => {
    const n = normalizeHeader(cell);
    return (
      n === "name" ||
      n === "email" ||
      n === "phone" ||
      n === "contact" ||
      n.includes("email")
    );
  });
}

function normalizeRowWidths(rows) {
  if (!rows.length) return rows;
  const maxCols = Math.max(...rows.map((r) => r.length));
  return rows.map((row) =>
    row.length < maxCols
      ? [...row, ...Array(maxCols - row.length).fill("")]
      : row
  );
}

function findEmailColumnByContent(allRows) {
  if (!allRows.length) return -1;
  const colCount = Math.max(...allRows.map((r) => r.length));
  let bestIdx = -1;
  let bestCount = 0;
  for (let col = 0; col < colCount; col++) {
    const count = allRows.filter((row) => cellHasEmail(row[col])).length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = col;
    }
  }
  return bestCount > 0 ? bestIdx : -1;
}

function splitHeadersAndRows(nonEmptyRows) {
  if (!nonEmptyRows.length) return null;

  const headerRowIdx = nonEmptyRows.findIndex(isHeaderRow);
  if (headerRowIdx >= 0) {
    return {
      headers: nonEmptyRows[headerRowIdx],
      rows: nonEmptyRows.slice(headerRowIdx + 1),
    };
  }

  for (let i = 0; i < Math.min(3, nonEmptyRows.length); i++) {
    const row = nonEmptyRows[i];
    const filled = row.filter((c) => cellText(c)).length;
    if (filled >= 1 && !row.some(cellHasEmail)) {
      return { headers: row, rows: nonEmptyRows.slice(i + 1) };
    }
  }

  const rows = normalizeRowWidths(nonEmptyRows);
  const emailCol = findEmailColumnByContent(rows);
  const colCount = rows[0].length;
  const headers = Array.from({ length: colCount }, (_, i) => {
    if (i === emailCol) return "email";
    if (i === 0) return "name";
    return "";
  });
  return { headers, rows };
}

function mergeContinuationRows(rows) {
  if (!rows.length) return rows;

  const mergedRows = [];
  for (const row of rows) {
    const currentRow = row.map((cell) => String(cell ?? ""));

    if (!mergedRows.length) {
      mergedRows.push(currentRow);
      continue;
    }

    const previousRow = mergedRows[mergedRows.length - 1];
    const currentEmails = currentRow.filter(cellHasEmail).length;
    const previousEmails = previousRow.filter(cellHasEmail).length;
    const currentFilled = currentRow.filter((cell) => cellText(cell)).length;

    if (currentEmails === 0 && previousEmails > 0 && currentFilled > 0 && currentFilled <= 2) {
      const attachIndex = previousRow.findIndex((cell) => cellHasEmail(cell));
      if (attachIndex !== -1) {
        const tail = currentRow.filter((cell) => cellText(cell)).join(" ").trim();
        if (tail) {
          const nextIndex = Math.min(previousRow.length - 1, attachIndex + 1);
          previousRow[nextIndex] = [previousRow[nextIndex], tail].filter(Boolean).join(" ").trim();
          continue;
        }
      }
    }

    if (currentEmails === 1 && previousEmails === 0 && currentFilled === 1 && mergedRows.length >= 2) {
      const attachTo = mergedRows[mergedRows.length - 2];
      const attachIndex = attachTo.findIndex((cell) => !cellText(cell));
      if (attachIndex !== -1) {
        attachTo[attachIndex] = currentRow.find((cell) => cellHasEmail(cell)) || currentRow[0];
        mergedRows.pop();
        continue;
      }
    }

    mergedRows.push(currentRow);
  }

  return mergedRows;
}

/**
 * Extract the name portion from a line — the text before any URL or email.
 */
function extractNameFromLine(line) {
  // Take everything before the first http or email-like token
  const cutAt = line.search(/https?:|[a-zA-Z0-9._%+\-]+@/);
  const candidate = cutAt > 0 ? line.slice(0, cutAt) : line;
  return cleanNameText(candidate);
}

function parseEmailAnchoredRows(lines) {
  const rows = [];
  // Track last seen name-only line so orphaned email lines can be joined.
  let pendingName = null;

  for (let i = 0; i < lines.length; i++) {
    // Fix OCR email spaces then strip leading noise chars glued to email.
    const line = fixOcrEmailSpaces(lines[i]).replace(/(?<!\w)[_\-=]\s*/g, "").trim();

    const emails = extractEmailsFromText(line);

    if (emails.length === 0) {
      // No email — might be a name+URL line; save name for next orphaned email.
      const name = extractNameFromLine(line);
      if (name) pendingName = name;
      continue;
    }

    const email = emails[0];
    const idx = line.toLowerCase().indexOf(email.toLowerCase());
    const left = idx >= 0 ? line.slice(0, idx) : "";
    const right = idx >= 0 ? line.slice(idx + email.length) : "";

    // Name: prefer inline name (before email), fall back to pending name from previous line.
    const nameDirect = cleanNameText(left);
    const name = nameDirect || pendingName || "";
    pendingName = null;

    // Job title / extra: clean right side
    const role = cleanNameText(right);
    rows.push([name, email, role]);
  }

  if (!rows.length) return null;

  // De-duplicate by email keeping the row with the most content.
  const byEmail = new Map();
  for (const row of rows) {
    const key = row[1].toLowerCase();
    const existing = byEmail.get(key);
    if (!existing || row.join(" ").length > existing.join(" ").length) {
      byEmail.set(key, row);
    }
  }

  return {
    source: "google-sheets-ocr",
    headers: ["name", "email", "job posting title"],
    rows: Array.from(byEmail.values()),
    warning: OCR_WARNING,
  };
}

export function parseLineToCells(line) {
  if (line.includes("\t")) {
    return line.split("\t").map((c) => c.trim());
  }

  const emails = extractEmailsFromText(line);
  if (emails.length === 1) {
    const email = emails[0];
    const idx = line.toLowerCase().indexOf(email.toLowerCase());
    const before = idx > 0 ? cleanNameText(line.slice(0, idx)) : "";
    const after = idx >= 0 ? cleanNameText(line.slice(idx + email.length)) : "";
    const cells = [];
    if (before) cells.push(before.replace(/^\d+\s*/, "").trim());
    cells.push(line.slice(idx, idx + email.length) || email);
    if (after) cells.push(after);
    return cells.length ? cells : [line];
  }

  if (emails.length > 1) {
    return emails.map((e) => String(e));
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 8 && !line.includes("@")) {
    const looksLikeHeader = words.some((w) => {
      const n = normalizeHeader(w);
      return (
        n === "name" ||
        n === "email" ||
        n === "phone" ||
        n === "contact" ||
        n.includes("email")
      );
    });
    if (looksLikeHeader) return words;
  }

  const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts;

  return [line];
}

export function parseOcrTextToTable(ocrText) {
  if (!ocrText || !ocrText.includes("@")) return null;

  // Pre-process: fix OCR email spaces before line-level filtering.
  const lines = fixOcrEmailSpaces(ocrText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isNoiseLine(l));

  if (lines.length === 0) return null;

  const anchored = parseEmailAnchoredRows(lines);
  if (anchored && anchored.rows.length >= 2) {
    return anchored;
  }

  const parsed = lines.map(parseLineToCells);
  const mergedRows = mergeContinuationRows(parsed);
  const nonEmptyRows = normalizeRowWidths(mergedRows)
    .filter((row) => row.some((c) => cellText(c)))
    .filter(
      (row) =>
        row.some(cellHasEmail) || row.filter((c) => cellText(c)).length >= 2
    );

  if (nonEmptyRows.length < 1) return null;

  const split = splitHeadersAndRows(nonEmptyRows);
  if (!split || split.rows.length === 0) return null;

  let headers = split.headers;
  let rows = split.rows;
  const maxCols = Math.max(headers.length, ...rows.map((r) => r.length));
  if (headers.length < maxCols) {
    headers = [...headers, ...Array(maxCols - headers.length).fill("")];
  }
  rows = rows.map((row) =>
    row.length < maxCols
      ? [...row.map((c) => String(c ?? "")), ...Array(maxCols - row.length).fill("")]
      : row.map((c) => String(c ?? ""))
  );
  headers = headers.map((h) => String(h ?? ""));

  const emailColIdx = findEmailColumnIndex(headers, rows);
  if (emailColIdx === -1) return null;

  const dataRows = rows.filter((row) => cellHasEmail(row[emailColIdx]));
  if (dataRows.length === 0) return null;

  return {
    source: "google-sheets-ocr",
    headers,
    rows: dataRows,
    warning: OCR_WARNING,
  };
}

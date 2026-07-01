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

function isNoiseLine(line) {
  const t = cellText(line);
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[A-Z]{1,3}$/.test(t)) return true;
  return false;
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

function parseEmailAnchoredRows(lines) {
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const emails = extractEmailsFromText(line);
    if (emails.length === 0) continue;

    const email = emails[0];
    const idx = line.toLowerCase().indexOf(email.toLowerCase());
    const left = idx >= 0 ? line.slice(0, idx).trim() : "";
    const right = idx >= 0 ? line.slice(idx + email.length).trim() : "";

    // Backfill name pieces from up to 3 preceding lines that don't contain emails.
    const nameParts = [];
    for (let p = Math.max(0, i - 3); p < i; p++) {
      const prev = lines[p];
      if (!prev || extractEmailsFromText(prev).length > 0) continue;
      const n = normalizeHeader(prev);
      if (!n || n.includes("email") || n.includes("phone") || n.includes("name")) continue;
      if (prev.length <= 40) nameParts.push(prev.trim());
    }

    const name = [left, ...nameParts].join(" ").replace(/\s+/g, " ").trim();
    const role = right;
    rows.push([name, email, role]);
  }

  if (!rows.length) return null;

  // De-duplicate by email while keeping the richest row.
  const byEmail = new Map();
  for (const row of rows) {
    const email = row[1].toLowerCase();
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, row);
      continue;
    }
    const existingScore = existing.join(" ").length;
    const rowScore = row.join(" ").length;
    if (rowScore > existingScore) byEmail.set(email, row);
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
    const before = idx > 0 ? line.slice(0, idx).trim() : "";
    const after = idx >= 0 ? line.slice(idx + email.length).trim() : "";
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

  const lines = ocrText
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

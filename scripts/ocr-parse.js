import {
  extractTrustworthyEmails,
  extractEmailsFromText,
  isTrustworthyEmail,
  normalizeHeader,
  findEmailColumnIndex,
} from "./csv.js";

const OCR_WARNING =
  "OCR reads only visible rows. Scroll and scan again for more.";

const STANDARD_HEADERS = ["name", "email", "phone"];

function cellText(value) {
  return String(value ?? "").trim();
}

function fixOcrEmailSpaces(line) {
  return line
    .replace(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)\.\s+([a-zA-Z]{2,})/g, "$1.$2")
    .replace(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)\s+\.([a-zA-Z]{2,})/g, "$1.$2")
    .replace(/\s+@\s+/g, "@")
    .replace(/@\s+/g, "@")
    .replace(/\s+@/g, "@");
}

function isColumnLetterLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4) return false;
  return tokens.every((t) => /^[A-Za-z0-9'"]{1,2}$/.test(t));
}

function isNoiseLine(line) {
  const t = cellText(line);
  if (!t) return true;
  if (/^\d{1,4}$/.test(t)) return true;
  if (/^[A-Z]{1,3}$/.test(t)) return true;
  if (/^[\s\-_=~|·•]+$/.test(t)) return true;
  if (isColumnLetterLine(t)) return true;
  if (/^(sheet|tab|row|column|grid)\b/i.test(t)) return true;
  return false;
}

function stripUrlJunk(text) {
  const emails = [];
  let out = String(text ?? "").replace(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    (match) => {
      emails.push(match);
      return `__EMAIL_${emails.length - 1}__`;
    }
  );

  out = out
    .replace(/https?:\/\/[^\s]*/gi, "")
    .replace(/\bwww\.[^\s]*/gi, "")
    .replace(/\s*https?[^\s]*/gi, "")
    .replace(/\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi, "")
    .replace(/\b[a-z]{2,6}vww[-a-zA-Z0-9.]+/gi, "");

  for (let i = 0; i < emails.length; i++) {
    out = out.replace(`__EMAIL_${i}__`, emails[i]);
  }
  return out;
}

function cleanFieldText(text) {
  return stripUrlJunk(text)
    .replace(/^[\s_=\-–—\/\\|.:;]+/, "")
    .replace(/[\s_=\-–—\/\\|.:;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleName(name) {
  const t = cleanFieldText(name);
  if (!t || t.length < 2 || t.length > 80) return false;
  if (/^[\d\s\-_.@+]+$/.test(t)) return false;
  if (/^(name|email|e-mail|phone|contact|status|valid)$/i.test(t)) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  return true;
}

function isPlausiblePhone(value) {
  const t = cleanFieldText(value);
  if (!t) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isHeaderRow(row) {
  return row.some((cell) => {
    const n = normalizeHeader(cell);
    return (
      n === "name" ||
      n === "email" ||
      n === "phone" ||
      n === "contact" ||
      n.includes("email") ||
      n.includes("site") ||
      n.includes("url") ||
      n.includes("linkedin")
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
    const count = allRows.filter((row) =>
      isTrustworthyEmail(extractTrustworthyEmails(row[col])[0] || row[col])
    ).length;
    if (count > bestCount) {
      bestCount = count;
      bestIdx = col;
    }
  }
  return bestCount > 0 ? bestIdx : -1;
}

function normalizeHeaderLabel(header, colIdx, emailColIdx, rows, colCount) {
  const n = normalizeHeader(header);
  if (n.includes("email") || n === "mail") return "email";
  if (n === "name" || n === "fullname" || n === "contactname") return "name";
  if (n.includes("phone") || n === "mobile" || n === "contact") return "phone";
  if (n === "company" || n === "organization") return "company";

  if (colIdx === emailColIdx) return "email";
  if (colIdx === 0 && emailColIdx !== 0) return "name";

  const colValues = rows.map((row) => cellText(row[colIdx])).filter(Boolean);
  const phoneHits = colValues.filter(isPlausiblePhone).length;
  if (phoneHits >= Math.max(2, Math.ceil(colValues.length * 0.4))) return "phone";

  if (colCount === 3) {
    if (colIdx === 0) return "name";
    if (colIdx === 1) return "email";
    if (colIdx === 2) return "phone";
  }

  return cleanFieldText(header) || `column_${colIdx + 1}`;
}

function buildStandardHeaders(headers, rows, emailColIdx) {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  return Array.from({ length: colCount }, (_, i) =>
    normalizeHeaderLabel(headers[i] || "", i, emailColIdx, rows, colCount)
  );
}

function sanitizeDataRow(row, headers, emailColIdx) {
  const cells = row.map((c) => cleanFieldText(c));
  const emailRaw = cells[emailColIdx] || "";
  const emails = extractTrustworthyEmails(emailRaw);
  if (emails.length === 0) return null;

  const email = emails[0];
  const out = [...cells];
  out[emailColIdx] = email;

  const nameIdx = headers.findIndex((h) => normalizeHeader(h) === "name");
  if (nameIdx !== -1 && !isPlausibleName(out[nameIdx])) {
    out[nameIdx] = "";
  }

  const phoneIdx = headers.findIndex((h) => normalizeHeader(h) === "phone");
  if (phoneIdx !== -1 && out[phoneIdx] && !isPlausiblePhone(out[phoneIdx])) {
    const maybePhone = out[phoneIdx].replace(/[^\d+().\-\s]/g, "").trim();
    out[phoneIdx] = isPlausiblePhone(maybePhone) ? maybePhone : "";
  }

  return out;
}

function finalizeParsedTable(headers, rows) {
  if (!rows.length) return null;

  let normalizedHeaders = headers.map((h) => String(h ?? "").trim());
  const emailColIdx = findEmailColumnIndex(normalizedHeaders, rows);
  if (emailColIdx === -1) return null;

  normalizedHeaders = buildStandardHeaders(normalizedHeaders, rows, emailColIdx);

  const seenEmails = new Set();
  const cleanRows = [];

  for (const row of rows) {
    const padded = [...row.map((c) => String(c ?? ""))];
    while (padded.length < normalizedHeaders.length) padded.push("");

    const emailIdx = findEmailColumnIndex(normalizedHeaders, [padded]);
    const sanitized = sanitizeDataRow(padded, normalizedHeaders, emailIdx);
    if (!sanitized) continue;

    const email = sanitized[emailIdx].toLowerCase();
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    cleanRows.push(sanitized.slice(0, normalizedHeaders.length));
  }

  if (cleanRows.length === 0) return null;

  return {
    source: "google-sheets-ocr",
    headers: normalizedHeaders,
    rows: cleanRows,
    warning: OCR_WARNING,
  };
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
    if (filled >= 1 && !row.some((c) => extractTrustworthyEmails(c).length > 0)) {
      return { headers: row, rows: nonEmptyRows.slice(i + 1) };
    }
  }

  const rows = normalizeRowWidths(nonEmptyRows);
  const emailCol = findEmailColumnByContent(rows);
  if (emailCol === -1) return null;

  const colCount = rows[0].length;
  const headers = Array.from({ length: colCount }, (_, i) => {
    if (i === emailCol) return "email";
    if (i === 0) return "name";
    if (i === colCount - 1 && colCount >= 3) return "phone";
    return "";
  });
  return { headers, rows };
}

function extractNameFromLine(line) {
  const cutAt = line.search(
    /https?:|\bwww\.|\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}|[a-zA-Z0-9._%+\-]+@/
  );
  const candidate = cutAt > 0 ? line.slice(0, cutAt) : line;
  return cleanFieldText(candidate);
}

function parseEmailAnchoredRows(lines) {
  const rows = [];
  let pendingName = null;

  for (const rawLine of lines) {
    const line = fixOcrEmailSpaces(rawLine)
      .replace(/(?<!\w)[_\-=]\s*/g, "")
      .trim();

    const emails = extractTrustworthyEmails(line);
    if (emails.length === 0) {
      const name = extractNameFromLine(line);
      if (isPlausibleName(name)) pendingName = name;
      continue;
    }

    const email = emails[0];
    const idx = line.toLowerCase().indexOf(email.toLowerCase());
    const left = idx >= 0 ? line.slice(0, idx) : "";
    const right = idx >= 0 ? line.slice(idx + email.length) : "";

    const nameDirect = cleanFieldText(left);
    const name = isPlausibleName(nameDirect) ? nameDirect : isPlausibleName(pendingName) ? pendingName : "";
    pendingName = null;

    const tail = cleanFieldText(right);
    const phone = isPlausiblePhone(tail) ? tail.replace(/[^\d+().\-\s]/g, "").trim() : "";

    rows.push([name, email, phone]);
  }

  if (!rows.length) return null;
  return finalizeParsedTable(STANDARD_HEADERS, rows);
}

export function parseLineToCells(line) {
  if (line.includes("\t")) {
    return line.split("\t").map((c) => cleanFieldText(c));
  }

  const emails = extractTrustworthyEmails(line);
  if (emails.length === 1) {
    const email = emails[0];
    const idx = line.toLowerCase().indexOf(email.toLowerCase());
    const before = idx > 0 ? cleanFieldText(line.slice(0, idx)) : "";
    const after = idx >= 0 ? cleanFieldText(line.slice(idx + email.length)) : "";
    const cells = [];
    if (before) cells.push(before.replace(/^\d+\s*/, "").trim());
    cells.push(email);
    if (after) cells.push(after);
    return cells.length ? cells : [line];
  }

  if (emails.length > 1) {
    return emails;
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
    if (looksLikeHeader) return words.map((w) => cleanFieldText(w));
  }

  const parts = line.split(/\s{2,}/).map((p) => cleanFieldText(p)).filter(Boolean);
  if (parts.length >= 2) return parts;

  return [cleanFieldText(line)];
}

export function parseOcrTextToTable(ocrText) {
  if (!ocrText) return null;

  let text = String(ocrText);
  // Worker may return JSON strings or nested payloads already flattened to text.
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      const json = JSON.parse(text);
      if (typeof json === "string") text = json;
      else if (json && typeof json === "object") {
        text =
          json.text ||
          json.result ||
          json.ocr_text ||
          json.content ||
          (Array.isArray(json.lines) ? json.lines.join("\n") : "") ||
          text;
      }
    } catch {
      /* keep raw text */
    }
  }

  if (!text.includes("@")) return null;

  const lines = fixOcrEmailSpaces(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isNoiseLine(l));

  if (lines.length === 0) return null;

  const parsed = lines.map(parseLineToCells);
  const nonEmptyRows = normalizeRowWidths(parsed)
    .filter((row) => row.some((c) => cellText(c)))
    .filter(
      (row) =>
        extractTrustworthyEmails(row.join(" ")).length > 0 ||
        extractEmailsFromText(row.join(" ")).length > 0 ||
        row.filter((c) => cellText(c)).length >= 2
    );

  if (nonEmptyRows.length >= 1) {
    const split = splitHeadersAndRows(nonEmptyRows);
    if (split && split.rows.length > 0) {
      const maxCols = Math.max(split.headers.length, ...split.rows.map((r) => r.length));
      const headers = [...split.headers];
      while (headers.length < maxCols) headers.push("");

      const rows = split.rows.map((row) => {
        const padded = row.map((c) => cleanFieldText(c));
        while (padded.length < maxCols) padded.push("");
        return padded;
      });

      const tableResult = finalizeParsedTable(headers, rows);
      if (tableResult) return tableResult;
    }
  }

  const anchored = parseEmailAnchoredRows(lines);
  if (anchored?.rows?.length) return anchored;

  return null;
}

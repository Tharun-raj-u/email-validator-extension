const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_EXTRACT_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export function isValidEmailFormat(value) {
  if (!value || typeof value !== "string") return false;
  return EMAIL_REGEX.test(value.trim());
}

/** Stricter check to drop OCR noise and broken tokens. */
export function isTrustworthyEmail(value) {
  if (!isValidEmailFormat(value)) return false;

  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return false;
  if (email.includes("..") || email.includes("@.") || email.includes(".@")) return false;

  const [local, domain] = email.split("@");
  if (!local || !domain || local.length < 1 || domain.length < 3) return false;
  if (!domain.includes(".")) return false;

  const tld = domain.split(".").pop() || "";
  if (tld.length < 2 || tld.length > 24 || !/^[a-z]+$/.test(tld)) return false;
  if (/^\d+$/.test(local) && local.length < 4) return false;
  if (/^[._\-+]+$/.test(local)) return false;
  if (/^(noreply|no-reply|donotreply|mailer-daemon)$/.test(local)) return false;

  const domainBase = domain.slice(0, -(tld.length + 1));
  if (!domainBase || domainBase.endsWith(".")) return false;
  if (/[^a-z0-9.\-]/.test(domain)) return false;

  return true;
}

export function extractEmailsFromText(text) {
  const matches = String(text || "").match(EMAIL_EXTRACT_PATTERN) || [];
  return [...new Set(matches.map((e) => e.trim().toLowerCase()))];
}

export function extractTrustworthyEmails(text) {
  return extractEmailsFromText(text).filter(isTrustworthyEmail);
}

export function splitDelimitedLine(line) {
  const text = String(line ?? "");
  if (!text) return [];

  const delimiter = text.includes("\t") ? "\t" : text.includes("|") ? "|" : text.includes(",") ? "," : null;
  if (!delimiter) return [text.trim()];

  return text
    .split(delimiter)
    .map((part) => part.trim())
}

export function parseColumnConfig(configText) {
  if (Array.isArray(configText)) {
    return configText.map((item) => String(item).trim()).filter(Boolean);
  }

  const text = String(configText ?? "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
  } catch {
    /* ignore */
  }

  return text
    .split(/[\n,|\t]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function rowLooksLikeHeader(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
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

function resolveHeaderIndex(headerRow, columnName) {
  const key = normalizeHeader(columnName);
  if (!key) return -1;

  const headers = headerRow.map((h) => normalizeHeader(h));

  // Exact match first
  let idx = headers.indexOf(key);
  if (idx !== -1) return idx;

  // Alias groups
  const aliasGroups = [
    ["name", "fullname", "company", "companyname", "business", "businessname", "contact", "contactname", "personname"],
    [
      "email",
      "emailid",
      "emailaddress",
      "mail",
      "workemail",
      "primaryemail",
      "personalemail",
      "personemail",
      "companyemail",
    ],
    ["phone", "mobile", "tel", "telephone", "phonenumber", "contactnumber", "cell", "personphone"],
    ["url", "website", "site", "companyurl", "websiteurl", "link", "domain"],
  ];
  const group = aliasGroups.find((g) => g.includes(key));
  if (group) {
    idx = headers.findIndex((n) => group.includes(n));
    if (idx !== -1) return idx;
    idx = headers.findIndex((n) =>
      group.some((a) => n === a || n.endsWith(a) || n.startsWith(a))
    );
    if (idx !== -1) return idx;
  }

  // Soft match: personal_email ↔ person_email, company_name ↔ name
  idx = headers.findIndex((n) => {
    if (!n) return false;
    if (n.includes(key) || key.includes(n)) return true;
    // strip personal/person/company prefixes and compare
    const strip = (s) => s.replace(/^(personal|person|company|work|primary)/, "");
    return strip(n) && strip(n) === strip(key);
  });
  return idx;
}

/**
 * Filter / reorder rows to only the configured columns.
 * Uses header-name matching when possible, otherwise maps by column position.
 */
export function applyColumnMap(rows, preferredColumns = []) {
  const preferred = parseColumnConfig(preferredColumns);
  const normalized = rows
    .map((row) => (Array.isArray(row) ? row : [row]).map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some((cell) => cell));

  if (!normalized.length) return [];
  if (!preferred.length) return normalized;

  const hasHeader = normalized.length > 1 && rowLooksLikeHeader(normalized[0]);
  const headerRow = hasHeader ? normalized[0] : [];
  const dataRows = hasHeader ? normalized.slice(1) : normalized;

  if (hasHeader && headerRow.length) {
    const indexes = preferred.map((name) => resolveHeaderIndex(headerRow, name));
    if (indexes.some((idx) => idx >= 0)) {
      return [
        preferred,
        ...dataRows.map((row) =>
          indexes.map((idx) => (idx >= 0 ? row[idx] ?? "" : ""))
        ),
      ];
    }
  }

  if (preferred.length === 1 && isEmailHeader(preferred[0])) {
    const width = Math.max(...dataRows.map((r) => r.length), 1);
    const pseudoHeaders = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    const emailIdx = findEmailColumnIndex(pseudoHeaders, dataRows);
    if (emailIdx >= 0) {
      return [
        preferred,
        ...dataRows.map((row) => [row[emailIdx] ?? ""]),
      ];
    }
  }

  return [
    preferred,
    ...dataRows.map((row) => preferred.map((_, i) => row[i] ?? "")),
  ];
}

export function normalizeColumnsFromRows(rows, preferredColumns = []) {
  return applyColumnMap(rows, preferredColumns);
}

export function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isEmailHeader(header) {
  const n = normalizeHeader(header);
  if (!n) return false;
  return (
    n === "email" ||
    n === "emailid" ||
    n === "emailaddress" ||
    n === "mail" ||
    n.endsWith("email") ||
    n.includes("email")
  );
}

function isCellReference(text) {
  return /^[A-Z]{1,4}\d+$/.test(String(text || "").trim());
}

function cellHasEmail(value) {
  if (!value) return false;
  if (isValidEmailFormat(value)) return true;
  return extractEmailsFromText(value).length > 0;
}

function findNameColumnIndex(headers) {
  return headers.findIndex((h) => normalizeHeader(h) === "name");
}

function findPhoneColumnIndex(headers) {
  return headers.findIndex((h) => {
    const n = normalizeHeader(h);
    return (
      n === "phone" ||
      n === "contact" ||
      n === "mobile" ||
      n.includes("phone")
    );
  });
}

function findEmailColumnByLayout(headers) {
  const nameIdx = findNameColumnIndex(headers);
  const phoneIdx = findPhoneColumnIndex(headers);

  if (nameIdx !== -1 && phoneIdx !== -1 && phoneIdx > nameIdx) {
    if (phoneIdx - nameIdx === 2) return nameIdx + 1;
    for (let i = nameIdx + 1; i < phoneIdx; i++) {
      if (!headers[i]?.trim()) return i;
    }
    return nameIdx + 1;
  }

  if (nameIdx !== -1) {
    const nextIdx = nameIdx + 1;
    if (nextIdx < headers.length && !headers[nextIdx]?.trim()) return nextIdx;
    if (nextIdx < headers.length && !isEmailHeader(headers[nextIdx])) {
      const nextNorm = normalizeHeader(headers[nextIdx]);
      if (nextNorm !== "phone" && nextNorm !== "contact" && nextNorm !== "mobile") {
        return nextIdx;
      }
    }
  }

  return -1;
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

export function findEmailColumnIndex(headers, rows) {
  let bestIdx = -1;
  let bestScore = 0;

  for (let col = 0; col < headers.length; col++) {
    const values = rows.map((row) => (row[col] || "").trim()).filter(Boolean);
    const headerVal = (headers[col] || "").trim();
    if (headerVal) values.unshift(headerVal);
    if (values.length === 0) continue;
    const emailCount = values.filter((v) => cellHasEmail(v)).length;
    const score = emailCount / values.length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = col;
    }
  }

  const emailHeaderIdx = headers.findIndex((h) => isEmailHeader(h));
  if (emailHeaderIdx !== -1) {
    const values = rows.map((row) => (row[emailHeaderIdx] || "").trim()).filter(Boolean);
    const emailHits = values.filter((v) => cellHasEmail(v)).length;
    const headerScore = values.length > 0 ? emailHits / values.length : 0;

    // Prefer a labeled email column only if it actually contains emails,
    // or if it performs close to the best detected column.
    if (headerScore >= 0.2 || (bestIdx === -1 || headerScore >= bestScore * 0.8)) {
      return emailHeaderIdx;
    }
  }

  const layoutIdx = findEmailColumnByLayout(headers);
  if (layoutIdx !== -1) {
    const values = rows.map((row) => (row[layoutIdx] || "").trim()).filter(Boolean);
    const emailHits = values.filter((v) => cellHasEmail(v)).length;
    const layoutScore = values.length > 0 ? emailHits / values.length : 0;
    if (layoutScore >= bestScore * 0.8 || bestIdx === -1) {
      return layoutIdx;
    }
  }

  if (bestScore >= 0.5) return bestIdx;
  if (bestIdx !== -1 && bestScore > 0) return bestIdx;

  return findEmailColumnByContent([headers, ...rows]);
}

export function escapeCsvCell(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

export function insertValidColumn(headers, rows, emailColIdx, validationMap) {
  // Drop any existing valid columns so we never duplicate them.
  const keepIdx = [];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || "").trim().toLowerCase() !== "valid") {
      keepIdx.push(i);
    }
  }
  let cleanHeaders = keepIdx.map((i) => headers[i]);
  let cleanRows = rows.map((row) => keepIdx.map((i) => row[i] ?? ""));

  let emailIdx = emailColIdx;
  if (emailIdx >= 0) {
    const originalEmailHeader = headers[emailColIdx];
    emailIdx = cleanHeaders.findIndex(
      (h, i) => i === keepIdx.indexOf(emailColIdx) || h === originalEmailHeader
    );
    if (emailIdx < 0) {
      emailIdx = findEmailColumnIndex(cleanHeaders, cleanRows);
    }
  } else {
    emailIdx = findEmailColumnIndex(cleanHeaders, cleanRows);
  }
  if (emailIdx < 0) emailIdx = Math.max(0, cleanHeaders.length - 1);

  const newHeaders = [
    ...cleanHeaders.slice(0, emailIdx + 1),
    "valid",
    ...cleanHeaders.slice(emailIdx + 1),
  ];

  const newRows = cleanRows.map((row) => {
    const email =
      extractEmailCandidateFromCell(row[emailIdx]) ||
      extractEmailFromCell(row[emailIdx]);
    const valid = email
      ? resolveValidationStatusForEmail(email, validationMap)
      : "";
    return [...row.slice(0, emailIdx + 1), valid, ...row.slice(emailIdx + 1)];
  });

  return { headers: newHeaders, rows: newRows };
}

export function buildPlainTextCsv(emails, validationMap) {
  const headers = ["email", "valid"];
  const rows = emails.map((email) => [
    email,
    validationMap.get(email.toLowerCase()) ?? "",
  ]);
  return buildCsv(headers, rows);
}

export function buildOutputCsv(extractedData, validationMap) {
  const { headers, rows } = buildMergedOutput(extractedData, validationMap);
  return buildCsv(headers, rows);
}

function escapeTextCell(value) {
  return String(value == null ? "" : value).replace(/\r?\n/g, " ").trim();
}

export function buildOutputText(extractedData, validationMap) {
  const { headers, rows } = buildMergedOutput(extractedData, validationMap);
  const lines = [];
  lines.push(headers.map(escapeTextCell).join("\t"));
  for (const row of rows) {
    lines.push(row.map(escapeTextCell).join("\t"));
  }
  return lines.join("\n");
}

export function extractEmailFromCell(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (isTrustworthyEmail(trimmed)) return trimmed.toLowerCase();
  const found = extractTrustworthyEmails(trimmed);
  return found[0] || "";
}

/** Looser extract for sheet write-back (includes truncated / incomplete addresses). */
const LOOSE_EMAIL_PATTERN =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{1,24}/g;

export function extractEmailCandidateFromCell(value) {
  const trusted = extractEmailFromCell(value);
  if (trusted) return trusted;

  const text = String(value || "").trim();
  if (!text) return "";

  const matches = text.match(LOOSE_EMAIL_PATTERN) || [];
  if (matches.length) return matches[0].toLowerCase();

  const simple = text.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(simple)) return simple;
  return "";
}

/**
 * Resolve validation status for a sheet cell email, with fuzzy key matching.
 * Format-broken candidates that were never validated → Invalid.
 */
export function resolveValidationStatusForEmail(email, validationMap) {
  if (!email) return "";

  const map =
    validationMap instanceof Map
      ? validationMap
      : new Map(Object.entries(validationMap || {}));

  const key = String(email).trim().toLowerCase();
  if (map.has(key)) {
    return normalizeValidationLabel(map.get(key));
  }

  const [local, domain] = key.split("@");
  if (local && domain) {
    for (const [mappedEmail, status] of map.entries()) {
      const [mLocal, mDomain] = String(mappedEmail).split("@");
      if (!mLocal || !mDomain || mLocal !== local) continue;
      if (
        mDomain === domain ||
        mDomain.startsWith(domain) ||
        domain.startsWith(mDomain)
      ) {
        return normalizeValidationLabel(status);
      }
    }
  }

  if (!isValidEmailFormat(key) || !isTrustworthyEmail(key)) {
    return "Invalid";
  }

  return "Unknown";
}

function normalizeValidationLabel(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "valid") return "Valid";
  if (s === "invalid") return "Invalid";
  return "Unknown";
}

export function getUniqueEmails(extractedData) {
  const { headers, rows, source } = extractedData;

  if (source === "plain-text" || source === "dom-scrape") {
    return rows.map((r) => extractEmailFromCell(r[0])).filter(Boolean);
  }

  const emailColIdx = findEmailColumnIndex(headers, rows);
  if (emailColIdx === -1) return [];

  const seen = new Set();
  const emails = [];
  for (const row of rows) {
    const email = extractEmailFromCell(row[emailColIdx]);
    if (email && !seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  return emails;
}

export function getPreviewTable(headers, rows, limit = 5) {
  const previewRows = rows.slice(0, limit);
  return { headers, rows: previewRows };
}

export function buildMergedOutput(extractedData, validationMap) {
  const { headers, rows, source } = extractedData;

  if (source === "plain-text" || source === "dom-scrape") {
    const outHeaders =
      source === "dom-scrape" ? ["email", "valid", "context"] : ["email", "valid"];
    const outRows = rows.map((row) => {
      const email = extractEmailFromCell(row[0]);
      const valid = email ? (validationMap.get(email) ?? "") : "";
      if (source === "dom-scrape") {
        return [row[0], valid, row[1] || ""];
      }
      return [row[0], valid];
    });
    return { headers: outHeaders, rows: outRows };
  }

  const emailColIdx = findEmailColumnIndex(headers, rows);
  if (emailColIdx === -1) {
    if (source === "pasted-input") {
      const emails = rows.map((row) => extractEmailFromCell(row[0])).filter(Boolean);
      return {
        headers: ["email", "valid"],
        rows: emails.map((email) => [email, validationMap.get(email) ?? ""]),
      };
    }
    throw new Error("No email column detected");
  }

  return insertValidColumn(headers, rows, emailColIdx, validationMap);
}

export function buildOutputJson(extractedData, validationMap, meta = {}) {
  const { headers, rows } = buildMergedOutput(extractedData, validationMap);
  const payload = {
    exportedAt: new Date().toISOString(),
    source: extractedData.source,
    ...meta,
    headers,
    rows: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h || `column_${i + 1}`, row[i] ?? ""]))),
    rowArrays: rows,
  };
  return JSON.stringify(payload, null, 2);
}

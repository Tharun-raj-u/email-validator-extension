(function () {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function isValidEmailFormat(value) {
    if (!value || typeof value !== "string") return false;
    return EMAIL_REGEX.test(value.trim());
  }

  function extractEmailsFromText(text) {
    const pattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(pattern) || [];
    return [...new Set(matches.map((e) => e.trim().toLowerCase()))];
  }

  function normalizeHeader(header) {
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

  function findEmailColumnIndex(headers, rows) {
    const emailHeaderIdx = headers.findIndex((h) => isEmailHeader(h));
    if (emailHeaderIdx !== -1) return emailHeaderIdx;

    const layoutIdx = findEmailColumnByLayout(headers);
    if (layoutIdx !== -1) return layoutIdx;

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

    if (bestScore >= 0.5) return bestIdx;
    if (bestIdx !== -1 && bestScore > 0) return bestIdx;

    return findEmailColumnByContent([headers, ...rows]);
  }

  function extractEmailFromCell(value) {
    if (!value) return "";
    const trimmed = value.trim();
    if (isValidEmailFormat(trimmed)) return trimmed.toLowerCase();
    const found = extractEmailsFromText(trimmed);
    return found[0] || "";
  }

  function getUniqueEmails(data) {
    const emailColIdx = findEmailColumnIndex(data.headers, data.rows);
    if (emailColIdx === -1) return [];

    const seen = new Set();
    const emails = [];
    for (const row of data.rows) {
      const email = extractEmailFromCell(row[emailColIdx]);
      if (email && !seen.has(email)) {
        seen.add(email);
        emails.push(email);
      }
    }
    return emails;
  }

  function getSheetCellText(cell) {
    const candidates = [];

    for (const attr of cell.getAttributeNames()) {
      const val = cell.getAttribute(attr);
      if (val && val.includes("@")) candidates.push(val.trim());
    }

    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t) candidates.push(t);
    }

    const inner = cell.querySelector(
      ".softmerge-inner, .grid-cell-inner, .cell-input, .s0, .s1, .s2, .s3, .s4, .s5"
    );
    if (inner) {
      const t = (inner.innerText || inner.textContent || "").trim();
      if (t) candidates.push(t);
    }

    const text = (cell.innerText || cell.textContent || "").trim();
    if (text) candidates.push(text);

    const mailto = cell.querySelector('a[href^="mailto:"]');
    if (mailto) {
      const email = mailto.href.replace(/^mailto:/i, "").split("?")[0].trim();
      if (email) candidates.push(email);
    }

    const sheetsValue = cell.getAttribute("data-sheets-value");
    if (sheetsValue) {
      try {
        const parsed = JSON.parse(sheetsValue);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string" && item) candidates.push(item);
          }
        } else if (typeof parsed === "string") {
          candidates.push(parsed);
        }
      } catch {
        /* ignore */
      }
    }

    const label = cell.getAttribute("aria-label");
    if (label?.trim()) candidates.push(label.trim());

    for (const c of candidates) {
      if (isValidEmailFormat(c)) return c;
      const found = extractEmailsFromText(c);
      if (found.length === 1) return found[0];
    }

    for (const c of candidates) {
      if (c && !isCellReference(c)) return c;
    }

    return candidates[0] || "";
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
      const filled = row.filter((c) => c.trim()).length;
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

  function parseLineToCells(line) {
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

    return [line];
  }

  function parseGridInnerText(container) {
    const raw = container.innerText;
    if (!raw || !raw.includes("@")) return null;

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map(parseLineToCells);

    const nonEmptyRows = normalizeRowWidths(parsed)
      .filter((row) => row.some((c) => c.trim()))
      .filter((row) => row.some(cellHasEmail) || row.filter((c) => c.trim()).length >= 2);

    if (nonEmptyRows.length < 1) return null;
    return splitHeadersAndRows(nonEmptyRows);
  }

  function extractGoogleSheetsFromInnerText() {
    const selectors = [
      "#grid-container",
      "#waffle-grid-container",
      ".grid-container",
      '[role="grid"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const split = parseGridInnerText(el);
      if (split && split.rows.length > 0) {
        const maxCols = Math.max(split.headers.length, ...split.rows.map((r) => r.length));
        let headers = split.headers;
        if (headers.length < maxCols) {
          headers = [...headers, ...Array(maxCols - headers.length).fill("")];
        }
        const rows = split.rows.map((row) =>
          row.length < maxCols
            ? [...row, ...Array(maxCols - row.length).fill("")]
            : row
        );
        return { headers, rows };
      }
    }
    return null;
  }

  function countEmailsInData(headers, rows) {
    const idx = findEmailColumnIndex(headers, rows);
    if (idx === -1) return 0;
    return rows.filter((row) => cellHasEmail(row[idx])).length;
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

  function getMainGrid() {
    const container = document.querySelector("#grid-container");
    if (container) {
      const grid = container.querySelector('[role="grid"]');
      if (grid) return grid;
    }
    const grids = document.querySelectorAll('[role="grid"]');
    let best = null;
    let bestCount = 0;
    for (const grid of grids) {
      const count = grid.querySelectorAll('[role="gridcell"]').length;
      if (count > bestCount) {
        bestCount = count;
        best = grid;
      }
    }
    return best;
  }

  function extractGoogleSheetsFromGrid() {
    const grid = getMainGrid();
    if (!grid) return null;

    const cells = grid.querySelectorAll(
      '[role="gridcell"], [role="columnheader"]'
    );
    if (cells.length === 0) return null;

    const matrix = new Map();

    for (const cell of cells) {
      let rowIdx = parseInt(cell.getAttribute("aria-rowindex"), 10);
      const colIdx = parseInt(cell.getAttribute("aria-colindex"), 10);
      if (isNaN(colIdx)) continue;

      if (isNaN(rowIdx)) {
        const parentRow = cell.closest('[role="row"]');
        if (parentRow) {
          rowIdx = parseInt(parentRow.getAttribute("aria-rowindex"), 10);
        }
        if (isNaN(rowIdx) && cell.getAttribute("role") === "columnheader") {
          rowIdx = 1;
        }
      }
      if (isNaN(rowIdx)) continue;

      const text = getSheetCellText(cell);
      if (!matrix.has(rowIdx)) matrix.set(rowIdx, new Map());
      matrix.get(rowIdx).set(colIdx, text);
    }

    if (matrix.size === 0) return null;

    const rowIndices = [...matrix.keys()].sort((a, b) => a - b);
    const allColIndices = new Set();
    for (const row of matrix.values()) {
      for (const col of row.keys()) allColIndices.add(col);
    }
    let colIndices = [...allColIndices].sort((a, b) => a - b);

    const dataRows = rowIndices.map((rowIdx) =>
      colIndices.map((colIdx) => matrix.get(rowIdx)?.get(colIdx) ?? "")
    );

    const nonEmptyRows = dataRows.filter((row) => row.some((cell) => cell.trim()));
    if (nonEmptyRows.length < 1) return null;

    const split = splitHeadersAndRows(nonEmptyRows);
    if (!split) return null;

    let headers = split.headers;
    let rows = split.rows;

    const maxCols = Math.max(headers.length, ...rows.map((r) => r.length));
    if (headers.length < maxCols) {
      headers = [...headers, ...Array(maxCols - headers.length).fill("")];
    }
    rows = rows.map((row) =>
      row.length < maxCols
        ? [...row, ...Array(maxCols - row.length).fill("")]
        : row
    );

    if (headers.length > 1) {
      const firstColValues = rows.map((row) => (row[0] || "").trim()).filter(Boolean);
      const mostlyNumeric =
        firstColValues.length > 0 &&
        firstColValues.filter((v) => /^\d+$/.test(v)).length / firstColValues.length >= 0.8;
      const headerIsNumeric = /^\d+$/.test((headers[0] || "").trim());
      if (mostlyNumeric || headerIsNumeric) {
        headers = headers.slice(1);
        rows = rows.map((row) => row.slice(1));
        colIndices = colIndices.slice(1);
      }
    }

    const headerIdx = nonEmptyRows.findIndex(isHeaderRow);
    let headerRowIdx = rowIndices[0];
    if (headerIdx >= 0) {
      headerRowIdx = rowIndices[headerIdx];
    } else {
      for (let i = 0; i < Math.min(3, nonEmptyRows.length); i++) {
        if (!nonEmptyRows[i].some(cellHasEmail)) {
          headerRowIdx = rowIndices[i];
          break;
        }
      }
    }

    return { headers, rows, grid, rowIndices, colIndices, headerRowIdx };
  }

  function enrichRowsFromGrid(grid, colIndices, emailColIdx, rows, rowIndices, headerRowIdx) {
    if (emailColIdx === -1 || colIndices[emailColIdx] == null) return rows;
    const ariaCol = colIndices[emailColIdx];
    const firstDataIdx = rowIndices.findIndex((ri) => ri > headerRowIdx);
    const dataStartIdx = firstDataIdx === -1 ? 0 : firstDataIdx;

    for (const cell of grid.querySelectorAll('[role="gridcell"]')) {
      const cellCol = parseInt(cell.getAttribute("aria-colindex"), 10);
      if (cellCol !== ariaCol) continue;

      let rowIdx = parseInt(cell.getAttribute("aria-rowindex"), 10);
      if (isNaN(rowIdx)) {
        const parentRow = cell.closest('[role="row"]');
        if (parentRow) {
          rowIdx = parseInt(parentRow.getAttribute("aria-rowindex"), 10);
        }
      }
      if (isNaN(rowIdx) || rowIdx <= headerRowIdx) continue;

      const dataRowIndex = rowIndices.indexOf(rowIdx) - dataStartIdx;
      if (dataRowIndex < 0 || dataRowIndex >= rows.length) continue;

      const text = getSheetCellText(cell);
      if (text) rows[dataRowIndex][emailColIdx] = text;
    }
    return rows;
  }

  function extractGoogleSheetsFromBootstrap() {
    const parser = typeof SheetsBootstrap !== "undefined" ? SheetsBootstrap : null;
    if (!parser) return null;

    const parsed = parser.extractBootstrapFromDocument(document);
    if (!parsed?.rows?.length) return null;

    const split = splitHeadersAndRows(parsed.rows);
    if (!split || split.rows.length === 0) return null;

    let headers = split.headers;
    let rows = split.rows;
    const maxCols = Math.max(headers.length, ...rows.map((r) => r.length));
    if (headers.length < maxCols) {
      headers = [...headers, ...Array(maxCols - headers.length).fill("")];
    }
    rows = rows.map((row) =>
      row.length < maxCols ? [...row, ...Array(maxCols - row.length).fill("")] : row
    );

    let warning = null;
    if (parsed.totalRows && parsed.dataRowCount + 1 < parsed.totalRows) {
      warning = `Loaded ${parsed.dataRowCount} data rows from sheet data (${parsed.totalRows} total). Scroll to load more rows, then scan again.`;
    }

    return { headers, rows, warning };
  }

  function extractGoogleSheets() {
    if (!location.hostname.includes("docs.google.com") || !location.pathname.includes("/spreadsheets/")) {
      return null;
    }

    const fromBootstrap = extractGoogleSheetsFromBootstrap();
    const fromText = extractGoogleSheetsFromInnerText();
    const fromGridRaw = extractGoogleSheetsFromGrid();

    let fromGrid = null;
    if (fromGridRaw) {
      const { headers, rows, grid, rowIndices, colIndices, headerRowIdx } = fromGridRaw;
      const emailColIdx = findEmailColumnIndex(headers, rows);
      const enrichedRows = enrichRowsFromGrid(
        grid,
        colIndices,
        emailColIdx,
        rows.map((r) => [...r]),
        rowIndices,
        headerRowIdx
      );
      fromGrid = { headers, rows: enrichedRows };
    }

    const bootstrapScore = fromBootstrap
      ? countEmailsInData(fromBootstrap.headers, fromBootstrap.rows)
      : 0;
    const textScore = fromText ? countEmailsInData(fromText.headers, fromText.rows) : 0;
    const gridScore = fromGrid ? countEmailsInData(fromGrid.headers, fromGrid.rows) : 0;

    const candidates = [
      { data: fromBootstrap, score: bootstrapScore, warning: fromBootstrap?.warning },
      { data: fromText, score: textScore, warning: null },
      { data: fromGrid, score: gridScore, warning: null },
    ].filter((c) => c.data);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    let warning = best.warning;

    if (!warning && best.data !== fromBootstrap) {
      const grid = getMainGrid();
      const ariaRowCount = grid?.getAttribute("aria-rowcount");
      const totalRows = ariaRowCount ? parseInt(ariaRowCount, 10) : null;
      if (totalRows && best.data.rows.length + 1 < totalRows) {
        warning = `Only ${best.data.rows.length} data rows are visible in the DOM (${totalRows} total). Scroll the sheet to load more rows before scanning.`;
      }
    }

    return {
      source: "google-sheets",
      headers: best.data.headers,
      rows: best.data.rows,
      warning,
    };
  }

  function getCellText(cell) {
    return (cell.innerText || cell.textContent || "").trim();
  }

  function extractTableData(table) {
    const headerCells = table.querySelectorAll("thead th, thead td");
    const bodyRows = table.querySelectorAll("tbody tr");
    const allRows = table.querySelectorAll("tr");

    let headers = [];
    let rows = [];

    if (headerCells.length > 0) {
      headers = [...headerCells].map(getCellText);
      rows = [...bodyRows].map((tr) =>
        [...tr.querySelectorAll("td, th")].map(getCellText)
      );
    } else if (allRows.length > 0) {
      const firstRowCells = allRows[0].querySelectorAll("td, th");
      const hasTh = allRows[0].querySelector("th") !== null;
      const firstRowText = [...firstRowCells].map(getCellText);
      const looksLikeHeader = firstRowText.some(
        (h) => normalizeHeader(h) === "email" || normalizeHeader(h) === "name"
      );

      if (hasTh || looksLikeHeader) {
        headers = firstRowText;
        rows = [...allRows].slice(1).map((tr) =>
          [...tr.querySelectorAll("td, th")].map(getCellText)
        );
      } else {
        const colCount = firstRowText.length;
        headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
        rows = [...allRows].map((tr) =>
          [...tr.querySelectorAll("td, th")].map(getCellText)
        );
      }
    }

    rows = rows.filter((row) => row.some((cell) => cell.trim()));
    if (headers.length === 0 || rows.length === 0) return null;

    return { headers, rows };
  }

  function extractHtmlTables() {
    const tables = document.querySelectorAll("table");
    if (tables.length === 0) return null;

    let best = null;
    let bestScore = 0;

    for (const table of tables) {
      const data = extractTableData(table);
      if (!data) continue;
      const score = data.rows.length * data.headers.length;
      if (score > bestScore) {
        bestScore = score;
        best = data;
      }
    }

    if (!best) return null;

    return {
      source: "html-table",
      headers: best.headers,
      rows: best.rows,
      warning: null,
    };
  }

  function extractDomScrape() {
    const emailEntries = [];
    const seen = new Set();

    function addEmail(email, context = "") {
      const norm = extractEmailFromCell(email);
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      emailEntries.push({ email: norm, context: String(context || "").trim().slice(0, 120) });
    }

    document.querySelectorAll('a[href^="mailto:"]').forEach((anchor) => {
      const href = (anchor.getAttribute("href") || "")
        .replace(/^mailto:/i, "")
        .split("?")[0]
        .trim();
      if (href) addEmail(href, anchor.textContent.trim());
    });

    document.querySelectorAll('input[type="email"], input[name*="email" i]').forEach((input) => {
      if (input.value) addEmail(input.value);
    });

    document.querySelectorAll("[href],[title],[aria-label],[data-email]").forEach((el) => {
      for (const attr of ["href", "title", "aria-label", "data-email"]) {
        const val = el.getAttribute(attr);
        if (!val || !val.includes("@")) continue;
        extractEmailsFromText(val).forEach((e) => addEmail(e, val));
      }
    });

    const root = document.body;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent;
        if (!text || !text.includes("@")) continue;
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
        extractEmailsFromText(text).forEach((e) => addEmail(e, text.trim()));
      }
    }

    if (emailEntries.length === 0) return null;

    return {
      source: "dom-scrape",
      headers: ["email", "context"],
      rows: emailEntries.map((e) => [e.email, e.context]),
      warning: null,
    };
  }

  function extractPlainText() {
    const text = document.body?.innerText || "";
    const emails = extractEmailsFromText(text);

    if (emails.length === 0) return null;

    return {
      source: "plain-text",
      headers: ["email"],
      rows: emails.map((email) => [email]),
      warning: null,
    };
  }

  const SOURCE_LABELS = {
    "google-sheets": "Google Sheets",
    "google-sheets-ocr": "MailMiner OCR",
    "html-table": "HTML Table",
    "dom-scrape": "DOM Scrape",
    "plain-text": "Plain Text",
  };

  function extractPageData() {
    const extractors = [extractGoogleSheets, extractHtmlTables, extractDomScrape, extractPlainText];
    let fallback = null;

    for (const extract of extractors) {
      const result = extract();
      if (!result || result.rows.length === 0) continue;

      if (result.source === "plain-text" || result.source === "dom-scrape") {
        const emails = result.rows.map((row) => extractEmailFromCell(row[0])).filter(Boolean);
        if (emails.length > 0) return result;
        fallback ??= result;
        continue;
      }

      const emailColIdx = findEmailColumnIndex(result.headers, result.rows);
      if (emailColIdx !== -1 && countEmailsInData(result.headers, result.rows) > 0) {
        return result;
      }

      fallback ??= result;
    }

    return fallback;
  }

  const data = extractPageData();

  if (!data) {
    const onSheets =
      location.hostname.includes("docs.google.com") &&
      location.pathname.includes("/spreadsheets/");
    const hasGrid = !!document.querySelector(
      "#grid-container, #waffle-grid-container, [role='grid']"
    );
    if (onSheets && hasGrid && window.top === window.self) {
      chrome.runtime.sendMessage({
        success: false,
        error: "No emails or table data found on this page.",
      });
    }
    return;
  }

  const emails =
    data.source === "plain-text" || data.source === "dom-scrape"
      ? data.rows.map((r) => extractEmailFromCell(r[0])).filter(Boolean)
      : getUniqueEmails(data);

  const emailColIdx =
    data.source === "plain-text" || data.source === "dom-scrape"
      ? 0
      : findEmailColumnIndex(data.headers, data.rows);

  if (emailColIdx === -1 && data.source !== "plain-text" && data.source !== "dom-scrape") {
    chrome.runtime.sendMessage({
      success: false,
      error: "No email column detected in the table data.",
    });
    return;
  }

  chrome.runtime.sendMessage({
    success: true,
    data: {
      source: data.source,
      sourceLabel: SOURCE_LABELS[data.source] || data.source,
      headers: data.headers,
      rows: data.rows,
      emailCount: emails.length,
      rowCount: data.rows.length,
      warning: data.warning,
    },
  });
})();

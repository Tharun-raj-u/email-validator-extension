function getSheetCellText(cell) {
  const candidates = [];

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

  const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  for (const c of candidates) {
    if (emailPattern.test(c)) {
      const match = c.match(emailPattern);
      if (match) return match[0];
    }
  }

  for (const c of candidates) {
    if (c && !/^[A-Z]{1,4}\d+$/.test(c)) return c;
  }

  return candidates[0] || "";
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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
  }

  return -1;
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

export function extractGoogleSheets() {
  if (!location.hostname.includes("docs.google.com") || !location.pathname.includes("/spreadsheets/")) {
    return null;
  }

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

  let headers = nonEmptyRows[0];
  let rows = nonEmptyRows.slice(1);

  const maxCols = Math.max(
    headers.length,
    ...rows.map((row) => row.length)
  );
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

  const emailColIdx = findEmailColumnByLayout(headers);
  if (emailColIdx !== -1 && colIndices[emailColIdx] != null) {
    const ariaCol = colIndices[emailColIdx];
    const headerRowIdx = rowIndices[0];
    const gridCells = grid.querySelectorAll('[role="gridcell"]');

    for (const cell of gridCells) {
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

      const dataRowIndex = rowIndices.indexOf(rowIdx) - 1;
      if (dataRowIndex < 0 || dataRowIndex >= rows.length) continue;

      const text = getSheetCellText(cell);
      if (text) rows[dataRowIndex][emailColIdx] = text;
    }
  }

  const ariaRowCount = grid.getAttribute("aria-rowcount");
  const totalRows = ariaRowCount ? parseInt(ariaRowCount, 10) : null;
  const warning =
    totalRows && rows.length + 1 < totalRows
      ? `Only ${rows.length} data rows are visible in the DOM (${totalRows} total). Scroll the sheet to load more rows before scanning.`
      : null;

  return {
    source: "google-sheets",
    headers,
    rows,
    warning,
  };
}

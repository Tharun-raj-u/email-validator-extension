import { normalizeHeader } from "../csv.js";

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

export function extractHtmlTables() {
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

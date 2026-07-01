/**
 * Parses Google Sheets embedded bootstrapData (Ritz chunk format).
 * Used when the grid is canvas-rendered and DOM cells have no text.
 */
(function (global) {
  function parseBootstrapCell(cellWrapper) {
    if (!Array.isArray(cellWrapper) || cellWrapper.length === 0) return "";
    const obj = cellWrapper[0];
    if (!obj || typeof obj !== "object") return "";
    const raw = obj["3"];
    if (Array.isArray(raw) && raw.length >= 2 && raw[0] === 2) {
      return String(raw[1] ?? "");
    }
    return "";
  }

  function extractBootstrapObjectFromText(text) {
    const marker = "bootstrapData = ";
    const start = text.indexOf(marker);
    if (start === -1) return null;

    let i = start + marker.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  function findChunkPayload(firstchunk) {
    if (!Array.isArray(firstchunk)) return null;
    for (const entry of firstchunk) {
      if (!Array.isArray(entry)) continue;
      for (const part of entry) {
        if (typeof part === "string" && part.includes('"3":[2,')) {
          return part;
        }
      }
    }
    return null;
  }

  function isCellsFlatArray(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return false;
    let cellLike = 0;
    for (let k = 0; k < Math.min(8, arr.length); k++) {
      const wrapper = arr[k];
      if (!Array.isArray(wrapper)) continue;
      if (wrapper.length === 0) {
        cellLike++;
        continue;
      }
      const obj = wrapper[0];
      if (obj && typeof obj === "object" && ("3" in obj || "2" in obj)) {
        cellLike++;
      }
    }
    return cellLike >= 2;
  }

  function findCellsArray(gridData) {
    if (!Array.isArray(gridData)) return null;
    for (let i = gridData.length - 1; i >= 0; i--) {
      const item = gridData[i];
      if (isCellsFlatArray(item)) return item;
    }
    return null;
  }

  function getColumnCount(meta, cellsFlat, values) {
    if (Array.isArray(meta) && meta.length >= 5 && typeof meta[4] === "number" && meta[4] > 0) {
      return meta[4];
    }
    if (Array.isArray(meta) && meta.length >= 4 && typeof meta[3] === "number" && meta[3] > 0) {
      return meta[3];
    }
    for (const n of [3, 4, 5, 6, 8, 10]) {
      if (values.length % n === 0 && n >= 2) return n;
    }
    return 3;
  }

  function parseBootstrapData(bootstrapData, expectedGridId) {
    if (!bootstrapData?.changes?.firstchunk) return null;

    const gridId = bootstrapData.gridId;
    if (expectedGridId != null && gridId != null && String(gridId) !== String(expectedGridId)) {
      return null;
    }

    const chunkStr = findChunkPayload(bootstrapData.changes.firstchunk);
    if (!chunkStr) return null;

    let gridData;
    try {
      gridData = JSON.parse(chunkStr);
    } catch {
      return null;
    }

    if (!Array.isArray(gridData) || gridData.length === 0) return null;

    const meta = Array.isArray(gridData[0]) ? gridData[0] : null;
    const cellsFlat = findCellsArray(gridData);
    if (!cellsFlat || cellsFlat.length === 0) return null;

    const values = cellsFlat.map(parseBootstrapCell);
    const numCols = getColumnCount(meta, cellsFlat, values);

    const matrixRows = [];
    for (let i = 0; i < values.length; i += numCols) {
      matrixRows.push(values.slice(i, i + numCols));
    }

    const nonEmpty = matrixRows.filter((row) => row.some((c) => String(c).trim()));
    if (nonEmpty.length === 0) return null;

    const totalRows = meta && typeof meta[2] === "number" ? meta[2] : null;
    const dataRowCount = nonEmpty.length > 1 ? nonEmpty.length - 1 : nonEmpty.length;

    return {
      rows: nonEmpty,
      totalRows,
      dataRowCount,
      numCols,
      gridId,
    };
  }

  function getActiveGridIdFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const gid = params.get("gid");
      if (gid) return gid;
      const hash = location.hash || "";
      const m = hash.match(/gid=(\d+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function extractBootstrapFromDocument(doc) {
    const documentRef = doc || (typeof document !== "undefined" ? document : null);
    if (!documentRef) return null;

    const expectedGridId = getActiveGridIdFromUrl();
    let best = null;

    function consider(bootstrapData) {
      if (!bootstrapData) return;
      let parsed = parseBootstrapData(bootstrapData, expectedGridId);
      if (!parsed) parsed = parseBootstrapData(bootstrapData, null);
      if (!parsed) return;
      if (!best || parsed.dataRowCount > best.dataRowCount) {
        best = parsed;
      }
    }

    if (typeof window !== "undefined" && window.bootstrapData) {
      consider(window.bootstrapData);
    }

    for (const script of documentRef.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      if (!text || !text.includes("bootstrapData")) continue;
      consider(extractBootstrapObjectFromText(text));
    }

    return best;
  }

  const api = {
    parseBootstrapCell,
    parseBootstrapData,
    extractBootstrapObjectFromText,
    extractBootstrapFromDocument,
    getActiveGridIdFromUrl,
  };

  global.SheetsBootstrap = api;
})(typeof globalThis !== "undefined" ? globalThis : self);

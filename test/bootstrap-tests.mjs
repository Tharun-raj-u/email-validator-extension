import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadSheetsBootstrap() {
  const code = readFileSync(new URL("../scripts/sheets-bootstrap.js", import.meta.url), "utf8");
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.globalThis.SheetsBootstrap;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const SheetsBootstrap = loadSheetsBootstrap();

// Minimal Ritz chunk matching Name | Email | Phone + one data row
const chunkInner = JSON.stringify([
  ["1942422933", 0, 37, 0, 3],
  [{ 2: [[{ 1: 67108350 }]] }],
  null,
  [
    [{ 2: 3, 3: [2, "Name"], 6: 0 }],
    [{ 2: 3, 3: [2, "Email"], 6: 0 }],
    [{ 2: 3, 3: [2, "Phone"], 6: 0 }],
    [{ 2: 3, 3: [2, "Anuja Mangal"], 6: 0 }],
    [{ 2: 3, 3: [2, "anuja@epergnesolutions.com"], 6: 0 }],
    [],
  ],
]);

const bootstrapData = {
  gridId: 1942422933,
  changes: { firstchunk: [[25813757, chunkInner]] },
};

const parsed = SheetsBootstrap.parseBootstrapData(bootstrapData, "1942422933");
assert(parsed, "Should parse bootstrap chunk");
assert(parsed.rows.length === 2, `Expected header + 1 row, got ${parsed.rows.length}`);
assert(parsed.rows[0][1] === "Email", "Second header should be Email");
assert(parsed.rows[1][1] === "anuja@epergnesolutions.com", "Should parse email cell");
assert(parsed.numCols === 3, "Should detect 3 columns from meta");
assert(parsed.totalRows === 37, "Should read total row count from meta");

const wrongGid = SheetsBootstrap.parseBootstrapData(bootstrapData, "999");
assert(wrongGid === null, "Should reject mismatched grid id");

const anyGid = SheetsBootstrap.parseBootstrapData(bootstrapData, null);
assert(anyGid?.rows?.length === 2, "Should parse when grid id filter is null");

const cellText = SheetsBootstrap.parseBootstrapCell([{ 2: 3, 3: [2, "test@x.com"], 6: 0 }]);
assert(cellText === "test@x.com", "parseBootstrapCell should extract string value");

const emptyCell = SheetsBootstrap.parseBootstrapCell([]);
assert(emptyCell === "", "Empty cell wrapper should be blank");

console.log("Bootstrap tests passed.");

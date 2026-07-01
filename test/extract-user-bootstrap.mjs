import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transcriptPath =
  "C:/Users/Administrator/.cursor/projects/c-Users-Administrator-Desktop-first-extension/agent-transcripts/462cbfd2-6326-4d76-bf91-efe2d2f4d75c/462cbfd2-6326-4d76-bf91-efe2d2f4d75c.jsonl";

const bootstrapPath = path.join(__dirname, "fixtures", "user-bootstrap.js");

function extractBootstrapJsonFromTranscript() {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  let html = null;
  for (const line of lines) {
    if (!line.includes("var bootstrapData = {")) continue;
    try {
      const record = JSON.parse(line);
      const text =
        record.message?.content?.find((c) => c.type === "text")?.text ||
        record.content?.find?.((c) => c.type === "text")?.text;
      if (text && text.includes("var bootstrapData = {")) {
        html = text;
        break;
      }
    } catch {
      html = line;
      break;
    }
  }
  if (!html) throw new Error("bootstrap line not found in transcript");

  const marker = "var bootstrapData = ";
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error("bootstrap marker not found");
  let i = idx + marker.length;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== "{") throw new Error("expected object");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
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
        return html.slice(i, j + 1);
      }
    }
  }
  throw new Error("unclosed object");
}

function writeFixture(json) {
  fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
  fs.writeFileSync(bootstrapPath, `var bootstrapData = ${json};\n`);
}

const forceRegenerate = process.argv.includes("--regenerate");
if (forceRegenerate || !fs.existsSync(bootstrapPath)) {
  const json = extractBootstrapJsonFromTranscript();
  writeFixture(json);
  console.log("Wrote fixture", bootstrapPath, "bytes", json.length);
} else {
  const probe = fs.readFileSync(bootstrapPath, "utf8");
  if (probe.includes('\\"structure\\"') || probe.includes('{\\"')) {
    const json = extractBootstrapJsonFromTranscript();
    writeFixture(json);
    console.log("Rewrote fixture (fixed escaping)", bootstrapPath);
  }
}

import vm from "node:vm";

function loadSheetsBootstrap() {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "sheets-bootstrap.js"),
    "utf8"
  );
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.globalThis.SheetsBootstrap;
}

const SheetsBootstrap = loadSheetsBootstrap();

const scriptText = fs.readFileSync(bootstrapPath, "utf8");
const obj = SheetsBootstrap.extractBootstrapObjectFromText(scriptText);
if (!obj) {
  console.error("extractBootstrapObjectFromText failed");
  process.exit(1);
}

const parsed = SheetsBootstrap.parseBootstrapData(obj, "1942422933");
if (!parsed) {
  console.error("parseBootstrapData failed");
  process.exit(1);
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let emailCol = -1;
const header = parsed.rows[0] || [];
header.forEach((h, i) => {
  if (String(h).toLowerCase() === "email") emailCol = i;
});

const emails = parsed.rows
  .slice(1)
  .map((r) => (emailCol >= 0 ? r[emailCol] : ""))
  .filter((e) => emailRegex.test(String(e).trim()));

console.log({
  gridId: parsed.gridId,
  totalRows: parsed.totalRows,
  dataRowCount: parsed.dataRowCount,
  parsedRowCount: parsed.rows.length,
  header,
  emailCount: emails.length,
  sample: emails.slice(0, 3),
});

if (emails.length < 30) {
  console.error("Expected ~36 emails, got", emails.length);
  process.exit(1);
}

console.log("User bootstrap integration OK");

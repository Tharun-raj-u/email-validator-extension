import {
  findEmailColumnIndex,
  insertValidColumn,
  buildCsv,
  buildOutputText,
  buildOutputCsv,
  buildOutputJson,
  getUniqueEmails,
  extractEmailsFromText,
  limitEmailList,
} from "../scripts/csv.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// findEmailColumnIndex by header name
const headers1 = ["name", "email", "contact"];
const rows1 = [
  ["John", "john@example.com", "123"],
  ["Jane", "jane@gmail.com", "456"],
];
assert(findEmailColumnIndex(headers1, rows1) === 1, "Should find email column by header");

// Google Sheets style headers (capitalized)
const headersGs = ["Name", "Email", "Phone"];
assert(findEmailColumnIndex(headersGs, rows1) === 1, "Should find Email column (capitalized)");

// Name + blank + Phone layout
const headersLusha = ["Name", "", "Phone"];
const rowsLusha = [
  ["Anuja Mangal", "anuja@epergnesolutions.com", ""],
];
assert(findEmailColumnIndex(headersLusha, rowsLusha) === 1, "Should detect email col between Name and Phone");

// insertValidColumn preserves order
const validationMap = new Map([
  ["john@example.com", "unknown"],
  ["jane@gmail.com", "invalid"],
]);
const merged = insertValidColumn(headers1, rows1, 1, validationMap);
assert(
  merged.headers.join(",") === "name,email,valid,contact",
  `Headers wrong: ${merged.headers.join(",")}`
);
assert(merged.rows[0][2] === "unknown", "First row valid status");
assert(merged.rows[1][2] === "invalid", "Second row valid status");
assert(merged.rows[0][3] === "123", "Contact column preserved");

// buildCsv has BOM
const csv = buildCsv(merged.headers, merged.rows);
assert(csv.charCodeAt(0) === 0xfeff, "CSV should have UTF-8 BOM");

// plain text extraction
const emails = extractEmailsFromText("Contact: a@b.com and c@d.org and a@b.com");
assert(emails.length === 2, "Should dedupe emails");

// buildOutputCsv plain text
const plainData = {
  source: "plain-text",
  headers: ["email"],
  rows: [["a@b.com"], ["c@d.org"]],
};
const plainCsv = buildOutputCsv(plainData, validationMap);
assert(plainCsv.includes("email,valid"), "Plain text CSV headers");

// buildOutputText plain text
const plainTxt = buildOutputText(plainData, validationMap);
assert(plainTxt.includes("email\tvalid"), "Plain text TXT headers");
assert(plainTxt.includes("a@b.com"), "Plain text TXT email");

// pasted-input behaves like plain text
const pastedData = {
  source: "pasted-input",
  headers: ["email"],
  rows: [["x@y.com"], ["z@w.org"]],
};
assert(getUniqueEmails(pastedData).length === 2, "Pasted input should return unique emails");
assert(buildOutputCsv(pastedData, validationMap).includes("email,valid"), "Pasted input CSV headers");

// getUniqueEmails dedupes
const unique = getUniqueEmails({ headers: headers1, rows: rows1, source: "html-table" });
assert(unique.length === 2, "Should return 2 unique emails");

// buildOutputJson
const jsonOut = buildOutputJson(plainData, validationMap, { emailsValidated: 2 });
const parsed = JSON.parse(jsonOut);
assert(parsed.headers.includes("valid"), "JSON should include valid column");
assert(parsed.rows.length === 2, "JSON rows count");

// limitEmailList
assert(limitEmailList(["a@b.com", "c@d.org", "e@f.com"], 2).length === 2, "Should limit emails");
assert(limitEmailList(["a@b.com"], 0).length === 1, "Zero limit means all");

console.log("All tests passed.");

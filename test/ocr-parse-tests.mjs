import {
  parseOcrTextToTable,
  parseLineToCells,
} from "../scripts/ocr-parse.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sampleOcr = `
Name Email Phone
John Doe john@example.com 555-0100
Jane Smith jane@gmail.com 555-0200
`;

const parsed = parseOcrTextToTable(sampleOcr);
assert(parsed, "Should parse OCR sample");
assert(parsed.source === "google-sheets-ocr", "Source should be google-sheets-ocr");
assert(parsed.rows.length === 2, `Expected 2 data rows, got ${parsed.rows.length}`);
assert(parsed.rows[0][1] === "john@example.com", "Should extract email from row 1");
assert(parsed.warning?.includes("visible"), "Should include viewport warning");

const tabSeparated = parseOcrTextToTable(
  "Name\tEmail\tPhone\nAnuja\tanuja@test.com\t123"
);
assert(tabSeparated?.rows.length === 1, "Should parse tab-separated OCR");
assert(tabSeparated.rows[0][1] === "anuja@test.com", "Tab-separated email");

const noisy = parseOcrTextToTable(`
1
A
Name Email Phone
2
Bob bob@test.org 999
`);
assert(noisy?.rows.length === 1, "Should skip noise lines");
assert(noisy.rows[0].some((c) => c.includes("bob@test.org")), "Should find email after noise");

const splitLines = parseOcrTextToTable(`
First name Middle name Last name Email Job posting title
Visshnu
Vyshag
vishnuvyshag@gmail.com
Sr. Talent Acquisition Specialist
Sruthi
J
shruthijeyapandian98@gmail.com
HR - People Operations
`);
assert(splitLines, "Should parse OCR output where fields are split across lines");
assert(splitLines.rows.length === 2, `Expected 2 split-line rows, got ${splitLines?.rows.length}`);
assert(splitLines.rows[0].some((c) => c.includes("vishnuvyshag@gmail.com")), "Should keep first split-line email");
assert(splitLines.rows[1].some((c) => c.includes("shruthijeyapandian98@gmail.com")), "Should keep second split-line email");

const intactNames = parseOcrTextToTable(`
Name Email
Anuja Mangal anuja@epergnesolutions.com
Bhavya Talach rinam@fx31labs.com
`);
assert(intactNames, "Should parse simple OCR rows with names");
assert(intactNames.headers[0] === "Name", `Header should stay intact, got ${intactNames?.headers[0]}`);
assert(intactNames.rows[0][0] === "Anuja Mangal", `Name should stay intact, got ${intactNames?.rows[0][0]}`);
assert(intactNames.rows[1][0] === "Bhavya Talach", `Second name should stay intact, got ${intactNames?.rows[1][0]}`);

const cells = parseLineToCells("Anuja Mangal anuja@x.com 555");
assert(cells.length >= 2, "parseLineToCells should split around email");
assert(cells.some((c) => c.includes("@")), "Should include email cell");

assert(parseOcrTextToTable("") === null, "Empty text returns null");
assert(parseOcrTextToTable("no emails here") === null, "No emails returns null");

console.log("OCR parse tests passed.");

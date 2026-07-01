import { validateEmail, validateEmails } from "../scripts/validator.js";

const status = await validateEmail("john@example.com");
console.log("Single validation:", status);
if (!["valid", "invalid", "unknown", "error"].includes(status)) {
  throw new Error(`Unexpected status: ${status}`);
}

let lastProgress = null;
const results = await validateEmails(
  ["john@example.com", "notreal@fakeinvalid99999xyz.com"],
  (completed, total) => {
    lastProgress = { completed, total };
  }
);

console.log("Batch results:", Object.fromEntries(results));
console.log("Last progress:", lastProgress);

if (results.size !== 2) throw new Error("Expected 2 results");
if (!lastProgress || lastProgress.completed !== 2) throw new Error("Progress not reported");

console.log("Validator tests passed.");

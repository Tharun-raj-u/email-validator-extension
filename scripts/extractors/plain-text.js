import { extractEmailsFromText } from "../csv.js";

export function extractPlainText() {
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

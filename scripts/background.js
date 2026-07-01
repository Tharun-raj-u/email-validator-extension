import { validateEmails } from "./validator.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "VALIDATE_EMAILS") {
    const options = message.options || {};
    validateEmails(
      message.emails,
      (completed, total) => {
        chrome.runtime.sendMessage({
          type: "VALIDATION_PROGRESS",
          completed,
          total,
        }).catch(() => {});
      },
      {
        concurrency: options.concurrency,
        batchSize: options.batchSize,
        onBatch: (batchIndex, batchCount, batchLength) => {
          chrome.runtime.sendMessage({
            type: "VALIDATION_BATCH",
            batchIndex,
            batchCount,
            batchLength,
          }).catch(() => {});
        },
      }
    )
      .then((results) => {
        const map = Object.fromEntries(results);
        sendResponse({ success: true, results: map });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

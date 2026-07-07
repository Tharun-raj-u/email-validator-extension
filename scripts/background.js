import { validateEmails } from "./validator.js";
import { OCR_API_URL, OCR_SPACE_API_KEY } from "./config.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OCR_REQUEST") {
    // Fetch is done here (background service worker) to bypass CORS restrictions.
    const dataUrl = message.dataUrl;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const formData = new FormData();
        formData.append("file", blob, "capture.png");
        return fetch(OCR_API_URL, { method: "POST", body: formData, referrerPolicy: "no-referrer" });
      })
      .then((r) => {
        if (!r.ok) throw new Error(`OCR worker failed: HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const text = typeof json === "string" ? json : (json.text || json.result || "");
        sendResponse({ success: true, text });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

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

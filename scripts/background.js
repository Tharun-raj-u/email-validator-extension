import { validateEmails } from "./validator.js";
import { OCR_API_URL } from "./config.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OCR_REQUEST") {
    const dataUrl = message.dataUrl;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const formData = new FormData();
        formData.append("image", blob, "capture.png");
        return fetch(OCR_API_URL, {
          method: "POST",
          body: formData,
          referrerPolicy: "no-referrer",
        });
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`OCR worker failed: HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await response.json();
          return typeof json === "string"
            ? json
            : json.text || json.result || "";
        }
        return response.text();
      })
      .then((text) => {
        sendResponse({ success: true, text: text || "" });
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
        batchSize: options.batchSize,
        emailsPerSec: options.emailsPerSec,
        onBatch: (batchIndex, batchCount, batchLength, meta) => {
          chrome.runtime.sendMessage({
            type: "VALIDATION_BATCH",
            batchIndex,
            batchCount,
            batchLength,
            emailsPerSec: meta?.emailsPerSec,
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

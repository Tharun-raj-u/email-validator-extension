import {
  VALIDATOR_API_URL,
  VALIDATION_BATCH_SIZE,
  VALIDATION_EMAILS_PER_SEC,
} from "./config.js";

const API_URL = VALIDATOR_API_URL;
const DEFAULT_BATCH_SIZE = Math.max(1, VALIDATION_BATCH_SIZE || 100);
const DEFAULT_EMAILS_PER_SEC = Math.max(1, VALIDATION_EMAILS_PER_SEC || 100);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function validateEmail(email) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (response.status === 422) {
      return "invalid";
    }

    if (!response.ok) {
      return "error";
    }

    const data = await response.json();
    return data.validation_status || "unknown";
  } catch {
    return "error";
  }
}

export async function validateEmails(emails, onProgress, options = {}) {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const emailsPerSec = Math.max(1, options.emailsPerSec ?? DEFAULT_EMAILS_PER_SEC);
  const batchDelayMs = Math.ceil((batchSize / emailsPerSec) * 1000);
  const onBatch = options.onBatch;
  const cache = new Map();
  const uniqueEmails = [];
  const seen = new Set();
  for (const email of emails) {
    const key = String(email || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueEmails.push(key);
  }

  let completed = 0;
  const total = uniqueEmails.length;

  async function validateBatch(batch) {
    await Promise.all(
      batch.map(async (email) => {
        if (cache.has(email)) {
          completed++;
          onProgress?.(completed, total);
          return;
        }

        const status = await validateEmail(email);
        cache.set(email, status);
        completed++;
        onProgress?.(completed, total);
      })
    );
  }

  const batches = [];
  for (let i = 0; i < uniqueEmails.length; i += batchSize) {
    batches.push(uniqueEmails.slice(i, i + batchSize));
  }

  for (let i = 0; i < batches.length; i++) {
    await validateBatch(batches[i]);
    onBatch?.(i + 1, batches.length, batches[i].length, {
      batchSize,
      emailsPerSec,
      batchDelayMs,
    });
    if (i < batches.length - 1 && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
  }

  for (const email of emails) {
    const key = String(email || "").trim().toLowerCase();
    if (!key || cache.has(key)) continue;
    cache.set(key, "error");
  }

  return cache;
}

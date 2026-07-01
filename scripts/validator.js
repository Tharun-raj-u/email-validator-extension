import { VALIDATOR_API_URL } from "./config.js";

const API_URL = VALIDATOR_API_URL;
const DEFAULT_CONCURRENCY = 100;

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
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const batchSize = Math.max(0, options.batchSize ?? 0);
  const onBatch = options.onBatch;
  const cache = new Map();
  let completed = 0;
  const total = emails.length;

  async function validateBatch(batch) {
    const queue = [...batch];

    async function worker() {
      while (queue.length > 0) {
        const email = queue.shift();
        if (!email || cache.has(email)) {
          completed++;
          onProgress?.(completed, total);
          continue;
        }

        const status = await validateEmail(email);
        cache.set(email, status);
        completed++;
        onProgress?.(completed, total);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, batch.length || 1) },
      () => worker()
    );
    await Promise.all(workers);
  }

  if (batchSize > 0 && emails.length > batchSize) {
    const batches = [];
    for (let i = 0; i < emails.length; i += batchSize) {
      batches.push(emails.slice(i, i + batchSize));
    }
    for (let i = 0; i < batches.length; i++) {
      await validateBatch(batches[i]);
      onBatch?.(i + 1, batches.length, batches[i].length);
    }
  } else {
    await validateBatch(emails);
  }

  return cache;
}

const defaults = {
  VALIDATOR_API_URL: "https://validator-api.fsgarage.in/api/v1/validate/email",
  OCR_API_URL: "https://hackathon-ocr-worker-3.dygkh7.easypanel.host/ocr",
  VALIDATION_BATCH_SIZE: 100,
  VALIDATION_EMAILS_PER_SEC: 100,
};

let localConfig = {};
try {
  localConfig = (await import("./config.local.js")).default || {};
} catch {
  // Optional overrides file — safe to omit in production packages.
}

const config = {
  ...defaults,
  ...localConfig,
};

export const VALIDATOR_API_URL =
  config.VALIDATOR_API_URL || defaults.VALIDATOR_API_URL;
export const OCR_API_URL = config.OCR_API_URL || defaults.OCR_API_URL;
export const VALIDATION_BATCH_SIZE =
  config.VALIDATION_BATCH_SIZE ?? defaults.VALIDATION_BATCH_SIZE;
export const VALIDATION_EMAILS_PER_SEC =
  config.VALIDATION_EMAILS_PER_SEC ?? defaults.VALIDATION_EMAILS_PER_SEC;

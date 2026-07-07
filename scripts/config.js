import localConfig from "./config.local.js";

const defaults = {
  VALIDATOR_API_URL: "https://validator-api.fsgarage.in/api/v1/validate/email",
  OCR_API_URL: "https://hackathon-ocr-worker-1.dygkh7.easypanel.host/file",
  // Set OCR_SPACE_API_KEY in config.local.js to use OCR.space locally instead.
  OCR_SPACE_API_KEY: "",
};

const config = {
  ...defaults,
  ...(localConfig || {}),
};

export const VALIDATOR_API_URL =
  config.VALIDATOR_API_URL || defaults.VALIDATOR_API_URL;
export const OCR_API_URL = config.OCR_API_URL || defaults.OCR_API_URL;
export const OCR_SPACE_API_KEY = config.OCR_SPACE_API_KEY || "";
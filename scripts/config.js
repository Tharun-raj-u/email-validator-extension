import localConfig from "./config.local.js";

const defaults = {
  OCR_SPACE_API_KEY: "K83240098288957",
  VALIDATOR_API_URL: "https://validator-api.fsgarage.in/api/v1/validate/email",
};

const config = {
  ...defaults,
  ...(localConfig || {}),
};

export const OCR_SPACE_API_KEY = config.OCR_SPACE_API_KEY || defaults.OCR_SPACE_API_KEY;
export const VALIDATOR_API_URL =
  config.VALIDATOR_API_URL || defaults.VALIDATOR_API_URL;
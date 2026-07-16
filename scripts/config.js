/**
 * Runtime settings — edit scripts/config.json only.
 * manifest.json still needs matching host_permissions + oauth2.client_id (Chrome).
 */
import cfg from "./config.json" with { type: "json" };

function requireString(key) {
  const value = String(cfg[key] ?? "").trim();
  if (!value) {
    throw new Error(`config.json missing required string: ${key}`);
  }
  return value;
}

function requirePositiveInt(key) {
  const value = Number(cfg[key]);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`config.json missing required positive number: ${key}`);
  }
  return Math.floor(value);
}

export const VALIDATOR_API_URL = requireString("validatorApiUrl");
export const OCR_API_URL = requireString("ocrApiUrl");
export const VALIDATION_BATCH_SIZE = requirePositiveInt("validationBatchSize");
export const VALIDATION_EMAILS_PER_SEC = requirePositiveInt("validationEmailsPerSec");
export const VALIDATION_INVALID_HTTP_STATUS = requirePositiveInt(
  "validationInvalidHttpStatus"
);
export const GOOGLE_OAUTH_CLIENT_ID = requireString("googleOauthClientId");
export const SHEETS_API_BASE = requireString("sheetsApiBase");
export const GOOGLE_SHEETS_DOC_BASE = requireString("googleSheetsDocBase");
export const GOOGLE_USERINFO_URL = requireString("googleUserInfoUrl");
export const GOOGLE_OAUTH_AUTH_URL = requireString("googleOAuthAuthUrl");
export const GOOGLE_OAUTH_REVOKE_URL = requireString("googleOAuthRevokeUrl");
export const SIGN_IN_TIMEOUT_MS = requirePositiveInt("signInTimeoutMs");
export const DEFAULT_SPREADSHEET_TITLE = requireString("defaultSpreadsheetTitle");
export const DEFAULT_WORKSHEET_NAME = requireString("defaultWorksheetName");

/** @param {string} spreadsheetId */
export function spreadsheetDocUrl(spreadsheetId) {
  return `${GOOGLE_SHEETS_DOC_BASE}/${spreadsheetId}`;
}

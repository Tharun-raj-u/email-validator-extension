/**
 * Google OAuth with account picker (launchWebAuthFlow).
 * Redirect URI is built from chrome.runtime.id via getRedirectURL().
 * Prefer running signIn() from the service worker (popup → GOOGLE_SIGN_IN)
 * so the popup closing does not cancel the Google window.
 */

import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_USERINFO_URL,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  SIGN_IN_TIMEOUT_MS,
} from "./config.js";

const PROFILE_KEY = "googleAuthProfile";
const TOKEN_KEY = "googleAccessToken";
const SIGNED_OUT_KEY = "googleAuthUserSignedOut";

export function getExtensionId() {
  return chrome.runtime.id;
}

export function getOAuthRedirectUri() {
  return chrome.identity.getRedirectURL();
}

/**
 * Client ID for launchWebAuthFlow only (from config.json).
 * Do NOT fall back to manifestoAuth Chrome Extension client — that causes redirect_uri_mismatch.
 */
export function getConfiguredClientId() {
  return String(GOOGLE_OAUTH_CLIENT_ID || "").trim();
}

function getOAuthScopes() {
  return chrome.runtime.getManifest()?.oauth2?.scopes || [];
}

function isCancelError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("canceled") ||
    msg.includes("cancelled") ||
    msg.includes("the user did not approve") ||
    msg.includes("authorization page could not be loaded") ||
    msg.includes("timed out")
  );
}

function normalizeAuthError(err) {
  const raw = String(err?.message || err || "Authentication failed.");
  const lower = raw.toLowerCase();

  if (lower.includes("redirect_uri")) {
    const id = getExtensionId();
    const redirect = getOAuthRedirectUri();
    const err = new Error(
      `Google rejected the redirect URI (Error 400: redirect_uri_mismatch). ` +
        `Fix Cloud Console for client ${getConfiguredClientId()}: ` +
        `(1) Chrome Extension type → set Item ID to “${id}”, OR ` +
        `(2) create a Web application client and add Authorized redirect URI: ${redirect} — then put that Web Client ID in config.json as googleOauthClientId.`
    );
    err.code = "REDIRECT_URI_MISMATCH";
    err.extensionId = id;
    err.redirectUri = redirect;
    return err;
  }

  if (isCancelError(err)) {
    if (/timed out/i.test(raw)) {
      return new Error(
        "Sign-in timed out. Check for a Google window behind Chrome, then try again."
      );
    }
    return new Error("Sign-in was cancelled.");
  }


  if (lower.includes("access_denied") || lower.includes("access denied")) {
    return new Error(
      "Google blocked sign-in. Add your Gmail under OAuth consent screen → Test users."
    );
  }
  if (lower.includes("oauth2") || lower.includes("bad client")) {
    return new Error(
      "OAuth is misconfigured. Check Client ID in config.json and manifest.json."
    );
  }
  return new Error(raw);
}

async function isUserSignedOut() {
  try {
    const stored = await chrome.storage.local.get(SIGNED_OUT_KEY);
    return stored[SIGNED_OUT_KEY] === true;
  } catch {
    return false;
  }
}

async function setUserSignedOut(signedOut) {
  await chrome.storage.local.set({ [SIGNED_OUT_KEY]: Boolean(signedOut) });
}

async function saveAccessToken(token) {
  if (!token) {
    await chrome.storage.local.remove(TOKEN_KEY);
    return;
  }
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

async function readAccessToken() {
  try {
    const stored = await chrome.storage.local.get(TOKEN_KEY);
    return stored[TOKEN_KEY] || null;
  } catch {
    return null;
  }
}

async function revokeGoogleToken(token) {
  if (!token) return;
  try {
    await fetch(
      `${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  } catch {
    /* ignore */
  }
  if (typeof chrome.identity.removeCachedAuthToken === "function") {
    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch {
      /* ignore */
    }
  }
}

async function clearIdentityCache() {
  if (typeof chrome.identity.clearAllCachedAuthTokens === "function") {
    try {
      await chrome.identity.clearAllCachedAuthTokens();
    } catch {
      /* ignore */
    }
  }
}

/** Drop stored Sheets/OAuth session so nothing uses a cached token while signed out. */
async function clearSession({ revoke = true, signedOut = true } = {}) {
  const token = revoke ? await readAccessToken() : null;
  if (revoke && token) {
    await revokeGoogleToken(token);
  }
  await saveAccessToken(null);
  await saveProfile(null);
  await setUserSignedOut(signedOut);
  await clearIdentityCache();
}

/**
 * Google account picker. First await in a click handler.
 * @returns {Promise<string>}
 */
function launchAccountPickerAuth() {
  const clientId = getConfiguredClientId();
  const scopes = getOAuthScopes();
  if (!clientId || !scopes.length) {
    return Promise.reject(
      new Error("Missing OAuth client ID or scopes (config.json / manifest.json).")
    );
  }

  const redirectUri = getOAuthRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    prompt: "select_account consent",
    include_granted_scopes: "true",
  });

  const authUrl = `${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Sign-in timed out."));
    }, SIGN_IN_TIMEOUT_MS);

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const errMsg = chrome.runtime.lastError?.message;
      if (errMsg) {
        reject(new Error(errMsg));
        return;
      }
      if (!responseUrl) {
        reject(new Error("Sign-in was cancelled."));
        return;
      }

      try {
        const hash = responseUrl.includes("#")
          ? responseUrl.slice(responseUrl.indexOf("#") + 1)
          : "";
        const query = responseUrl.includes("?")
          ? responseUrl.slice(responseUrl.indexOf("?") + 1).split("#")[0]
          : "";
        const data = new URLSearchParams(hash || query);
        const token = data.get("access_token");
        const oauthError = data.get("error_description") || data.get("error");
        if (oauthError) {
          reject(new Error(String(oauthError)));
          return;
        }
        if (!token) {
          reject(new Error("Sign-in failed. No access token returned."));
          return;
        }
        resolve(token);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Only the token from an explicit Sign in (never Chrome identity cache alone).
 * Requires both a stored token and profile, and a non–signed-out session.
 */
export async function getAccessToken() {
  if (await isUserSignedOut()) {
    await clearSession({ revoke: false, signedOut: true });
    throw new Error("Not signed in. Click Sign in to choose a Google account.");
  }

  const profile = await getStoredProfile();
  const stored = await readAccessToken();
  if (!profile || !stored) {
    await clearSession({ revoke: Boolean(stored), signedOut: true });
    throw new Error("Not signed in. Click Sign in to choose a Google account.");
  }

  return stored;
}

export async function removeCachedToken(_token) {
  await saveAccessToken(null);
}

async function fetchUserInfo(token) {
  let response;
  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }

  if (response.status === 401) {
    throw Object.assign(new Error("Session expired. Please sign in again."), {
      status: 401,
    });
  }

  if (!response.ok) {
    throw new Error("Could not load Google account info.");
  }

  const data = await response.json();
  return {
    email: data.email || "",
    name: data.name || data.email || "",
    picture: data.picture || "",
  };
}

export async function getStoredProfile() {
  try {
    const stored = await chrome.storage.local.get(PROFILE_KEY);
    return stored[PROFILE_KEY] || null;
  } catch {
    return null;
  }
}

async function saveProfile(profile) {
  if (!profile) {
    await chrome.storage.local.remove(PROFILE_KEY);
    return;
  }
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

/**
 * Interactive sign-in with Google account picker.
 * Must be called from a button click (user gesture).
 */
export async function signIn() {
  let token;
  try {
    token = await launchAccountPickerAuth();
  } catch (err) {
    throw normalizeAuthError(err);
  }

  try {
    const profile = await fetchUserInfo(token);
    await saveAccessToken(token);
    await setUserSignedOut(false);
    await saveProfile(profile);
    await clearIdentityCache();
    return profile;
  } catch (err) {
    await saveAccessToken(null);
    if (err?.status === 401) {
      throw new Error("Session expired. Click Sign in again.");
    }
    throw err;
  }
}

export async function signOut() {
  await clearSession({ revoke: true, signedOut: true });
}

/**
 * @template T
 * @param {(token: string) => Promise<{ response: Response, data?: T } | Response>} fn
 * @param {{ interactive?: boolean, retryInsufficientScopes?: boolean }} [options]
 */
export async function withValidToken(fn, options = {}) {
  const retryInsufficientScopes = options.retryInsufficientScopes === true;
  const token = await getAccessToken();

  async function attempt(currentToken) {
    let result;
    try {
      result = await fn(currentToken);
    } catch (err) {
      if (String(err?.message || "").toLowerCase().includes("failed to fetch")) {
        throw new Error("Network error. Check your connection and try again.");
      }
      if (
        retryInsufficientScopes &&
        (err?.code === "INSUFFICIENT_SCOPES" ||
          /missing google permission|insufficient|scope/i.test(String(err?.message || "")))
      ) {
        await clearSession({ revoke: true, signedOut: true });
        throw new Error("Missing Google permission. Sign in again.");
      }
      throw err;
    }

    const response = result?.response ?? result;
    if (response?.status === 401) {
      await clearSession({ revoke: true, signedOut: true });
      throw new Error("Session expired. Sign in again.");
    }

    if (result && typeof result === "object" && "data" in result) {
      return result.data;
    }
    return result;
  }

  return attempt(token);
}

export async function getAuthStatus() {
  if (await isUserSignedOut()) {
    // Wipe leftover token/profile so Sheets cannot use a cached session.
    const leftover = await readAccessToken();
    if (leftover || (await getStoredProfile())) {
      await clearSession({ revoke: Boolean(leftover), signedOut: true });
    }
    return { signedIn: false, profile: null };
  }

  const profile = await getStoredProfile();
  const token = await readAccessToken();
  if (!profile || !token) {
    if (profile || token) {
      await clearSession({ revoke: Boolean(token), signedOut: true });
    } else {
      await setUserSignedOut(true);
    }
    return { signedIn: false, profile: null };
  }

  return { signedIn: true, profile };
}

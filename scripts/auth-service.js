/**
 * Google OAuth via chrome.identity.
 * Access tokens stay in Chrome's Identity cache — only the profile is persisted.
 */

const PROFILE_KEY = "googleAuthProfile";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function isCancelError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("canceled") ||
    msg.includes("cancelled") ||
    msg.includes("the user did not approve") ||
    msg.includes("authorization page could not be loaded")
  );
}

function normalizeAuthError(err) {
  if (isCancelError(err)) {
    return new Error("Sign-in was cancelled.");
  }
  const msg = String(err?.message || err || "Authentication failed.");
  if (msg.toLowerCase().includes("oauth2") || msg.toLowerCase().includes("bad client")) {
    return new Error(
      "OAuth is not configured correctly. Check the Client ID and extension ID in Google Cloud Console."
    );
  }
  return new Error(msg);
}

/**
 * @param {{ interactive?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function getAccessToken(options = {}) {
  const interactive = options.interactive !== false;
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) {
      throw new Error(interactive ? "Sign-in was cancelled." : "Not signed in.");
    }
    return token;
  } catch (err) {
    throw normalizeAuthError(err);
  }
}

/**
 * @param {string} token
 */
export async function removeCachedToken(token) {
  if (!token) return;
  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch {
    /* ignore */
  }
}

async function fetchUserInfo(token) {
  let response;
  try {
    response = await fetch(USERINFO_URL, {
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

/**
 * @returns {Promise<{ email: string, name: string, picture: string } | null>}
 */
export async function getStoredProfile() {
  try {
    const stored = await chrome.storage.local.get(PROFILE_KEY);
    return stored[PROFILE_KEY] || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ email: string, name: string, picture: string } | null} profile
 */
async function saveProfile(profile) {
  if (!profile) {
    await chrome.storage.local.remove(PROFILE_KEY);
    return;
  }
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

/**
 * Interactive sign-in and profile fetch.
 * Clears any cached token first so Chrome re-requests the current manifest scopes.
 * @returns {Promise<{ email: string, name: string, picture: string }>}
 */
export async function signIn() {
  await signOut();

  const token = await getAccessToken({ interactive: true });
  try {
    const profile = await fetchUserInfo(token);
    await saveProfile(profile);
    return profile;
  } catch (err) {
    if (err?.status === 401) {
      await removeCachedToken(token);
      const retryToken = await getAccessToken({ interactive: true });
      const profile = await fetchUserInfo(retryToken);
      await saveProfile(profile);
      return profile;
    }
    throw err;
  }
}

/**
 * Clear Chrome cached tokens and stored profile.
 */
export async function signOut() {
  let token = null;
  try {
    token = await getAccessToken({ interactive: false });
  } catch {
    /* not signed in */
  }

  if (token) {
    await removeCachedToken(token);
  }

  if (typeof chrome.identity.clearAllCachedAuthTokens === "function") {
    try {
      await chrome.identity.clearAllCachedAuthTokens();
    } catch {
      /* ignore */
    }
  }

  await saveProfile(null);
}

/**
 * Run an authenticated request. On 401 (and optionally insufficient-scope 403),
 * drop the cached token and retry once with an interactive login.
 * @template T
 * @param {(token: string) => Promise<{ response: Response, data?: T } | Response>} fn
 * @param {{ interactive?: boolean, retryInsufficientScopes?: boolean }} [options]
 * @returns {Promise<T | unknown>}
 */
export async function withValidToken(fn, options = {}) {
  const interactive = options.interactive === true;
  const retryInsufficientScopes = options.retryInsufficientScopes === true;
  let token = await getAccessToken({ interactive });

  async function attempt(currentToken, isRetry) {
    let result;
    try {
      result = await fn(currentToken);
    } catch (err) {
      if (String(err?.message || "").toLowerCase().includes("failed to fetch")) {
        throw new Error("Network error. Check your connection and try again.");
      }
      if (
        retryInsufficientScopes &&
        !isRetry &&
        (err?.code === "INSUFFICIENT_SCOPES" ||
          /missing google permission|insufficient|scope/i.test(String(err?.message || "")))
      ) {
        await removeCachedToken(currentToken);
        if (typeof chrome.identity.clearAllCachedAuthTokens === "function") {
          try {
            await chrome.identity.clearAllCachedAuthTokens();
          } catch {
            /* ignore */
          }
        }
        const fresh = await getAccessToken({ interactive: true });
        return attempt(fresh, true);
      }
      throw err;
    }

    const response = result?.response ?? result;
    if (response?.status === 401 && !isRetry) {
      await removeCachedToken(currentToken);
      const fresh = await getAccessToken({ interactive: true });
      return attempt(fresh, true);
    }

    if (response?.status === 401) {
      await saveProfile(null);
      throw new Error("Session expired. Please sign in again.");
    }

    if (result && typeof result === "object" && "data" in result) {
      return result.data;
    }
    return result;
  }

  return attempt(token, false);
}

/**
 * Auth status for UI: stored profile plus a non-interactive token check.
 */
export async function getAuthStatus() {
  let profile = await getStoredProfile();
  let signedIn = false;
  try {
    await getAccessToken({ interactive: false });
    signedIn = true;
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    if (profile) await saveProfile(null);
    return { signedIn: false, profile: null };
  }

  if (!profile) {
    try {
      const token = await getAccessToken({ interactive: false });
      profile = await fetchUserInfo(token);
      await saveProfile(profile);
    } catch {
      return { signedIn: false, profile: null };
    }
  }

  return { signedIn: true, profile };
}

const THEME_STORAGE_KEY = "emailValidatorSettings";

const accountCard = document.getElementById("accountCard");
const accountAvatar = document.getElementById("accountAvatar");
const accountName = document.getElementById("accountName");
const accountEmail = document.getElementById("accountEmail");
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const statusMsg = document.getElementById("statusMsg");
const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;

function showStatus(text, type = "info") {
  statusMsg.textContent = text;
  statusMsg.className = `toast ${type}`;
  statusMsg.classList.remove("hidden");
}

function hideStatus() {
  statusMsg.classList.add("hidden");
  statusMsg.textContent = "";
}

function setBusy(busy) {
  signInBtn.disabled = busy;
  signOutBtn.disabled = busy;
}

function applyTheme(theme) {
  root.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const theme = stored[THEME_STORAGE_KEY]?.theme;
    if (theme === "dark" || theme === "light") applyTheme(theme);
  } catch {
    /* ignore */
  }
}

async function saveTheme(theme) {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const prev = stored[THEME_STORAGE_KEY] || {};
    await chrome.storage.local.set({
      [THEME_STORAGE_KEY]: { ...prev, theme },
    });
  } catch {
    /* ignore */
  }
}

function renderAccount(profile, signedIn) {
  if (signedIn && profile) {
    accountCard.classList.remove("signed-out");
    accountName.textContent = profile.name || profile.email || "Google account";
    accountEmail.textContent = profile.email || "";
    signInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");

    if (profile.picture) {
      accountAvatar.innerHTML = "";
      const img = document.createElement("img");
      img.src = profile.picture;
      img.alt = "";
      accountAvatar.appendChild(img);
    } else {
      const initial = (profile.name || profile.email || "G").charAt(0).toUpperCase();
      accountAvatar.textContent = initial;
    }
  } else {
    accountCard.classList.add("signed-out");
    accountName.textContent = "Not signed in";
    accountEmail.textContent = "Sign in to scan Google Sheets";
    accountAvatar.textContent = "G";
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
  }
}

async function refresh() {
  const auth = await chrome.runtime.sendMessage({ type: "GOOGLE_AUTH_STATUS" });
  if (!auth?.success) {
    showStatus(auth?.error || "Could not load account status.", "error");
    return;
  }
  renderAccount(auth.profile, auth.signedIn);
}

signInBtn.addEventListener("click", async () => {
  hideStatus();
  setBusy(true);
  signInBtn.textContent = "Signing in…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_SIGN_IN" });
    if (!response?.success) {
      showStatus(response?.error || "Sign-in failed.", "error");
      return;
    }
    renderAccount(response.profile, true);
    showStatus(`Signed in as ${response.profile?.email || "Google account"}.`, "success");
  } catch (err) {
    showStatus(err.message || "Sign-in failed.", "error");
  } finally {
    signInBtn.textContent = "Sign in with Google";
    setBusy(false);
  }
});

signOutBtn.addEventListener("click", async () => {
  hideStatus();
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "GOOGLE_SIGN_OUT" });
    if (!response?.success) {
      showStatus(response?.error || "Sign-out failed.", "error");
      return;
    }
    renderAccount(null, false);
    showStatus("Signed out.", "info");
  } catch (err) {
    showStatus(err.message || "Sign-out failed.", "error");
  } finally {
    setBusy(false);
  }
});

themeToggle.addEventListener("click", async () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  await saveTheme(next);
});

loadTheme().then(refresh).catch((err) => {
  showStatus(err.message || "Failed to load settings.", "error");
});

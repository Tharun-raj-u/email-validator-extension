const THEME_STORAGE_KEY = "emailValidatorSettings";

const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;

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

themeToggle?.addEventListener("click", async () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  await saveTheme(next);
});

loadTheme();

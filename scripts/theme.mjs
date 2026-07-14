/** case-by-case theme helpers. */

/** Check whether Foundry is in dark mode. */
export function isDarkTheme() {
  if (document.body?.classList.contains("theme-dark")) return true;
  if (document.documentElement?.classList.contains("theme-dark")) return true;
  if (document.body?.classList.contains("theme-light")) return false;
  if (document.documentElement?.classList.contains("theme-light")) return false;
  // Fall back to the configured scheme.
  try {
    const ui = game.settings.get("core", "uiConfig");
    if ((ui?.colorScheme?.interface || ui?.colorScheme?.applications) === "dark") return true;
  } catch { /* setting not available */ }
  return false;
}

/** Apply the theme class to a window. */
export function applyTheme(element) {
  if (!element?.classList) return;
  const dark = isDarkTheme();
  element.classList.toggle("case-by-case-theme-dark", dark);
  element.classList.toggle("case-by-case-theme-light", !dark);
}

/** Keep open windows in sync with theme changes. */
export function initThemeWatcher() {
  const reapply = () => {
    for (const el of document.querySelectorAll(".case-by-case.bonus-config, .case-by-case.bonus-manager")) {
      applyTheme(el);
    }
  };
  const obs = new MutationObserver(reapply);
  for (const target of [document.body, document.documentElement]) {
    if (target) obs.observe(target, { attributes: true, attributeFilter: ["class"] });
  }
}

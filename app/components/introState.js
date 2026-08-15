export const INTRO_DURATION_MS = 5600;

export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  const root = document.documentElement;
  let theme = "light";
  try {
    const savedTheme = window.localStorage.getItem("blog-theme");
    const configuredTheme = root.dataset.themeDefault || "system";
    const savedThemeAllowed = root.dataset.themeToggle !== "disabled";
    theme = savedThemeAllowed && (savedTheme === "dark" || savedTheme === "light")
      ? savedTheme
      : configuredTheme === "dark" || configuredTheme === "light"
        ? configuredTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    const configuredTheme = root.dataset.themeDefault || "system";
    try { theme = configuredTheme === "dark" || configuredTheme === "light" ? configuredTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch {}
  }
  root.dataset.theme = theme;
})();`;

export const INTRO_BOOTSTRAP_SCRIPT = `(() => {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  document.documentElement.dataset.intro = reducedMotion ? "complete" : "playing";
})();`;

export function completeIntro(root, body) {
  root.dataset.intro = "complete";
  body.classList.remove("intro-playing");
}

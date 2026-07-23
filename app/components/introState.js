export const INTRO_DURATION_MS = 5600;

export const INTRO_BOOTSTRAP_SCRIPT = `(() => {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  let theme = "light";
  try {
    const savedTheme = window.localStorage.getItem("blog-theme");
    theme = savedTheme === "dark" || savedTheme === "light"
      ? savedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    try { theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch {}
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.intro = reducedMotion ? "complete" : "playing";
})();`;

export function completeIntro(root, body) {
  root.dataset.intro = "complete";
  body.classList.remove("intro-playing");
}

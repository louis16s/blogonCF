export const INTRO_DURATION_MS = 5600;

export const INTRO_BOOTSTRAP_SCRIPT = `(() => {
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  document.documentElement.dataset.intro = reducedMotion ? "complete" : "playing";
})();`;

export function completeIntro(root, body) {
  root.dataset.intro = "complete";
  body.classList.remove("intro-playing");
}

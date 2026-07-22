export const INTRO_DURATION_MS = 2250;
export const INTRO_STORAGE_KEY = "blog.intro.rangefinder.v2";

export const INTRO_BOOTSTRAP_SCRIPT = `(() => {
  let reducedMotion = false;
  let alreadySeen = false;
  try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
  try { alreadySeen = window.sessionStorage.getItem("${INTRO_STORAGE_KEY}") === "seen"; } catch {}
  document.documentElement.dataset.intro = reducedMotion || alreadySeen ? "complete" : "playing";
})();`;

export function completeIntro(storage, root, body) {
  try { storage.setItem(INTRO_STORAGE_KEY, "seen"); } catch {}
  root.dataset.intro = "complete";
  body.classList.remove("intro-playing");
}

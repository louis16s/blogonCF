"use client";

import { useCallback, useEffect, useState } from "react";

const INTRO_DURATION_MS = 2250;
const INTRO_STORAGE_KEY = "blog.intro.rangefinder.v2";

export function IntroSequence() {
  const [visible, setVisible] = useState(true);

  const finish = useCallback(() => {
    try { window.sessionStorage.setItem(INTRO_STORAGE_KEY, "seen"); }
    catch { /* Storage may be unavailable in private browsing. */ }
    document.documentElement.dataset.intro = "complete";
    document.body.classList.remove("intro-playing");
    setVisible(false);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alreadySeen = false;
    try { alreadySeen = window.sessionStorage.getItem(INTRO_STORAGE_KEY) === "seen"; }
    catch { /* Play once when storage is unavailable. */ }

    if (reducedMotion || alreadySeen) {
      document.documentElement.dataset.intro = "complete";
      const frame = window.requestAnimationFrame(() => setVisible(false));
      return () => window.cancelAnimationFrame(frame);
    }

    document.documentElement.dataset.intro = "playing";
    document.body.classList.add("intro-playing");
    const timer = window.setTimeout(finish, INTRO_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("intro-playing");
    };
  }, [finish]);

  if (!visible) return null;

  return (
    <div
      className="site-intro"
      aria-label="网站开场动画"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) finish(); }}
    >
      <button className="intro-skip" type="button" onClick={finish}>跳过</button>
      <div className="intro-stage" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="intro-camera" src="/rangefinder-intro.webp" alt="" width="1280" height="853" fetchPriority="high" />
        <span className="intro-lens-flash" />
      </div>
    </div>
  );
}

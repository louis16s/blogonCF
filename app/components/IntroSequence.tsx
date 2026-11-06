"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import { completeIntro, INTRO_DURATION_MS } from "./introState";

export function IntroSequence({ enabled = true, title = "louis16s", subtitle = "正在对焦生活" }: { enabled?: boolean; title?: string; subtitle?: string }) {
  const [visible, setVisible] = useState(true);

  const finish = useCallback(() => {
    completeIntro(document.documentElement, document.body);
    setVisible(false);
  }, []);

  // A layout effect prevents the homepage from flashing before the intro when
  // this component mounts after an in-app navigation from another route.
  useLayoutEffect(() => {
    if (!enabled) {
      const frame = window.requestAnimationFrame(finish);
      return () => window.cancelAnimationFrame(frame);
    }
    if (document.documentElement.dataset.intro !== "playing") {
      let reducedMotion = false;
      try {
        reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch {}
      if (reducedMotion) {
        const frame = window.requestAnimationFrame(finish);
        return () => window.cancelAnimationFrame(frame);
      }
      document.documentElement.dataset.intro = "playing";
    }

    document.body.classList.add("intro-playing");
    const timer = window.setTimeout(finish, INTRO_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("intro-playing");
    };
  }, [enabled, finish]);

  if (!enabled || !visible) return null;

  return (
    <div
      className="site-intro"
      aria-label="网站开场动画"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) finish(); }}
    >
      <button className="intro-skip" type="button" onClick={finish}>跳过</button>
      <div className="intro-stage" aria-hidden="true">
        <div className="intro-camera-rig">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="intro-camera" src="/rangefinder-intro.webp" alt="" width="1280" height="853" fetchPriority="high" />
          <svg className="intro-iris" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <radialGradient id="intro-iris-metal"><stop offset="0" stopColor="#59616a" /><stop offset=".6" stopColor="#30353c" /><stop offset="1" stopColor="#080a0d" /></radialGradient>
              <mask id="intro-iris-mask"><rect width="100" height="100" fill="white" /><polygon fill="black" points="50,5 82,18 95,50 82,82 50,95 18,82 5,50 18,18">
                <animate attributeName="points" dur="5.35s" fill="freeze" calcMode="discrete" keyTimes="0;0.31;0.38;0.45;0.52;0.59;0.68;1" values="50,5 82,18 95,50 82,82 50,95 18,82 5,50 18,18;50,5 82,18 95,50 82,82 50,95 18,82 5,50 18,18;50,13 76,24 87,50 76,76 50,87 24,76 13,50 24,24;50,20 71,29 80,50 71,71 50,80 29,71 20,50 29,29;50,27 66,34 73,50 66,66 50,73 34,66 27,50 34,34;50,33 62,38 67,50 62,62 50,67 38,62 33,50 38,38;50,38 58,42 62,50 58,58 50,62 42,58 38,50 42,42;50,38 58,42 62,50 58,58 50,62 42,58 38,50 42,42" />
              </polygon></mask>
            </defs>
            <circle cx="50" cy="50" r="49" fill="url(#intro-iris-metal)" mask="url(#intro-iris-mask)" />
            <g mask="url(#intro-iris-mask)" fill="none" stroke="#79818a" strokeWidth=".35" opacity=".65">
              <path d="M50 0 L82 18 M85 15 L95 50 M100 50 L82 82 M85 85 L50 95 M50 100 L18 82 M15 85 L5 50 M0 50 L18 18 M15 15 L50 5" />
            </g>
          </svg>
          <span className="intro-lens-flash" />
        </div>
        <div className="intro-caption"><strong>{title}</strong><span>{subtitle}</span></div>
        <span className="intro-progress" />
      </div>
    </div>
  );
}

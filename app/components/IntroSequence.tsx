"use client";

import { useCallback, useEffect, useState } from "react";
import { completeIntro, INTRO_DURATION_MS } from "./introState";

export function IntroSequence() {
  const [visible, setVisible] = useState(true);

  const finish = useCallback(() => {
    completeIntro(document.documentElement, document.body);
    setVisible(false);
  }, []);

  useEffect(() => {
    if (document.documentElement.dataset.intro !== "playing") {
      const frame = window.requestAnimationFrame(() => setVisible(false));
      return () => window.cancelAnimationFrame(frame);
    }

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
        <div className="intro-caption"><span>LOUIS16S · FRAME 01</span><strong>正在对焦生活</strong></div>
        <span className="intro-progress" />
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { completeIntro, INTRO_DURATION_MS } from "./introState";

const APERTURE_BLADES = Array.from({ length: 9 }, (_, index) => (
  <span
    className="intro-aperture-blade"
    style={{ "--blade-angle": `${index * 40}deg` } as CSSProperties}
    key={index}
  />
));

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
        <div className="intro-camera-rig">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="intro-camera" src="/rangefinder-intro.webp" alt="" width="1280" height="853" fetchPriority="high" />
          <div className="intro-lens-aperture">
            <div className="intro-aperture-blades">{APERTURE_BLADES}</div>
            <span className="intro-aperture-opening" />
          </div>
          <span className="intro-lens-flash" />
        </div>
        <strong className="intro-wordmark">louis16s</strong>
      </div>
      <span className="intro-shutter" aria-hidden="true" />
    </div>
  );
}

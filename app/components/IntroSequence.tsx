"use client";

import { useCallback, useLayoutEffect, useState, type CSSProperties } from "react";
import { completeIntro, INTRO_DURATION_MS } from "./introState";

const APERTURE_STOPS = ["F2", "F2.8", "F4", "F5.6", "F8", "F11", "F16"];
const APERTURE_BLADES = Array.from({ length: 10 }, (_, index) => index);

export function IntroSequence({ enabled = true, title = "louis16s" }: { enabled?: boolean; title?: string; subtitle?: string }) {
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
          <span className="intro-wind-lever" />
          <span className="intro-shutter-button" />
          <span className="intro-focus-ring" />
          <span className="intro-rangefinder-patch"><i /><i /></span>
          <span className="intro-aperture">
            {APERTURE_BLADES.map((index) => <i className="intro-aperture-blade" style={{ "--blade-index": index } as CSSProperties} key={index} />)}
            <b className="intro-aperture-opening" />
          </span>
          <span className="intro-exposure-curtain" />
        </div>
        <div className="intro-readout" aria-hidden="true">
          <span className="intro-readout-label">MECHANICAL RANGEFINDER</span>
          <span className="intro-readout-values">
            {APERTURE_STOPS.map((stop) => <b key={stop}>{stop}</b>)}
          </span>
        </div>
        <div className="intro-caption"><strong>{title}</strong></div>
      </div>
    </div>
  );
}

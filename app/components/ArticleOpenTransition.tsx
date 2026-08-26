"use client";

import type { CSSProperties } from "react";

export type ArticleOpening = {
  bounds: { top: number; right: number; bottom: number; left: number; width: number; height: number };
  date: string;
  icon?: string;
  title: string;
};

type TransitionStyle = CSSProperties & Record<`--flight-${string}`, string>;

export function ArticleOpenTransition({ opening }: { opening: ArticleOpening | null }) {
  if (!opening) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const centerX = opening.bounds.left + opening.bounds.width / 2;
  const centerY = opening.bounds.top + opening.bounds.height / 2;
  const style: TransitionStyle = {
    "--flight-top": `${Math.max(0, opening.bounds.top)}px`,
    "--flight-right": `${Math.max(0, viewportWidth - opening.bounds.right)}px`,
    "--flight-bottom": `${Math.max(0, viewportHeight - opening.bounds.bottom)}px`,
    "--flight-left": `${Math.max(0, opening.bounds.left)}px`,
    "--flight-x": `${centerX - viewportWidth / 2}px`,
    "--flight-y": `${centerY - viewportHeight / 2}px`,
  };

  return (
    <div className="article-flight" style={style} role="status" aria-live="polite" aria-label={`正在打开《${opening.title}》`}>
      <span className="sr-only">正在打开文章：{opening.title}</span>
      <span className="article-flight-grain" aria-hidden="true" />
      <div className="article-flight-focus" aria-hidden="true">
        <span className="article-flight-aperture" />
        <span className="article-flight-icon">{opening.icon || ""}</span>
        <strong>{opening.title}</strong>
        <time>{opening.date}</time>
        <span className="article-flight-meter" />
      </div>
    </div>
  );
}

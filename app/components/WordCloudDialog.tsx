"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowsOutSimple, ChartBar, DotsNine, MapPin, Rows, StarFour, X } from "@phosphor-icons/react";
import type { Post } from "../data/types";
import { layoutFallingWords } from "../../shared/wordCloudLayout.js";

type CloudWord = {
  word: string;
  count: number;
  level: number;
  tone: number;
  tilt: number;
  postIds: string[];
};

type CloudPayload = {
  words?: CloudWord[];
  cities?: CityWord[];
  sourceCount?: number;
  partial?: boolean;
};

type CityWord = { word: string; count: number; postIds: string[] };

let cachedCloudPayload: CloudPayload | null = null;
let pendingCloudRequest: Promise<CloudPayload> | null = null;

function loadCloudPayload(signal: AbortSignal): Promise<CloudPayload> {
  if (cachedCloudPayload) return Promise.resolve(cachedCloudPayload);
  if (!pendingCloudRequest) {
    pendingCloudRequest = fetch("/api/content/word-cloud", { signal, cache: "default" })
      .then((response) => response.ok ? response.json() as Promise<CloudPayload> : Promise.reject(new Error("word cloud unavailable")))
      .then((payload) => {
        cachedCloudPayload = payload;
        return payload;
      })
      .finally(() => { pendingCloudRequest = null; });
  }
  return pendingCloudRequest;
}

type CloudMode = "pile" | "drift" | "rows" | "cascade" | "constellation" | "rank" | "cities";

const modes: Array<{ id: CloudMode; label: string; icon: typeof DotsNine }> = [
  { id: "pile", label: "堆叠", icon: DotsNine },
  { id: "drift", label: "散落", icon: ArrowsOutSimple },
  { id: "cities", label: "城市", icon: MapPin },
  { id: "rows", label: "规整", icon: Rows },
  { id: "cascade", label: "瀑布", icon: ArrowDown },
  { id: "constellation", label: "星群", icon: StarFour },
  { id: "rank", label: "频率榜", icon: ChartBar },
];

function FallingWords({ words, mode, selectedWord, onSelect }: { words: CloudWord[]; mode: "pile" | "drift"; selectedWord: string; onSelect: (word: string) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ height: number; positions: Array<{ left: number; top: number }> }>();

  useLayoutEffect(() => {
    const container = field.current;
    if (!container) return;
    let lastWidth = 0;
    let frame = 0;
    const arrange = () => {
      const width = Math.floor(container.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      const sizes = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-level]"), (button) => ({ width: button.offsetWidth, height: button.offsetHeight }));
      setLayout(layoutFallingWords(sizes, width, mode));
    };
    arrange();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(arrange);
    });
    observer?.observe(container);
    const onResize = () => arrange();
    if (!observer) window.addEventListener("resize", onResize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", onResize); cancelAnimationFrame(frame); };
  }, [words, mode]);

  return <div ref={field} className={`word-cloud-field ${layout ? "is-positioned" : ""}`} style={{ height: layout?.height || 240 }}>
    {words.map((item, index) => <button
      key={item.word}
      type="button"
      className={selectedWord === item.word ? "active" : ""}
      data-level={item.level}
      data-tone={item.tone}
      style={{ left: layout?.positions[index]?.left || 0, top: layout?.positions[index]?.top || 0, "--cloud-tilt": `${Math.max(-6, Math.min(6, item.tilt * 1.5))}deg`, "--cloud-order": index, "--fall-offset": `${(index % 7 - 3) * 15}px`, "--fall-distance": `${-(layout?.positions[index]?.top || 0) - 60}px`, "--fall-rotation": `${(index % 7 - 3) * 7}deg` } as CSSProperties}
      onClick={() => onSelect(item.word)}
      aria-label={`${item.word}，出现 ${item.count} 次，涉及 ${item.postIds.length} 篇文章`}
      aria-pressed={selectedWord === item.word}
    >{item.word}<small>{item.count}</small></button>)}
  </div>;
}

export function WordCloudDialog({ open, posts, onClose }: { open: boolean; posts: Post[]; onClose: () => void }) {
  const [words, setWords] = useState<CloudWord[]>([]);
  const [cities, setCities] = useState<CityWord[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [partial, setPartial] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [mode, setMode] = useState<CloudMode>("pile");
  const [selectedWord, setSelectedWord] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || status !== "loading") return;
    const controller = new AbortController();
    loadCloudPayload(controller.signal)
      .then((payload) => {
        setWords(Array.isArray(payload.words) ? payload.words : []);
        setCities(Array.isArray(payload.cities) ? payload.cities : []);
        setSourceCount(Number(payload.sourceCount) || 0);
        setPartial(Boolean(payload.partial));
        setStatus("ready");
      })
      .catch((reason) => { if (reason?.name !== "AbortError") setStatus("error"); });
    return () => controller.abort();
  }, [open, status]);

  const postsById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const selected = (mode === "cities" ? cities : words).find((item) => item.word === selectedWord);
  const relatedPosts = (selected?.postIds || []).map((id) => postsById.get(id)).filter((post): post is Post => Boolean(post));

  if (!open) return null;

  return createPortal(
    <div className="word-cloud-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="word-cloud-dialog" role="dialog" aria-modal="true" aria-labelledby="word-cloud-title">
        <header className="word-cloud-dialog-head">
          <div>
            <p>PUBLIC ARTICLE CORPUS</p>
            <h2 id="word-cloud-title">词云</h2>
            <span>只统计公开文章的标题和正文，不读取分类、标签、摘要或密码文章。</span>
          </div>
          <button ref={closeButton} className="word-cloud-close" type="button" onClick={onClose} aria-label="关闭词云"><X aria-hidden size={20} /></button>
        </header>

        <div className="word-cloud-controls" role="group" aria-label="词云排列方式">
          {modes.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={mode === id ? "active" : ""} onClick={() => { setMode(id); setSelectedWord(""); }} aria-pressed={mode === id}>
              <Icon aria-hidden size={16} />{label}
            </button>
          ))}
          {status === "ready" && (
            <span>
              {posts.length} 篇公开文章 · {sourceCount} 篇参与词频
              {partial ? " · 部分正文暂未读取" : ""}
            </span>
          )}
        </div>

        <div className={`word-cloud-canvas mode-${mode}`} aria-live="polite">
          {status === "loading" && <div className="word-cloud-state"><span className="cloud-loader" />正在翻阅公开文章的标题和正文…</div>}
          {status === "error" && <div className="word-cloud-state">词云暂时没有生成出来。<button type="button" className="cloud-retry" onClick={() => setStatus("loading")}>再试一次</button></div>}
          {status === "ready" && mode === "cities" && (cities.length ? <ul className="word-cloud-cities" aria-label="文章中识别到的城市">
            {cities.map((city, index) => <li key={city.word}><button type="button" data-tone={index % 6} onClick={() => setSelectedWord((current) => current === city.word ? "" : city.word)} aria-pressed={selectedWord === city.word}><span>{city.word}</span><small>{city.count}</small></button></li>)}
          </ul> : <div className="word-cloud-state">暂时没有识别到城市。</div>)}
          {status === "ready" && mode !== "cities" && words.length === 0 && <div className="word-cloud-state">正文里暂时没有足够重复的词。</div>}
          {status === "ready" && (mode === "pile" || mode === "drift") && words.length > 0 && <FallingWords key={mode} words={words} mode={mode} selectedWord={selectedWord} onSelect={(word) => setSelectedWord((current) => current === word ? "" : word)} />}
          {status === "ready" && mode !== "cities" && mode !== "pile" && mode !== "drift" && words.map((item, index) => (
            <button
              type="button"
              key={`${mode}:${item.word}`}
              className={selectedWord === item.word ? "active" : ""}
              data-level={item.level}
              data-tone={item.tone}
              style={{ "--cloud-tilt": `${Math.max(-6, Math.min(6, item.tilt * 1.5))}deg`, "--cloud-order": index, "--cloud-step": index % 6, "--cloud-strength": `${item.level * 18}%`, "--fall-offset": `${(index % 7 - 3) * 15}px`, "--fall-rotation": `${(index % 7 - 3) * 7}deg`, "--settle-x": `${(index % 3 - 1) * 3}px`, "--settle-y": `${(index % 5 - 2) * 2}px` } as CSSProperties}
              onClick={() => setSelectedWord((current) => current === item.word ? "" : item.word)}
              aria-label={`${item.word}，出现 ${item.count} 次，涉及 ${item.postIds.length} 篇文章`}
              aria-pressed={selectedWord === item.word}
            >
              {item.word}<small>{item.count}</small>
            </button>
          ))}
        </div>

        <footer className="word-cloud-related" aria-live="polite">
          {selected ? (
            <>
              <p><strong>“{selected.word}”</strong> 出现在这些文章里</p>
              <div>
                {relatedPosts.slice(0, 8).map((post) => <Link href={`/blog/${encodeURIComponent(post.slug)}`} onClick={onClose} key={post.id}>{post.title}</Link>)}
                {relatedPosts.length === 0 && <span>相关文章正在同步，请稍后再打开。</span>}
              </div>
            </>
          ) : <p>{mode === "cities" ? "从公开正文识别地名，可能有遗漏或同名误识。" : "点一个词，可以看看它出现在哪些文章里。"}</p>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

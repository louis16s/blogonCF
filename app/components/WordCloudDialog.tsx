"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowsOutSimple, ChartBar, DotsNine, Rows, StarFour, X } from "@phosphor-icons/react";
import type { Post } from "../data/types";

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
  sourceCount?: number;
  partial?: boolean;
};

type CloudMode = "pile" | "drift" | "rows" | "cascade" | "constellation" | "rank";

const modes: Array<{ id: CloudMode; label: string; icon: typeof DotsNine }> = [
  { id: "pile", label: "堆叠", icon: DotsNine },
  { id: "drift", label: "散落", icon: ArrowsOutSimple },
  { id: "rows", label: "规整", icon: Rows },
  { id: "cascade", label: "瀑布", icon: ArrowDown },
  { id: "constellation", label: "星群", icon: StarFour },
  { id: "rank", label: "频率榜", icon: ChartBar },
];

export function WordCloudDialog({ open, posts, onClose }: { open: boolean; posts: Post[]; onClose: () => void }) {
  const [words, setWords] = useState<CloudWord[]>([]);
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
    fetch("/api/content/word-cloud", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<CloudPayload> : Promise.reject(new Error("word cloud unavailable")))
      .then((payload) => {
        setWords(Array.isArray(payload.words) ? payload.words : []);
        setSourceCount(Number(payload.sourceCount) || 0);
        setPartial(Boolean(payload.partial));
        setStatus("ready");
      })
      .catch((reason) => { if (reason?.name !== "AbortError") setStatus("error"); });
    return () => controller.abort();
  }, [open, status]);

  const postsById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const selected = words.find((item) => item.word === selectedWord);
  const relatedPosts = (selected?.postIds || []).map((id) => postsById.get(id)).filter((post): post is Post => Boolean(post));

  if (!open) return null;

  return (
    <div className="word-cloud-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="word-cloud-dialog" role="dialog" aria-modal="true" aria-labelledby="word-cloud-title">
        <header className="word-cloud-dialog-head">
          <div>
            <p>PUBLIC ARTICLE CORPUS</p>
            <h2 id="word-cloud-title">文章词云</h2>
            <span>只统计公开文章的标题和正文，不读取分类、标签、摘要或密码文章。</span>
          </div>
          <button ref={closeButton} className="word-cloud-close" type="button" onClick={onClose} aria-label="关闭文章词云"><X aria-hidden size={20} /></button>
        </header>

        <div className="word-cloud-controls" role="group" aria-label="词云排列方式">
          {modes.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={mode === id ? "active" : ""} onClick={() => setMode(id)} aria-pressed={mode === id}>
              <Icon aria-hidden size={16} />{label}
            </button>
          ))}
          {status === "ready" && <span>{sourceCount} 篇公开文章{partial ? " · 部分正文暂未读取" : " · 标题与正文"}</span>}
        </div>

        <div className={`word-cloud-canvas mode-${mode}`} aria-live="polite">
          {status === "loading" && <div className="word-cloud-state"><span className="cloud-loader" />正在翻阅公开文章的标题和正文…</div>}
          {status === "error" && <div className="word-cloud-state">词云暂时没有生成出来。<button type="button" className="cloud-retry" onClick={() => setStatus("loading")}>再试一次</button></div>}
          {status === "ready" && words.length === 0 && <div className="word-cloud-state">正文里暂时没有足够重复的词。</div>}
          {status === "ready" && words.map((item, index) => (
            <button
              type="button"
              key={item.word}
              className={selectedWord === item.word ? "active" : ""}
              data-level={item.level}
              data-tone={item.tone}
              style={{ "--cloud-tilt": `${item.tilt}deg`, "--cloud-order": index, "--cloud-step": index % 6, "--cloud-strength": `${item.level * 18}%` } as CSSProperties}
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
          ) : <p>点一个词，可以看看它出现在哪些文章里。</p>}
        </footer>
      </section>
    </div>
  );
}

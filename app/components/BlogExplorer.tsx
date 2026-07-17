"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Post } from "../data/types";

const ALL = "全部";

export function BlogExplorer() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [syncState, setSyncState] = useState<"loading" | "live" | "unavailable">("loading");
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch("/api/content/posts", { signal: controller.signal, cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => { if (Array.isArray(data.posts)) { setPosts(data.posts); setLive(true); setSyncState("live"); } })
        .catch(() => setSyncState("unavailable"));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const categories = useMemo(() => [ALL, ...Array.from(new Set(posts.map((post) => post.category).filter(Boolean)))], [posts]);
  const visible = useMemo(() => posts.filter((post) => {
    const matchesCategory = category === ALL || post.category === category;
    const needle = query.trim().toLocaleLowerCase();
    const matchesQuery = !needle || [post.title, post.summary, post.category, ...post.tags].join(" ").toLocaleLowerCase().includes(needle);
    return matchesCategory && matchesQuery;
  }), [posts, category, query]);

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="返回首页"><span>16</span> louis16s</Link>
        <nav aria-label="主导航"><a href="#writing">文章</a><a href="#about">关于</a></nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">FIELD NOTES · 旅行 / 摄影 / 开发</p>
        <h1 id="hero-title">把经过的地方，<br /><em>留在这里。</em></h1>
        <p className="hero-copy">不定期记录相机、旅途、软硬件与一些很难归类的生活片段。</p>
        <div className="hero-meta"><span>{syncState === "live" ? `${posts.length} 篇公开文章` : "正在连接内容源"}</span><span className={live ? "source live" : "source"}>{syncState === "live" ? "Notion 实时同步" : syncState === "loading" ? "正在同步" : "Notion 暂时不可用"}</span></div>
      </section>

      <section className="writing" id="writing" aria-labelledby="writing-title">
        <div className="section-head"><div><p className="eyebrow">THE ARCHIVE</p><h2 id="writing-title">最近写下</h2></div>
          <label className="search"><span className="sr-only">搜索文章</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、标签…" /></label>
        </div>
        <div className="filters" role="group" aria-label="按分类筛选">
          {categories.map((item) => <button key={item} className={item === category ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
        <div className="post-list">
          {visible.map((post, index) => (
            <article className="post-row" key={post.id}>
              <div className="post-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="post-main"><div className="post-kicker"><time dateTime={post.date}>{formatDate(post.date)}</time><span>{post.category}</span>{post.locked && <span>需密码</span>}</div>
                <h3><Link href={`/blog/${encodeURIComponent(post.slug)}`}>{post.title}</Link></h3><p>{post.summary}</p>
                <div className="tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
              </div>
              <Link className="arrow" href={`/blog/${encodeURIComponent(post.slug)}`} aria-label={`阅读 ${post.title}`}>↗</Link>
            </article>
          ))}
          {!visible.length && <p className="empty">{syncState === "loading" ? "正在从 Notion 读取文章…" : syncState === "unavailable" ? "内容源暂时不可用，请稍后刷新。" : "没有找到匹配的文章。"}</p>}
        </div>
      </section>

      <footer id="about"><p>写在 Notion，运行在 Cloudflare 边缘网络。</p><p>© {new Date().getFullYear()} louis16s</p></footer>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

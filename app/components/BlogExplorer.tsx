"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Camera,
  Code,
  FileText,
  Heart,
  LockSimple,
  MagnifyingGlass,
  MapTrifold,
  Moon,
  Sparkle,
  Sun,
  Wrench,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { DEFAULT_SITE_CONFIG, type Post, type SiteConfig, type SiteLink } from "../data/types";
import { ContentFooter } from "./ContentFooter";
import { SiteSidebar } from "./SiteSidebar";
import { WordCloudDialog } from "./WordCloudDialog";
import { normalizeSearchText } from "../../shared/wordCloud.js";

const ALL = "全部";
const preferredCategories = ["心情随笔", "嵌入式开发", "小软件工程", "相机分享", "旅行游记", "输入密码"];

const categoryIcons: Array<[RegExp, Icon]> = [
  [/心情|随笔|生活/, Heart],
  [/嵌入|开发|代码|技术/, Code],
  [/软件|工具|工程/, Wrench],
  [/相机|摄影/, Camera],
  [/旅行|游记/, MapTrifold],
];

export function BlogExplorer({ initialPosts = [], initialLinks = [], initialConfig = DEFAULT_SITE_CONFIG }: { initialPosts?: Post[]; initialLinks?: SiteLink[]; initialConfig?: SiteConfig }) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [siteLinks, setSiteLinks] = useState<SiteLink[]>(initialLinks);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(initialConfig);
  const [syncState, setSyncState] = useState<"loading" | "live" | "unavailable">(initialPosts.length ? "live" : "loading");
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [dark, setDark] = useState(false);
  const [wordCloudOpen, setWordCloudOpen] = useState(false);

  useEffect(() => {
    const syncFromHash = () => setWordCloudOpen(window.location.hash === "#word-cloud");
    const openFromMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href="/#word-cloud"]') : null;
      if (!target) return;
      event.preventDefault();
      window.history.pushState(null, "", "/#word-cloud");
      setWordCloudOpen(true);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    document.addEventListener("click", openFromMenu);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
      document.removeEventListener("click", openFromMenu);
    };
  }, []);

  const closeWordCloud = useCallback(() => {
    if (window.location.hash === "#word-cloud") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setWordCloudOpen(false);
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("blog-theme"); }
    catch { /* Use the system theme when storage is unavailable. */ }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const frame = window.requestAnimationFrame(() => setDark(saved ? saved === "dark" : prefersDark));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { window.localStorage.setItem("blog-theme", dark ? "dark" : "light"); }
    catch { /* Theme switching still works without persistence. */ }
  }, [dark]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch("/api/content/posts", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { if (Array.isArray(data.posts)) { setPosts(data.posts); setSiteLinks(Array.isArray(data.links) ? data.links : []); if (data.config?.author && data.config?.since) setSiteConfig(data.config); setSyncState("live"); } })
      .catch(() => { setPosts([]); setSiteLinks([]); setSiteConfig(DEFAULT_SITE_CONFIG); setSyncState("unavailable"); });
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const categories = useMemo(() => {
    const found = Array.from(new Set(posts.map((post) => post.category).filter(Boolean)));
    found.sort((a, b) => {
      const aIndex = preferredCategories.indexOf(a);
      const bIndex = preferredCategories.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, "zh-CN");
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return [ALL, ...found];
  }, [posts]);
  const visible = useMemo(() => {
    const needle = normalizeSearchText(deferredQuery);
    return posts.filter((post) => (category === ALL || post.category === category)
      && (!needle || normalizeSearchText([post.title, post.summary, post.category, ...post.tags].join(" ")).includes(needle)));
  }, [posts, category, deferredQuery]);

  const groups = useMemo(() => {
    const map = new Map<string, Post[]>();
    visible.forEach((post) => {
      const key = post.category || "未分类";
      map.set(key, [...(map.get(key) || []), post]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => categories.indexOf(a) - categories.indexOf(b));
  }, [visible, categories]);

  const selectCategory = (value: string) => {
    setCategory(value);
    window.requestAnimationFrame(() => document.getElementById("posts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="blog-frame">
      <SiteSidebar siteConfig={siteConfig} siteLinks={siteLinks} />
      <WordCloudDialog open={wordCloudOpen} posts={posts} onClose={closeWordCloud} />

      <main className="blog-main">
        <header className="blog-toolbar">
          <div className="welcome-block">
            <p className="welcome"><Sparkle aria-hidden size={19} weight="fill" /><span>blog 复活啦！<span className="welcome-tagline">是新的一年真好啊，绝胜烟柳满皇都！</span></span></p>
            <div className="sync-meta">
              <span>{syncState === "live" ? `${posts.length} 篇公开文章 · 首页全部展开` : syncState === "loading" ? "正在读取公开文章" : "内容源暂时不可用"}</span>
              <span className={`source ${syncState === "live" ? "live" : ""}`}>{syncState === "live" ? "Notion 实时同步" : syncState === "loading" ? "正在同步" : "同步中断"}</span>
            </div>
          </div>

          <div className="toolbar-actions">
            <label className="search-box">
              <span className="sr-only">搜索文章</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、标签…" />
              <MagnifyingGlass aria-hidden size={20} />
            </label>
            <button className="icon-button" type="button" onClick={() => setDark((value) => !value)} aria-label={dark ? "切换为浅色模式" : "切换为深色模式"}>
              {dark ? <Sun aria-hidden size={21} /> : <Moon aria-hidden size={21} />}
              <span className="theme-label">{dark ? "浅色" : "深色"}</span>
            </button>
          </div>
        </header>

        <section className="posts-shell" id="posts" aria-label="全部文章">
          <div className="filter-row">
            <div className="filters" role="group" aria-label="按分类筛选">
              {categories.map((item) => (
                <button type="button" key={item} className={item === category ? "active" : ""} onClick={() => selectCategory(item)}>{item}</button>
              ))}
            </div>
          </div>

          {groups.map(([name, items]) => (
            <section className="category-section" key={name} aria-labelledby={`category-${slugify(name)}`}>
              <h2 id={`category-${slugify(name)}`}>#&nbsp; {name}</h2>
              <div className="post-grid">
                {items.map((post, index) => <PostCard post={post} index={index} key={post.id} />)}
              </div>
            </section>
          ))}

          {!visible.length && (
            <div className="empty">
              <FileText aria-hidden size={30} />
              <p>{syncState === "loading" ? "正在从 Notion 读取文章…" : syncState === "unavailable" ? "内容源暂时不可用，请稍后刷新。" : "没有找到匹配的文章。"}</p>
            </div>
          )}
        </section>

        <ContentFooter id="about" siteConfig={siteConfig} postCount={posts.length} />
      </main>
    </div>
  );
}

function PostCard({ post, index }: { post: Post; index: number }) {
  const Icon = categoryIcons.find(([matcher]) => matcher.test(post.category))?.[1] || FileText;
  return (
    <article className="post-card" style={{ "--card-order": Math.min(index, 8) } as CSSProperties}>
      <Icon className={`post-icon tone-${index % 4}`} aria-hidden size={29} weight="duotone" />
      <div className="post-card-body">
        <div className="post-card-title">
          <h3><Link href={`/blog/${encodeURIComponent(post.slug)}`}>{post.title}</Link></h3>
          {post.locked && <span className="lock-badge" title="这篇文章需要密码"><LockSimple aria-label="需密码" size={15} weight="fill" /></span>}
        </div>
        <p>{post.summary || (post.tags.length ? post.tags.join(" · ") : "一篇来自 Notion 的记录")}</p>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
      </div>
      <Link className="card-link" href={`/blog/${encodeURIComponent(post.slug)}`} aria-label={`阅读 ${post.title}`} />
    </article>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "日期待定";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(date).replaceAll("/", "-");
}

function slugify(value: string) {
  return encodeURIComponent(value).replaceAll("%", "").toLocaleLowerCase();
}

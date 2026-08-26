"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  FileText,
  LockSimple,
  MagnifyingGlass,
  Moon,
  Sparkle,
  Sun,
} from "@phosphor-icons/react";
import { DEFAULT_SITE_CONFIG, type Post, type SiteConfig, type SiteLink, type SiteNotice } from "../data/types";
import { ContentFooter } from "./ContentFooter";
import { SiteSidebar } from "./SiteSidebar";
import { ArticleOpenTransition, type ArticleOpening } from "./ArticleOpenTransition";
import { normalizeSearchText } from "../../shared/wordCloud.js";
import { siteThemeVariables } from "../../shared/site-config";

const ALL = "全部";
const WordCloudDialog = dynamic(() => import("./WordCloudDialog").then((module) => module.WordCloudDialog), {
  loading: () => null,
  ssr: false,
});
export function BlogExplorer({ initialPosts = [], initialLinks = [], initialNotice, initialConfig = DEFAULT_SITE_CONFIG, initialNotionConfigured = true }: { initialPosts?: Post[]; initialLinks?: SiteLink[]; initialNotice?: SiteNotice; initialConfig?: SiteConfig; initialNotionConfigured?: boolean }) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [siteLinks, setSiteLinks] = useState<SiteLink[]>(initialLinks);
  const [notice, setNotice] = useState<SiteNotice | undefined>(initialNotice);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => ({ ...DEFAULT_SITE_CONFIG, ...initialConfig }));
  const [syncState, setSyncState] = useState<"loading" | "live" | "unavailable">(initialPosts.length ? "live" : initialNotionConfigured ? "loading" : "unavailable");
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [contentSearch, setContentSearch] = useState<{ query: string; ids: string[] }>({ query: "", ids: [] });
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [wordCloudOpen, setWordCloudOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [articleOpening, setArticleOpening] = useState<ArticleOpening | null>(null);
  const articleOpeningRef = useRef(false);
  const transitionTimersRef = useRef<number[]>([]);

  useEffect(() => () => {
    transitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    document.body.classList.remove("article-transition-playing");
  }, []);

  const openArticle = useCallback((post: Post, bounds: DOMRect) => {
    if (articleOpeningRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    articleOpeningRef.current = true;
    const href = `/blog/${encodeURIComponent(post.slug)}`;
    // Warm the full HTML document during the visual transition. Article RSC
    // requests do not carry the Worker's render context reliably on every
    // Vinext/browser combination, while document navigation does.
    void fetch(href, { credentials: "same-origin", headers: { accept: "text/html" } }).catch(() => {});
    document.body.classList.add("article-transition-playing");
    setArticleOpening({
      bounds: { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height },
      date: formatDate(post.date),
      icon: post.icon,
      title: post.title,
    });
    transitionTimersRef.current.push(window.setTimeout(() => window.location.assign(href), 840));
    return true;
  }, []);

  useEffect(() => {
    if (!siteConfig.wordCloudEnabled) return;
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
  }, [siteConfig.wordCloudEnabled]);

  const retrySync = () => {
    setSyncState("loading");
    setRefreshKey((value) => value + 1);
  };

  const closeWordCloud = useCallback(() => {
    if (window.location.hash === "#word-cloud") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setWordCloudOpen(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previousPalette = root.dataset.palette;
    const variables = siteThemeVariables(siteConfig);
    const previousVariables = new Map(Object.keys(variables).map((name) => [name, root.style.getPropertyValue(name)]));
    root.dataset.palette = siteConfig.themePreset;
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
    return () => {
      if (previousPalette) root.dataset.palette = previousPalette;
      else delete root.dataset.palette;
      for (const [name, value] of previousVariables) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
    };
  }, [siteConfig]);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("blog-theme"); }
    catch { /* Use the system theme when storage is unavailable. */ }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const configuredDark = siteConfig.themeMode === "dark" || (siteConfig.themeMode === "system" && prefersDark);
    const resolvedDark = siteConfig.themeToggleEnabled && (saved === "dark" || saved === "light")
      ? saved === "dark"
      : configuredDark;
    const frame = window.requestAnimationFrame(() => {
      setDark(resolvedDark);
      setThemeReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [siteConfig.themeMode, siteConfig.themeToggleEnabled]);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { if (siteConfig.themeToggleEnabled) window.localStorage.setItem("blog-theme", dark ? "dark" : "light"); }
    catch { /* Theme switching still works without persistence. */ }
  }, [dark, themeReady, siteConfig.themeToggleEnabled]);

  useEffect(() => {
    // The server-rendered bootstrap and the hourly Worker sync are the source
    // of truth. Avoid making every open tab poll Notion; retrySync remains the
    // explicit recovery path for a failed initial request.
    if (initialPosts.length > 0 || !initialNotionConfigured) return;
    const controller = new AbortController();
    fetch("/api/content/posts", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Content refresh failed");
        const data = await response.json();
        if (!Array.isArray(data.posts)) throw new Error("Invalid content response");
        setPosts(data.posts);
        setSiteLinks(Array.isArray(data.links) ? data.links : []);
        setNotice(data.notice?.id && data.notice?.title ? data.notice : undefined);
        if (data.config?.author && data.config?.since) setSiteConfig({ ...DEFAULT_SITE_CONFIG, ...data.config });
        setSyncState("live");
      })
      .catch(() => { if (!controller.signal.aborted) setSyncState("unavailable"); });
    return () => controller.abort();
  }, [initialNotionConfigured, initialPosts.length, refreshKey]);

  useEffect(() => {
    const needle = normalizeSearchText(deferredQuery);
    if (needle.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/content/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => setContentSearch({ query: needle, ids: Array.isArray(data.matches) ? data.matches : [] }))
        .catch(() => { if (!controller.signal.aborted) setContentSearch({ query: needle, ids: [] }); });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [deferredQuery]);

  const normalizedValue = normalizeSearchText(deferredQuery);
  const normalizedQuery = normalizedValue.length >= 2 ? normalizedValue : "";
  const searching = Boolean(normalizedQuery && contentSearch.query !== normalizedQuery);

  const categories = useMemo(() => {
    const found = Array.from(new Set(posts.map((post) => post.category).filter(Boolean)));
    return [ALL, ...found];
  }, [posts]);
  const visible = useMemo(() => {
    const needle = normalizedQuery;
    const contentMatches = contentSearch.query === needle ? new Set(contentSearch.ids) : new Set<string>();
    return posts.filter((post) => (category === ALL || post.category === category)
      && (!needle
        || normalizeSearchText([post.title, post.summary, post.category, ...post.tags].join(" ")).includes(needle)
        || contentMatches.has(post.id)));
  }, [posts, category, normalizedQuery, contentSearch]);

  const groups = useMemo(() => {
    if (!siteConfig.categoriesEnabled) return [[ALL, visible] as [string, Post[]]];
    const map = new Map<string, Post[]>();
    visible.forEach((post) => {
      const key = post.category || "未分类";
      map.set(key, [...(map.get(key) || []), post]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => categories.indexOf(a) - categories.indexOf(b));
  }, [visible, categories, siteConfig.categoriesEnabled]);

  const selectCategory = (value: string) => {
    setCategory(value);
    window.requestAnimationFrame(() => document.getElementById("posts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="blog-frame">
      <ArticleOpenTransition opening={articleOpening} />
      <SiteSidebar
        siteLinks={siteLinks}
        siteConfig={siteConfig}
        postCount={posts.length}
        syncState={syncState}
        categories={siteConfig.categoriesEnabled ? categories : []}
        activeCategory={category}
        onCategoryChange={selectCategory}
      />
      {siteConfig.wordCloudEnabled ? <WordCloudDialog open={wordCloudOpen} posts={posts} onClose={closeWordCloud} /> : null}

      <main className="blog-main">
        <header className="blog-toolbar">
          <div className="welcome-block">
            {notice ? <p className="welcome"><span className="notice-icon" aria-hidden>{notice.icon || <Sparkle size={19} weight="fill" />}</span><span>{notice.title}{notice.summary ? <span className="welcome-tagline">{notice.summary}</span> : null}</span></p> : null}
            {syncState === "unavailable" && posts.length > 0 && <button className="sync-warning" type="button" onClick={retrySync}>显示最近内容 · 重试同步</button>}
          </div>

          <div className="toolbar-actions">
            {siteConfig.searchEnabled ? <label className={`search-box${searching ? " searching" : ""}`}>
              <span className="sr-only">搜索文章</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、正文…"
                aria-busy={searching}
              />
              <MagnifyingGlass aria-hidden size={20} />
            </label> : null}
            {siteConfig.themeToggleEnabled ? <button className="icon-button" type="button" onClick={() => setDark((value) => !value)} aria-label={dark ? "切换为浅色模式" : "切换为深色模式"}>
              {dark ? <Sun aria-hidden size={21} /> : <Moon aria-hidden size={21} />}
              <span className="theme-label">{dark ? "浅色" : "深色"}</span>
            </button> : null}
          </div>
        </header>

        <section className="posts-shell" id="posts" aria-label="全部文章">
          {groups.map(([name, items]) => (
            <section className="category-section" key={name} aria-labelledby={`category-${slugify(name)}`}>
              {siteConfig.categoriesEnabled ? <h2 id={`category-${slugify(name)}`}>#&nbsp; {name}</h2> : null}
              <div className="post-grid">
                {items.map((post, index) => <PostCard post={post} index={index} onOpen={openArticle} key={post.id} />)}
              </div>
            </section>
          ))}

          {!visible.length && searching && <div className="search-skeleton" aria-label="正在检索正文" aria-busy="true"><i /><i /><i /><i /></div>}
          {!visible.length && !searching && (
            <div className="empty">
              <FileText aria-hidden size={30} />
              <p>{!initialNotionConfigured ? "请先配置 Notion 内容源。" : syncState === "loading" ? "正在从 Notion 读取文章…" : syncState === "unavailable" ? "内容源暂时不可用。" : "没有找到匹配的文章。"}</p>
              {initialNotionConfigured && syncState === "unavailable" && <button type="button" onClick={retrySync}>重新连接</button>}
            </div>
          )}
        </section>

        <ContentFooter id="about" siteConfig={siteConfig} postCount={posts.length} />
      </main>
    </div>
  );
}

function PostCard({ post, index, onOpen }: { post: Post; index: number; onOpen: (post: Post, bounds: DOMRect) => boolean }) {
  const open = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const card = event.currentTarget.closest<HTMLElement>(".post-card");
    if (card && onOpen(post, card.getBoundingClientRect())) event.preventDefault();
  };
  const href = `/blog/${encodeURIComponent(post.slug)}`;
  return (
    <article className="post-card" title={post.summary || undefined} style={{ "--card-order": Math.min(index, 8) } as CSSProperties}>
      {post.icon ? <span className="post-emoji" aria-label={`Notion 图标 ${post.icon}`}>{post.icon}</span> : null}
      <div className="post-card-body">
        <div className="post-card-title">
          <h3><a href={href} onClick={open}>{post.title}</a></h3>
          {post.locked && <span className="lock-badge" title="这篇文章需要密码"><LockSimple aria-label="需密码" size={15} weight="fill" /></span>}
        </div>
        <time dateTime={post.date}>{formatDate(post.date)}</time>
      </div>
      <a className="card-link" href={href} onClick={open} aria-label={`阅读 ${post.title}`} />
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

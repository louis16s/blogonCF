"use client";

import { ArrowLeft, ArrowRight, ArrowSquareOut, CaretRight, Eye, EyeSlash, FileText, LockKey, Rss } from "@phosphor-icons/react";
import { FormEvent, type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ChildPage, ContentBlock, Post } from "../data/types";
import { CONTENT_REFRESH_INTERVAL_MS } from "./siteBootstrap";

const HEIC_DECODE_CONCURRENCY = 3;
let activeHeicDecodes = 0;
const pendingHeicDecodes: Array<() => void> = [];

async function withHeicDecodeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeHeicDecodes >= HEIC_DECODE_CONCURRENCY) await new Promise<void>((resolve) => pendingHeicDecodes.push(resolve));
  activeHeicDecodes += 1;
  try { return await task(); }
  finally {
    activeHeicDecodes -= 1;
    pendingHeicDecodes.shift()?.();
  }
}

type ArticleClientProps = {
  slug: string;
  contentKind?: "post" | "page";
  initialPost?: Post;
  initialBlocks?: ContentBlock[];
  initialLocked?: boolean;
  initialFetched?: boolean;
  initialError?: string;
  initialTruncated?: boolean;
};

type ExternalFeed = { url: string; title: string; source: string; items: Array<{ id: string; title: string; url: string; published: string; summary: string }> };

async function requestChildPage(endpoint: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<ChildPage> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "子页面读取失败");
  return data.child;
}

function scrollToArticleStart() {
  window.requestAnimationFrame(() => {
    const article = document.querySelector<HTMLElement>(".article-shell article");
    if (!article) return;
    const top = Math.max(0, article.getBoundingClientRect().top + window.scrollY - 18);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  });
}

export function ArticleClient({ slug, contentKind = "post", initialPost, initialBlocks = [], initialLocked = false, initialFetched = false, initialError = "", initialTruncated = false }: ArticleClientProps) {
  const [post, setPost] = useState<Post | undefined>(initialPost);
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks);
  const [locked, setLocked] = useState(initialLocked);
  const [loading, setLoading] = useState(!initialFetched);
  const [error, setError] = useState(initialError);
  const [truncated, setTruncated] = useState(initialTruncated);
  const [childTrail, setChildTrail] = useState<ChildPage[]>([]);
  const [childLoading, setChildLoading] = useState(false);
  const [childOpening, setChildOpening] = useState(false);
  const [childError, setChildError] = useState("");
  const [feeds, setFeeds] = useState<ExternalFeed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(false);
  const passwordRef = useRef("");
  const childIdRef = useRef("");
  const childTrailRef = useRef<ChildPage[]>([]);
  const childRequestRef = useRef<AbortController | null>(null);
  const skipInitialRefresh = useRef(initialFetched);
  const lastRefreshAt = useRef(0);
  const contentEndpoint = contentKind === "page" ? "/api/content/page" : "/api/content/post";
  const childEndpoint = contentKind === "page" ? "/api/content/page-child" : "/api/content/child";

  const loadChild = useCallback((pageId: string, passwordOverride?: string, updateHistory = true) => {
    childRequestRef.current?.abort();
    const controller = new AbortController();
    childRequestRef.current = controller;
    setChildLoading(true); setChildOpening(true); setChildError("");
    scrollToArticleStart();
    const password = passwordOverride ?? passwordRef.current;
    requestChildPage(childEndpoint, { slug, pageId, password, trail: childTrailRef.current.map((item) => item.id) }, controller.signal)
      .then((child) => {
        childIdRef.current = child.id;
        setChildTrail((current) => {
          const previous = current.findIndex((item) => item.id === child.id);
          const next = previous >= 0 ? current.slice(0, previous + 1) : [...current, child];
          childTrailRef.current = next;
          return next;
        });
        if (updateHistory) {
          const url = new URL(window.location.href);
          url.searchParams.set("child", child.id);
          window.history.pushState({ child: child.id }, "", url);
        }
      })
      .catch((reason) => { if (reason.name !== "AbortError") setChildError(reason.message || "子页面暂时无法读取"); })
      .finally(() => {
        if (childRequestRef.current === controller) {
          childRequestRef.current = null;
          setChildLoading(false);
          setChildOpening(false);
        }
      });
  }, [childEndpoint, slug]);

  const loadMoreChild = useCallback(() => {
    const currentChild = childTrailRef.current.at(-1);
    if (!currentChild?.hasMore || !currentChild.nextCursor || childRequestRef.current) return;
    const controller = new AbortController();
    childRequestRef.current = controller;
    setChildLoading(true); setChildError("");
    requestChildPage(childEndpoint, {
      slug,
      pageId: currentChild.id,
      password: passwordRef.current,
      trail: childTrailRef.current.map((item) => item.id),
      cursor: currentChild.nextCursor,
    }, controller.signal)
      .then((page) => {
        setChildTrail((current) => {
          const index = current.findIndex((item) => item.id === page.id);
          if (index < 0) return current;
          const next = [...current];
          next[index] = {
            ...next[index],
            blocks: [...next[index].blocks, ...page.blocks],
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            truncated: Boolean(next[index].truncated || page.truncated),
          };
          childTrailRef.current = next;
          return next;
        });
      })
      .catch((reason) => { if (reason.name !== "AbortError") setChildError(reason.message || "下一段内容暂时无法读取"); })
      .finally(() => {
        if (childRequestRef.current === controller) {
          childRequestRef.current = null;
          setChildLoading(false);
        }
      });
  }, [childEndpoint, slug]);

  const load = (password?: string) => {
    setLoading(true); setError("");
    fetch(`${contentEndpoint}/${encodeURIComponent(slug)}`, password ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : undefined)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "文章读取失败");
        if (password && !data.locked) passwordRef.current = password;
        setPost(data.post); setLocked(Boolean(data.locked)); setBlocks(data.blocks || []); setTruncated(Boolean(data.truncated));
      })
      .catch((reason) => setError(reason.message || "文章暂时无法读取"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      const password = passwordRef.current;
      try {
        const response = await fetch(`${contentEndpoint}/${encodeURIComponent(slug)}`, password ? { method: "POST", signal: controller.signal, cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "文章读取失败");
        setPost(data.post);
        setLocked(Boolean(data.locked));
        setBlocks(data.blocks || []);
        setTruncated(Boolean(data.truncated));
        setError("");
      } catch (reason) {
        if (reason instanceof Error && reason.name !== "AbortError") {
          passwordRef.current = "";
          setError("实时同步暂时不可用，正在显示最近内容。");
        }
      } finally {
        inFlight = false;
        lastRefreshAt.current = Date.now();
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    if (skipInitialRefresh.current) {
      skipInitialRefresh.current = false;
      lastRefreshAt.current = Date.now();
    }
    else void refresh();
    const timer = window.setInterval(refresh, CONTENT_REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshAt.current >= CONTENT_REFRESH_INTERVAL_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [contentEndpoint, slug]);

  useEffect(() => {
    const syncChildFromUrl = () => {
      const pageId = new URL(window.location.href).searchParams.get("child");
      if (!pageId) { childIdRef.current = ""; childTrailRef.current = []; setChildTrail([]); setChildError(""); return; }
      if (!locked && post && childIdRef.current !== pageId) {
        const previous = childTrailRef.current.findIndex((item) => item.id === pageId);
        if (previous >= 0) {
          const next = childTrailRef.current.slice(0, previous + 1);
          childTrailRef.current = next;
          childIdRef.current = pageId;
          setChildTrail(next);
        } else loadChild(pageId, undefined, false);
      }
    };
    syncChildFromUrl();
    window.addEventListener("popstate", syncChildFromUrl);
    return () => window.removeEventListener("popstate", syncChildFromUrl);
  }, [locked, post, loadChild]);

  useEffect(() => () => childRequestRef.current?.abort(), []);

  const isNewsPage = contentKind === "page" && /资讯|news|links/i.test(`${slug} ${post?.title || ""}`);
  useEffect(() => {
    if (!isNewsPage) return;
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => setFeedsLoading(true), 80);
    fetch(`/api/content/rss-feeds?slug=${encodeURIComponent(slug)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { if (!controller.signal.aborted) setFeeds(Array.isArray(data.feeds) ? data.feeds : []); })
      .catch(() => { if (!controller.signal.aborted) setFeeds([]); })
      .finally(() => { window.clearTimeout(loadingTimer); if (!controller.signal.aborted) setFeedsLoading(false); });
    return () => { window.clearTimeout(loadingTimer); controller.abort(); };
  }, [isNewsPage, slug]);

  const closeChild = () => {
    childRequestRef.current?.abort();
    childRequestRef.current = null;
    setChildLoading(false);
    setChildOpening(false);
    setChildTrail((current) => {
      const next = current.slice(0, -1);
      const url = new URL(window.location.href);
      const previous = next.at(-1);
      childIdRef.current = previous?.id || "";
      childTrailRef.current = next;
      if (previous) url.searchParams.set("child", previous.id);
      else url.searchParams.delete("child");
      window.history.replaceState(previous ? { child: previous.id } : {}, "", url);
      return next;
    });
    setChildError("");
    scrollToArticleStart();
  };

  if (loading && !post) return <p className="article-state">正在从 Notion 读取{contentKind === "page" ? "页面" : "文章"}…</p>;
  if (!post) return <p className="article-state">{error || (contentKind === "page" ? "没有找到这个页面。" : "没有找到这篇文章。")}</p>;

  const activeChild = childTrail.at(-1);
  const isChildView = childOpening || Boolean(activeChild);

  return <>
    {!isChildView ? <header className="article-head">
      <p className="eyebrow">{contentKind === "page" ? "LOUIS16S · PAGE" : `${post.category} · ${post.date}`}</p>
      <div className="article-title-row">
        <h1>{contentKind === "page" && post.icon ? <span className="page-title-icon" aria-hidden>{post.icon}</span> : null}{post.title}</h1>
        {post.summary ? <p className="article-summary">{post.summary}</p> : null}
      </div>
      {post.tags.length ? <div className="tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
    </header> : null}
    {locked ? <PasswordForm onSubmit={load} error={error} loading={loading} /> : childOpening ? <ChildLoading /> : activeChild ? <ChildDocument child={activeChild} parentTitle={childTrail.at(-2)?.title || post.title} onBack={closeChild} onOpenChild={loadChild} onLoadMore={loadMoreChild} loading={childLoading} error={childError} /> : blocks.length ? <div className="notion-content"><Blocks blocks={blocks} onOpenChild={loadChild} />{isNewsPage ? <ExternalRssFeeds feeds={feeds} loading={feedsLoading} /> : null}{truncated ? <ContentLimitNotice /> : null}{childError ? <p className="child-page-error" role="alert">{childError}</p> : null}</div> : <div className="article-state"><p>{loading ? "正在同步正文…" : error || "正文需要配置 Notion 连接后显示。"}</p></div>}
  </>;
}

function ExternalRssFeeds({ feeds, loading }: { feeds: ExternalFeed[]; loading: boolean }) {
  if (loading) return <section className="external-feeds is-loading" aria-label="正在读取订阅" aria-busy="true"><div /><div /><div /></section>;
  if (!feeds.length) return null;
  return <section className="external-feeds" aria-labelledby="external-feeds-title">
    <header><p className="eyebrow"><Rss aria-hidden size={14} /> RSS READER</p><h2 id="external-feeds-title">订阅动态</h2></header>
    {feeds.flatMap((feed) => feed.items.map((item) => <a className="external-feed-item" key={item.id} href={item.url} target="_blank" rel="noreferrer"><span><small>{feed.title || feed.source}{item.published ? ` · ${formatFeedDate(item.published)}` : ""}</small><strong>{item.title}</strong>{item.summary ? <em>{item.summary}</em> : null}</span><ArrowSquareOut aria-hidden size={16} /></a>))}
  </section>;
}

function formatFeedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function ChildLoading() {
  return <section className="child-document child-document-loading" aria-busy="true" aria-label="正在读取子页面">
    <span className="child-loading-mark" aria-hidden><FileText size={20} /></span>
    <h2>正在展开页面</h2>
    <p>正在整理标题与正文，请稍候。</p>
    <div className="child-loading-lines" aria-hidden><span /><span /><span /></div>
  </section>;
}

function ChildDocument({ child, parentTitle, onBack, onOpenChild, onLoadMore, loading, error }: { child: ChildPage; parentTitle: string; onBack: () => void; onOpenChild: (pageId: string) => void; onLoadMore: () => void; loading: boolean; error: string }) {
  return <section className="child-document" aria-labelledby={`child-${child.id}`}>
    <nav className="child-document-nav" aria-label="子页面导航">
      <button type="button" onClick={onBack} aria-label={`返回 ${parentTitle}`}>
        <span className="child-back-icon" aria-hidden><ArrowLeft size={17} /></span>
        <span><small>返回上一级</small><strong>{parentTitle}</strong></span>
      </button>
    </nav>
    <header className="child-document-head">
      {child.icon ? <span className="child-document-icon" aria-hidden>{child.icon}</span> : null}
      <h2 id={`child-${child.id}`}>{child.title}</h2>
    </header>
    <div className="child-document-body">
      <div className="notion-content"><Blocks blocks={child.blocks} onOpenChild={onOpenChild} /></div>
    </div>
    {child.truncated ? <ContentLimitNotice /> : null}
    {child.hasMore ? <button className="child-page-more" type="button" onClick={onLoadMore} disabled={loading}>{loading ? "正在读取下一段…" : "继续读取"}</button> : null}
    {loading && !child.hasMore ? <p className="child-page-status" role="status">正在读取子页面…</p> : null}
    {error ? <p className="child-page-error" role="alert">{error}</p> : null}
  </section>;
}

function ContentLimitNotice() {
  return <p className="content-limit-notice" role="status">这篇 Notion 内容超出单次同步上限，当前页面可能未完整显示。请稍后重试或拆分页面。</p>;
}

function PasswordForm({ onSubmit, error, loading }: { onSubmit: (value: string) => void; error: string; loading: boolean }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!loading) onSubmit(password); };
  return <form className="password-card" onSubmit={submit}>
    <div className="password-card-head">
      <span className="password-lock" aria-hidden><LockKey size={22} weight="duotone" /></span>
      <div><p className="eyebrow">PRIVATE NOTE</p><h2>这篇文章需要密码</h2><p>输入访问密码，按 Enter 也可以直接解锁。</p></div>
    </div>
    <div className="password-card-fields">
      <label htmlFor="article-password">访问密码</label>
      <div className="password-input-wrap">
        <input id="article-password" type={visible ? "text" : "password"} autoComplete="current-password" enterKeyHint="go" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-hint" required />
        <button className="password-visibility" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏密码" : "显示密码"}>{visible ? <EyeSlash aria-hidden size={19} /> : <Eye aria-hidden size={19} />}</button>
      </div>
      <button className="password-submit" type="submit" disabled={loading}>{loading ? "正在验证…" : <><span>解锁文章</span><ArrowRight aria-hidden size={17} /></>}</button>
    </div>
    <p id="password-hint" className="password-hint">密码只用于本次验证，不会保存在浏览器中。</p>
    {error && <p className="password-error" role="alert">{error}</p>}
  </form>;
}

type TocItem = { id: string; label: string; level: number };

function collectHeadings(blocks: ContentBlock[]): TocItem[] {
  return blocks.flatMap((block) => {
    const own = /^heading_[123]$/.test(block.type)
      ? [{ id: block.id, label: block.richText?.map((item) => item.text).join("") || "未命名章节", level: Number(block.type.at(-1)) }]
      : [];
    return [...own, ...(block.children?.length ? collectHeadings(block.children) : [])];
  });
}

function Blocks({ blocks, onOpenChild, toc = collectHeadings(blocks) }: { blocks: ContentBlock[]; onOpenChild: (pageId: string) => void; toc?: TocItem[] }) {
  const output: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    const listType = block.type === "bulleted_list_item" ? "ul" : block.type === "numbered_list_item" ? "ol" : "";
    if (!listType) {
      output.push(<Block key={block.id} block={block} onOpenChild={onOpenChild} toc={toc} />);
      index += 1;
      continue;
    }
    const items: ContentBlock[] = [];
    while (index < blocks.length && blocks[index].type === block.type) items.push(blocks[index++]);
    const List = listType;
    output.push(<List key={`${block.id}-list`} className="notion-list">{items.map((item) => <li key={item.id}><Rich value={item.richText} onOpenChild={onOpenChild} />{item.children?.length ? <Blocks blocks={item.children} onOpenChild={onOpenChild} toc={toc} /> : null}</li>)}</List>);
  }
  return <>{output}</>;
}

function Rich({ value = [], onOpenChild }: { value?: ContentBlock["richText"]; onOpenChild: (pageId: string) => void }) {
  return <>{value?.map((item, index) => {
    let node = <>{item.text}</>;
    if (item.code) node = <code>{node}</code>;
    if (item.bold) node = <strong>{node}</strong>;
    if (item.italic) node = <em>{node}</em>;
    if (item.strikethrough) node = <s>{node}</s>;
    if (item.underline) node = <u>{node}</u>;
    const className = item.color ? `notion-color-${item.color}` : undefined;
    if (!item.href) return <span className={className} key={index}>{node}</span>;
    const pageId = notionPageIdFromHref(item.href);
    if (pageId) return <a className={className} key={index} href={`?child=${encodeURIComponent(pageId)}`} onClick={(event) => { event.preventDefault(); onOpenChild(pageId); }}>{node}</a>;
    const external = /^https?:\/\//i.test(item.href);
    return <a className={className} key={index} href={item.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{node}</a>;
  })}</>;
}

function notionPageIdFromHref(href: string): string {
  try {
    const url = new URL(href);
    if (!/(^|\.)notion\.(?:so|site|com)$/i.test(url.hostname)) return "";
    const match = url.pathname.replaceAll("-", "").match(/([a-f0-9]{32})(?:\/)?$/i);
    if (!match) return "";
    const id = match[1].toLocaleLowerCase();
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  } catch { return ""; }
}

function bookmarkSource(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function bookmarkFavicon(url: string): string {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function BookmarkFavicon({ url }: { url: string }) {
  const favicon = bookmarkFavicon(url);
  return <span className="bookmark-preview" aria-hidden>{favicon ? (
    // The favicon is discovered at runtime and has no stable dimensions for next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={favicon} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />
  ) : null}</span>;
}

function notionImageIdentity(block: ContentBlock): string {
  try {
    const gateway = new URL(block.url || "", "https://notion-image.local");
    const source = new URL(gateway.searchParams.get("url") || "");
    return `${block.id}:${source.hostname}${source.pathname}`;
  } catch { return block.id; }
}

function NotionHeicImage({ src, identity, alt, caption }: { src: string; identity: string; alt: string; caption?: string }) {
  const figureRef = useRef<HTMLElement>(null);
  const sourceRef = useRef(src);
  const [renderedUrl, setRenderedUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => { sourceRef.current = src; }, [src]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    let observer: IntersectionObserver | undefined;
    const load = async () => {
      try {
        const jpeg = await withHeicDecodeSlot(async () => {
          controller.signal.throwIfAborted();
          const response = await fetch(sourceRef.current, { signal: controller.signal });
          if (!response.ok) throw new Error("Image fetch failed");
          const { heicTo } = await import("heic-to/csp");
          return heicTo({ blob: await response.blob(), type: "image/jpeg", quality: 0.86 });
        });
        if (!active) return;
        objectUrl = URL.createObjectURL(jpeg);
        setRenderedUrl(objectUrl);
      } catch (reason) {
        if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setFailed(true);
      }
    };
    const target = figureRef.current;
    if (target && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { observer?.disconnect(); void load(); }
      }, { rootMargin: "800px 0px" });
      observer.observe(target);
    } else void load();
    return () => { active = false; controller.abort(); observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [identity]);

  return <figure ref={figureRef} className="notion-heic-image">
    {renderedUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={renderedUrl} alt={alt} />
      : <div className="notion-image-state" role={failed ? "alert" : "status"}>{failed ? "这张图片暂时无法显示" : "正在加载图片…"}</div>}
    {caption ? <figcaption>{caption}</figcaption> : null}
  </figure>;
}

function NotionImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  // Signed Notion URLs do not provide dimensions required by next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <figure><img src={src} alt={alt} loading="lazy" />{caption ? <figcaption>{caption}</figcaption> : null}</figure>;
}

function Block({ block, onOpenChild, toc }: { block: ContentBlock; onOpenChild: (pageId: string) => void; toc: TocItem[] }) {
  const children = block.children?.length ? <Blocks blocks={block.children} onOpenChild={onOpenChild} toc={toc} /> : null;
  const className = block.color ? `notion-block notion-color-${block.color}` : "notion-block";
  switch (block.type) {
    case "paragraph": return <div className={className}><p><Rich value={block.richText} onOpenChild={onOpenChild} /></p>{children}</div>;
    case "heading_1": return <div className={className}><h2 id={block.id}><Rich value={block.richText} onOpenChild={onOpenChild} /></h2>{children}</div>;
    case "heading_2": return <div className={className}><h3 id={block.id}><Rich value={block.richText} onOpenChild={onOpenChild} /></h3>{children}</div>;
    case "heading_3": return <div className={className}><h4 id={block.id}><Rich value={block.richText} onOpenChild={onOpenChild} /></h4>{children}</div>;
    case "to_do": return <div className={`${className} notion-todo`}><input type="checkbox" checked={Boolean(block.checked)} readOnly aria-label={block.checked ? "已完成" : "未完成"} /><div><Rich value={block.richText} onOpenChild={onOpenChild} />{children}</div></div>;
    case "quote": return <div className={className}><blockquote><Rich value={block.richText} onOpenChild={onOpenChild} />{children}</blockquote></div>;
    case "callout": return <aside className={`${className} callout`}><span>{block.icon}</span><div><Rich value={block.richText} onOpenChild={onOpenChild} />{children}</div></aside>;
    case "toggle": return <details className={`${className} notion-toggle`} open><summary><Rich value={block.richText} onOpenChild={onOpenChild} /></summary><div>{children}</div></details>;
    case "code": return <figure className={`${className} notion-code`}><pre><code data-language={block.language}><Rich value={block.richText} onOpenChild={onOpenChild} /></code></pre>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    case "divider": return <hr />;
    case "image": return block.url ? block.url.startsWith("/_notion/image?")
      ? <NotionHeicImage src={block.url} identity={notionImageIdentity(block)} alt={block.caption || "文章图片"} caption={block.caption} />
      : <NotionImage src={block.url} alt={block.caption || "文章图片"} caption={block.caption} /> : null;
    case "bookmark": return block.url ? <a className={`${className} bookmark`} href={block.url} target="_blank" rel="noreferrer"><BookmarkFavicon url={block.url} /><span className="bookmark-copy"><strong>{block.caption || bookmarkSource(block.url)}</strong><small>{bookmarkSource(block.url)} · {block.url}</small></span><ArrowSquareOut aria-hidden size={16} /></a> : null;
    case "embed": return block.url ? <figure className={`${className} notion-embed`}><iframe src={block.url} title={block.caption || "Notion 嵌入内容"} loading="lazy" allowFullScreen sandbox="allow-forms allow-popups allow-same-origin allow-scripts" />{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "video": return block.url ? <figure className={`${className} notion-media`}><video src={block.url} controls preload="metadata">浏览器无法播放这个视频。</video>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "audio": return block.url ? <figure className={`${className} notion-media notion-audio`}><audio src={block.url} controls preload="metadata">浏览器无法播放这段音频。</audio>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "pdf": return block.url ? <figure className={`${className} notion-pdf`}><iframe src={block.url} title={block.caption || "PDF 文档"} loading="lazy" /><a href={block.url} target="_blank" rel="noreferrer">在新窗口打开 PDF<ArrowSquareOut aria-hidden size={15} /></a>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "file": return block.url ? <a className="bookmark" href={block.url} target="_blank" rel="noreferrer"><span><strong>{block.caption || "下载附件"}</strong><small>{bookmarkSource(block.url)}</small></span><ArrowSquareOut aria-hidden size={16} /></a> : null;
    case "child_page": return block.pageId ? <a className={`${className} notion-child-page`} href={`?child=${encodeURIComponent(block.pageId)}`} onClick={(event) => { event.preventDefault(); onOpenChild(block.pageId!); }}><FileText aria-hidden size={18} /><strong>{block.caption || "子页面"}</strong><CaretRight aria-hidden size={16} /></a> : null;
    case "child_database": return block.url ? <a className={`${className} notion-child-page`} href={block.url} target="_blank" rel="noreferrer"><FileText aria-hidden size={18} /><strong>{block.caption || "子数据库"}</strong><ArrowSquareOut aria-hidden size={16} /></a> : null;
    case "equation": return <div className="equation" aria-label="数学公式">{block.caption}</div>;
    case "table": return <div className="notion-table" role="table">{children}</div>;
    case "table_row": return <div className="notion-table-row" role="row">{block.children?.map((cell, index) => <div role="cell" key={`${block.id}-${index}`}><Rich value={cell.richText} onOpenChild={onOpenChild} /></div>)}</div>;
    case "column_list": return <div className={`${className} columns`}>{children}</div>;
    case "column": return <div className="column">{children}</div>;
    case "synced_block": case "template": return <div className={className}>{children}</div>;
    case "table_of_contents": return toc.length ? <nav className={`${className} notion-toc`} aria-label="文章目录"><strong>目录</strong>{toc.map((item) => <a href={`#${item.id}`} style={{ "--toc-level": item.level } as CSSProperties} key={item.id}>{item.label}</a>)}</nav> : null;
    case "breadcrumb": return <div className={`${className} notion-breadcrumb`}>当前位置</div>;
    case "unsupported": return <aside className="unsupported">此内容块暂不支持显示。</aside>;
    default: return children ? <div>{children}</div> : <aside className="unsupported">未识别的内容块：{block.type}</aside>;
  }
}

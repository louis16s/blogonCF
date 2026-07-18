"use client";

import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { ContentBlock, Post } from "../data/types";

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
  initialPost?: Post;
  initialBlocks?: ContentBlock[];
  initialLocked?: boolean;
  initialFetched?: boolean;
  initialError?: string;
};

export function ArticleClient({ slug, initialPost, initialBlocks = [], initialLocked = false, initialFetched = false, initialError = "" }: ArticleClientProps) {
  const [post, setPost] = useState<Post | undefined>(initialPost);
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks);
  const [locked, setLocked] = useState(initialLocked);
  const [loading, setLoading] = useState(!initialFetched);
  const [error, setError] = useState(initialError);
  const passwordRef = useRef("");
  const skipInitialRefresh = useRef(initialFetched);

  const load = (password?: string) => {
    setLoading(true); setError("");
    fetch(`/api/content/post/${encodeURIComponent(slug)}`, password ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : undefined)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "文章读取失败");
        if (password && !data.locked) passwordRef.current = password;
        setPost(data.post); setLocked(Boolean(data.locked)); setBlocks(data.blocks || []);
      })
      .catch((reason) => setError(reason.message || "文章暂时无法读取"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      const password = passwordRef.current;
      return fetch(`/api/content/post/${encodeURIComponent(slug)}`, password ? { method: "POST", signal: controller.signal, cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) } : { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "文章读取失败");
        setPost(data.post); setLocked(Boolean(data.locked)); setBlocks(data.blocks || []);
      })
      .catch((reason) => { if (reason.name !== "AbortError") { passwordRef.current = ""; setPost(undefined); setBlocks([]); setLocked(false); setError(reason.message || "文章不存在、已撤回或暂时无法读取"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    };
    if (skipInitialRefresh.current) skipInitialRefresh.current = false;
    else void refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [slug]);

  if (loading && !post) return <p className="article-state">正在从 Notion 读取文章…</p>;
  if (!post) return <p className="article-state">{error || "没有找到这篇文章。"}</p>;

  return <>
    <header className="article-head"><p className="eyebrow">{post.category} · {post.date}</p><h1>{post.title}</h1><p>{post.summary}</p><div className="tags">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div></header>
    {locked ? <PasswordForm onSubmit={load} error={error} /> : blocks.length ? <div className="notion-content"><Blocks blocks={blocks} /></div> : <div className="article-state"><p>{loading ? "正在同步正文…" : error || "正文需要配置 Notion 连接后显示。"}</p></div>}
  </>;
}

function PasswordForm({ onSubmit, error }: { onSubmit: (value: string) => void; error: string }) {
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(password); };
  return <form className="password-card" onSubmit={submit}><p className="eyebrow">PRIVATE NOTE</p><h2>这篇文章需要密码</h2><label>访问密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button>解锁文章</button>{error && <p role="alert">{error}</p>}</form>;
}

function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  const output: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    const listType = block.type === "bulleted_list_item" ? "ul" : block.type === "numbered_list_item" ? "ol" : "";
    if (!listType) {
      output.push(<Block key={block.id} block={block} />);
      index += 1;
      continue;
    }
    const items: ContentBlock[] = [];
    while (index < blocks.length && blocks[index].type === block.type) items.push(blocks[index++]);
    const List = listType;
    output.push(<List key={`${block.id}-list`} className="notion-list">{items.map((item) => <li key={item.id}><Rich value={item.richText} />{item.children?.length ? <Blocks blocks={item.children} /> : null}</li>)}</List>);
  }
  return <>{output}</>;
}

function Rich({ value = [] }: { value?: ContentBlock["richText"] }) {
  return <>{value?.map((item, index) => {
    let node = <>{item.text}</>;
    if (item.code) node = <code>{node}</code>;
    if (item.bold) node = <strong>{node}</strong>;
    if (item.italic) node = <em>{node}</em>;
    if (item.strikethrough) node = <s>{node}</s>;
    if (item.underline) node = <u>{node}</u>;
    const className = item.color ? `notion-color-${item.color}` : undefined;
    return item.href ? <a className={className} key={index} href={item.href} target="_blank" rel="noreferrer">{node}</a> : <span className={className} key={index}>{node}</span>;
  })}</>;
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

function Block({ block }: { block: ContentBlock }) {
  const children = block.children?.length ? <Blocks blocks={block.children} /> : null;
  const className = block.color ? `notion-block notion-color-${block.color}` : "notion-block";
  switch (block.type) {
    case "paragraph": return <div className={className}><p><Rich value={block.richText} /></p>{children}</div>;
    case "heading_1": return <div className={className}><h2 id={block.id}><Rich value={block.richText} /></h2>{children}</div>;
    case "heading_2": return <div className={className}><h3 id={block.id}><Rich value={block.richText} /></h3>{children}</div>;
    case "heading_3": return <div className={className}><h4 id={block.id}><Rich value={block.richText} /></h4>{children}</div>;
    case "to_do": return <div className={`${className} notion-todo`}><input type="checkbox" checked={Boolean(block.checked)} readOnly aria-label={block.checked ? "已完成" : "未完成"} /><div><Rich value={block.richText} />{children}</div></div>;
    case "quote": return <div className={className}><blockquote><Rich value={block.richText} />{children}</blockquote></div>;
    case "callout": return <aside className={`${className} callout`}><span>{block.icon}</span><div><Rich value={block.richText} />{children}</div></aside>;
    case "toggle": return <details className={`${className} notion-toggle`} open><summary><Rich value={block.richText} /></summary><div>{children}</div></details>;
    case "code": return <figure className={`${className} notion-code`}><pre><code data-language={block.language}><Rich value={block.richText} /></code></pre>{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    case "divider": return <hr />;
    case "image": return block.url ? block.url.startsWith("/_notion/image?")
      ? <NotionHeicImage src={block.url} identity={notionImageIdentity(block)} alt={block.caption || "文章图片"} caption={block.caption} />
      : <NotionImage src={block.url} alt={block.caption || "文章图片"} caption={block.caption} /> : null;
    case "bookmark": case "embed": return block.url ? <a className={`${className} bookmark`} href={block.url} target="_blank" rel="noreferrer">{block.caption || block.url} ↗</a> : null;
    case "file": case "pdf": case "audio": return block.url ? <a className="bookmark" href={block.url} target="_blank" rel="noreferrer">{block.caption || (block.type === "pdf" ? "查看 PDF" : "下载附件")} ↗</a> : null;
    case "child_page": case "child_database": return block.url ? <a className={`${className} notion-child-page`} href={block.url} target="_blank" rel="noreferrer"><span aria-hidden="true">▱</span><strong>{block.caption || (block.type === "child_page" ? "子页面" : "子数据库")}</strong><span aria-hidden="true">↗</span></a> : null;
    case "equation": return <div className="equation" aria-label="数学公式">{block.caption}</div>;
    case "table": return <div className="notion-table" role="table">{children}</div>;
    case "table_row": return <div className="notion-table-row" role="row">{block.children?.map((cell, index) => <div role="cell" key={`${block.id}-${index}`}><Rich value={cell.richText} /></div>)}</div>;
    case "column_list": return <div className={`${className} columns`}>{children}</div>;
    case "column": return <div className="column">{children}</div>;
    case "synced_block": case "template": return <div className={className}>{children}</div>;
    case "table_of_contents": return <aside className={`${className} notion-toc`}>目录</aside>;
    case "breadcrumb": return <div className={`${className} notion-breadcrumb`}>当前位置</div>;
    case "unsupported": return <aside className="unsupported">此内容块暂不支持显示。</aside>;
    default: return children ? <div>{children}</div> : <aside className="unsupported">未识别的内容块：{block.type}</aside>;
  }
}

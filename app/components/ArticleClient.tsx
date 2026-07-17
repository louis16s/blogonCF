"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ContentBlock, Post } from "../data/types";

export function ArticleClient({ slug }: { slug: string }) {
  const [post, setPost] = useState<Post | undefined>();
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const passwordRef = useRef("");

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
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "文章暂时无法读取"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    };
    refresh();
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
  return <>{blocks.map((block) => <Block key={block.id} block={block} />)}</>;
}

function Rich({ value = [] }: { value?: ContentBlock["richText"] }) {
  return <>{value?.map((item, index) => {
    let node = <>{item.text}</>;
    if (item.code) node = <code>{node}</code>;
    if (item.bold) node = <strong>{node}</strong>;
    if (item.italic) node = <em>{node}</em>;
    return item.href ? <a key={index} href={item.href} target="_blank" rel="noreferrer">{node}</a> : <span key={index}>{node}</span>;
  })}</>;
}

function Block({ block }: { block: ContentBlock }) {
  const children = block.children?.length ? <Blocks blocks={block.children} /> : null;
  switch (block.type) {
    case "paragraph": return <p><Rich value={block.richText} />{children}</p>;
    case "heading_1": return <h2><Rich value={block.richText} /></h2>;
    case "heading_2": return <h3><Rich value={block.richText} /></h3>;
    case "heading_3": return <h4><Rich value={block.richText} /></h4>;
    case "bulleted_list_item": return <ul><li><Rich value={block.richText} />{children}</li></ul>;
    case "numbered_list_item": return <ol><li><Rich value={block.richText} />{children}</li></ol>;
    case "to_do": return <p>☑ {block.checked ? "已完成" : "待办"} · <Rich value={block.richText} /></p>;
    case "quote": return <blockquote><Rich value={block.richText} /></blockquote>;
    case "callout": return <aside className="callout"><span>{block.icon}</span><div><Rich value={block.richText} />{children}</div></aside>;
    case "code": return <pre><code data-language={block.language}><Rich value={block.richText} /></code></pre>;
    case "divider": return <hr />;
    // Notion image URLs are signed and unknown at build time, so the Worker cannot
    // safely provide dimensions required by next/image.
    // eslint-disable-next-line @next/next/no-img-element
    case "image": return block.url ? <figure><img src={block.url} alt={block.caption || "文章图片"} loading="lazy" /><figcaption>{block.caption}</figcaption></figure> : null;
    case "bookmark": case "embed": return block.url ? <a className="bookmark" href={block.url} target="_blank" rel="noreferrer">{block.caption || block.url} ↗</a> : null;
    case "file": case "pdf": case "audio": return block.url ? <a className="bookmark" href={block.url} target="_blank" rel="noreferrer">{block.caption || (block.type === "pdf" ? "查看 PDF" : "下载附件")} ↗</a> : null;
    case "equation": return <div className="equation" aria-label="数学公式">{block.caption}</div>;
    case "table": return <div className="notion-table" role="table">{children}</div>;
    case "table_row": return <div className="notion-table-row" role="row">{block.children?.map((cell, index) => <div role="cell" key={`${block.id}-${index}`}><Rich value={cell.richText} /></div>)}</div>;
    case "column_list": return <div className="columns">{children}</div>;
    case "column": return <div className="column">{children}</div>;
    case "unsupported": return <aside className="unsupported">此内容块暂不支持显示。</aside>;
    default: return children ? <div>{children}</div> : <aside className="unsupported">未识别的内容块：{block.type}</aside>;
  }
}

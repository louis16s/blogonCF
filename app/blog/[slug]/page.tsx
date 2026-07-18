import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { cache } from "react";
import { ArticleClient } from "../../components/ArticleClient";
import { SiteSidebar } from "../../components/SiteSidebar";
import { readArticlePayload, type ArticlePayload } from "../../../server/article-context";

const getArticle = cache(async (slug: string): Promise<{ payload?: ArticlePayload; fetched: boolean }> => {
  void slug;
  const key = (await headers()).get("x-blog-article-context");
  const payload = readArticlePayload(key);
  return { payload: payload || { error: "文章暂时无法读取" }, fetched: true };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const { payload } = await getArticle(decoded);
  const title = payload?.post?.title || decoded;
  const description = payload?.post?.summary || "louis16s 的 Notion 博客文章";
  return {
    title,
    description,
    alternates: { canonical: `/blog/${encodeURIComponent(decoded)}` },
    openGraph: { type: "article", title, description, url: `/blog/${encodeURIComponent(decoded)}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const { payload, fetched } = await getArticle(decoded);
  return <div className="blog-frame article-frame"><SiteSidebar /><main className="article-shell"><header className="article-toolbar"><Link href="/">← 返回全部文章</Link><span>Notion · Cloudflare</span></header><article><ArticleClient slug={decoded} initialPost={payload?.post} initialBlocks={payload?.locked ? [] : payload?.blocks || []} initialLocked={Boolean(payload?.locked)} initialFetched={fetched} initialError={payload?.error || ""} /></article><footer className="content-footer"><p>写在 Notion，运行在 Cloudflare 边缘网络。</p></footer></main></div>;
}

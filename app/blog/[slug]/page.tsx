import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleClient } from "../../components/ArticleClient";
import { SiteSidebar } from "../../components/SiteSidebar";
import { ContentFooter } from "../../components/ContentFooter";
import { readArticlePayload, type ArticlePayload } from "../../../server/article-context";
import { decodeRouteSegment } from "../../../shared/url";
import { ArticleTocProvider } from "../../components/ArticleTocContext";

const getArticle = cache(async (slug: string): Promise<{ payload?: ArticlePayload; fetched: boolean }> => {
  void slug;
  const key = (await headers()).get("x-blog-article-context");
  const payload = readArticlePayload(key);
  return { payload: payload || { error: "文章暂时无法读取" }, fetched: true };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeRouteSegment(slug);
  const { payload } = await getArticle(decoded);
  const title = payload?.post?.title || decoded;
  const description = payload?.post?.summary || payload?.config?.siteDescription || "Notion article";
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
  const decoded = decodeRouteSegment(slug);
  const { payload, fetched } = await getArticle(decoded);
  if (payload?.status === 404) notFound();
  return <ArticleTocProvider initialHeadings={payload?.headings || []}><div className="blog-frame article-frame"><SiteSidebar siteConfig={payload?.config} /><main className="article-shell"><article><ArticleClient slug={decoded} initialPost={payload?.post} initialBlocks={payload?.locked ? [] : payload?.blocks || []} initialHeadings={payload?.headings || []} initialNextCursor={payload?.locked ? undefined : payload?.nextCursor} initialLocked={Boolean(payload?.locked)} initialFetched={fetched} initialError={payload?.error || ""} initialTruncated={Boolean(payload?.truncated)} siteConfig={payload?.config} /></article><ContentFooter siteConfig={payload?.config} /></main></div></ArticleTocProvider>;
}

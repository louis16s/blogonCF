import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NotionContentPage } from "../../components/NotionContentPage";
import { readArticlePayload, type ArticlePayload } from "../../../server/article-context";
import { decodeRouteSegment } from "../../../shared/url";

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
  return <NotionContentPage slug={decoded} payload={payload} fetched={fetched} contentKind="post" />;
}

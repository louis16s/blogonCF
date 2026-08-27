import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NotionContentPage } from "../../components/NotionContentPage";
import { readArticlePayload, type ArticlePayload } from "../../../server/article-context";
import { decodeRouteSegment } from "../../../shared/url";

const getSitePage = cache(async (slug: string): Promise<{ payload?: ArticlePayload; fetched: boolean }> => {
  void slug;
  const key = (await headers()).get("x-blog-article-context");
  const payload = readArticlePayload(key);
  return { payload: payload || { error: "页面暂时无法读取" }, fetched: true };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeRouteSegment(slug);
  const { payload } = await getSitePage(decoded);
  const title = payload?.post?.title || decoded;
  const description = payload?.post?.summary || payload?.config?.siteDescription || "Notion page";
  return {
    title,
    description,
    alternates: { canonical: `/page/${encodeURIComponent(decoded)}` },
    openGraph: { type: "website", title, description, url: `/page/${encodeURIComponent(decoded)}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function NotionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeRouteSegment(slug);
  const { payload, fetched } = await getSitePage(decoded);
  if (payload?.status === 404) notFound();
  return <NotionContentPage slug={decoded} payload={payload} fetched={fetched} contentKind="page" />;
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SiteContentPage } from "../components/SiteContentPage";
import { readArticlePayload, type ArticlePayload } from "../../server/article-context";

const getAboutPage = cache(async (): Promise<{ payload?: ArticlePayload; fetched: boolean }> => {
  const key = (await headers()).get("x-blog-article-context");
  const payload = readArticlePayload(key);
  return { payload: payload || { error: "页面暂时无法读取" }, fetched: true };
});

export async function generateMetadata(): Promise<Metadata> {
  const { payload } = await getAboutPage();
  const title = payload?.post?.title || "关于我";
  const description = payload?.post?.summary || "关于 louis16s";
  return {
    title,
    description,
    alternates: { canonical: "/about" },
    openGraph: { type: "website", title, description, url: "/about" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AboutPage() {
  const { payload, fetched } = await getAboutPage();
  if (payload?.status === 404) notFound();
  return <SiteContentPage slug="about" payload={payload} fetched={fetched} />;
}

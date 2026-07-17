import type { Metadata } from "next";
import Link from "next/link";
import { ArticleClient } from "../../components/ArticleClient";
import { fallbackPosts } from "../../data/fallback-posts";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = fallbackPosts.find((item) => item.slug.toLocaleLowerCase() === decodeURIComponent(slug).toLocaleLowerCase());
  return { title: post?.title || "文章", description: post?.summary, alternates: { canonical: `/blog/${encodeURIComponent(slug)}` } };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const fallback = fallbackPosts.find((item) => item.slug.toLocaleLowerCase() === decoded.toLocaleLowerCase());
  return <main className="article-shell"><header className="site-header"><Link className="brand" href="/"><span>16</span> louis16s</Link><Link href="/">← 全部文章</Link></header><article><ArticleClient slug={decoded} fallback={fallback} /></article><footer><p>写在 Notion，运行在 Cloudflare 边缘网络。</p></footer></main>;
}

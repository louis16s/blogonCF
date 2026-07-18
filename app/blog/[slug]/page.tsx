import type { Metadata } from "next";
import Link from "next/link";
import { ArticleClient } from "../../components/ArticleClient";
import { SiteSidebar } from "../../components/SiteSidebar";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  return { title: decoded, description: "louis16s 的 Notion 博客文章", alternates: { canonical: `/blog/${encodeURIComponent(decoded)}` } };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  return <div className="blog-frame article-frame"><SiteSidebar /><main className="article-shell"><header className="article-toolbar"><Link href="/">← 返回全部文章</Link><span>Notion · Cloudflare</span></header><article><ArticleClient slug={decoded} /></article><footer className="content-footer"><p>写在 Notion，运行在 Cloudflare 边缘网络。</p></footer></main></div>;
}

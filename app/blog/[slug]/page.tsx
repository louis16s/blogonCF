import type { Metadata } from "next";
import Link from "next/link";
import { ArticleClient } from "../../components/ArticleClient";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  return { title: decoded, description: "louis16s 的 Notion 博客文章", alternates: { canonical: `/blog/${encodeURIComponent(decoded)}` } };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  return <main className="article-shell"><header className="site-header"><Link className="brand" href="/"><span>16</span> louis16s</Link><Link href="/">← 全部文章</Link></header><article><ArticleClient slug={decoded} /></article><footer><p>写在 Notion，运行在 Cloudflare 边缘网络。</p></footer></main>;
}

import type { ArticlePayload } from "../../server/article-context";
import { ArticleClient } from "./ArticleClient";
import { ContentFooter } from "./ContentFooter";
import { SiteSidebar } from "./SiteSidebar";
import { ArticleTocProvider } from "./ArticleTocContext";

export function SiteContentPage({ slug, payload, fetched = true }: { slug: string; payload?: ArticlePayload; fetched?: boolean }) {
  return (
    <ArticleTocProvider initialHeadings={payload?.headings || []}><div className="blog-frame article-frame site-content-frame">
      <SiteSidebar siteConfig={payload?.config} />
      <main className="article-shell">
        <article>
          <ArticleClient
            slug={slug}
            contentKind="page"
            initialPost={payload?.post}
            initialBlocks={payload?.blocks || []}
            initialHeadings={payload?.headings || []}
            initialNextCursor={payload?.nextCursor}
            initialLocked={false}
            initialFetched={fetched}
            initialError={payload?.error || ""}
            initialTruncated={Boolean(payload?.truncated)}
            siteConfig={payload?.config}
          />
        </article>
        <ContentFooter siteConfig={payload?.config} />
      </main>
    </div></ArticleTocProvider>
  );
}

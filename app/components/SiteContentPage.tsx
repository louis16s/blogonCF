import type { ArticlePayload } from "../../server/article-context";
import { ArticleClient } from "./ArticleClient";
import { ContentFooter } from "./ContentFooter";
import { SiteSidebar } from "./SiteSidebar";

export function SiteContentPage({ slug, payload, fetched = true }: { slug: string; payload?: ArticlePayload; fetched?: boolean }) {
  return (
    <div className="blog-frame article-frame site-content-frame">
      <SiteSidebar showHomeLink />
      <main className="article-shell">
        <article>
          <ArticleClient
            slug={slug}
            contentKind="page"
            initialPost={payload?.post}
            initialBlocks={payload?.blocks || []}
            initialLocked={false}
            initialFetched={fetched}
            initialError={payload?.error || ""}
            initialTruncated={Boolean(payload?.truncated)}
          />
        </article>
        <ContentFooter />
      </main>
    </div>
  );
}

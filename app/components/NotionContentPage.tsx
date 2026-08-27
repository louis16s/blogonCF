import type { ArticlePayload } from "../../server/article-context";
import { ArticleClient } from "./ArticleClient";
import { ContentFooter } from "./ContentFooter";
import { SiteSidebar } from "./SiteSidebar";
import { ArticleTocProvider } from "./ArticleTocContext";

type NotionContentPageProps = {
  slug: string;
  payload?: ArticlePayload;
  fetched?: boolean;
  contentKind: "post" | "page";
};

/** Shared shell for every Notion-backed document rendered on this site. */
export function NotionContentPage({ slug, payload, fetched = true, contentKind }: NotionContentPageProps) {
  const locked = contentKind === "post" && Boolean(payload?.locked);
  return (
    <ArticleTocProvider initialHeadings={payload?.headings || []}>
      <div className={`blog-frame article-frame${contentKind === "page" ? " site-content-frame" : ""}`}>
        <SiteSidebar siteConfig={payload?.config} />
        <main className="article-shell">
          <article>
            <ArticleClient
              slug={slug}
              contentKind={contentKind}
              initialPost={payload?.post}
              initialBlocks={locked ? [] : payload?.blocks || []}
              initialHeadings={payload?.headings || []}
              initialNextCursor={locked ? undefined : payload?.nextCursor}
              initialLocked={locked}
              initialFetched={fetched}
              initialError={payload?.error || ""}
              initialTruncated={Boolean(payload?.truncated)}
              siteConfig={payload?.config}
            />
          </article>
          <ContentFooter siteConfig={payload?.config} />
        </main>
      </div>
    </ArticleTocProvider>
  );
}

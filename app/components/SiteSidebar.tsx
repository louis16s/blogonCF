"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  CaretDown,
  Cloud,
  Compass,
  ArrowSquareOut,
  FolderOpen,
  GithubLogo,
  Info,
  List,
  Newspaper,
  Rss,
  Wrench,
} from "@phosphor-icons/react";
import type { SiteConfig, SiteLink } from "../data/types";
import { usePersistedDisclosure } from "./usePersistedDisclosure";
import { loadSiteBootstrap } from "./siteBootstrap";
import { useSiteConfig } from "./useSiteConfig";
import { useSiteNavigation } from "./useSiteNavigation";
import { useArticleToc, type ArticleHeading } from "./ArticleTocContext";

export type ContentSyncState = "loading" | "live" | "unavailable";
export type SidebarHeading = ArticleHeading;

type SidebarProps = {
  siteLinks?: SiteLink[];
  postCount?: number;
  syncState?: ContentSyncState;
  categories?: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  siteConfig?: SiteConfig;
  headings?: SidebarHeading[];
};

export function SiteSidebar({ siteLinks = [], postCount, syncState, categories = [], activeCategory, onCategoryChange, siteConfig, headings = [] }: SidebarProps) {
  const articleToc = useArticleToc();
  const resolvedHeadings = articleToc?.headings ?? headings;
  const pendingHeadingId = articleToc?.pendingHeadingId || "";
  const resolvedLinks = useSiteNavigation(siteLinks);
  const config = useSiteConfig(siteConfig);
  const toolsDisclosure = usePersistedDisclosure({ key: "blog.sidebar.tools.v1" });
  const categoriesDisclosure = usePersistedDisclosure({ key: "blog.sidebar.categories.v2", defaultOpen: false });
  const tocDisclosure = usePersistedDisclosure({ key: "blog.sidebar.toc.v1", defaultOpen: resolvedHeadings.length > 1 && resolvedHeadings.length <= 8 });
  const [articlePageSync, setArticlePageSync] = useState<{ count?: number; state: ContentSyncState }>({ state: "loading" });
  const toolLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "tool"), [resolvedLinks]);
  const navLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "nav"), [resolvedLinks]);
  const rssLink = resolvedLinks.find((link) => link.kind === "rss");
  const aboutLink = navLinks.find((link) => link.href.includes("#about") || link.title.includes("关于"));
  const newsLink = navLinks.find((link) => link.href.includes("/page/links") || link.title.includes("资讯"));
  const sitemapLink = navLinks.find((link) => link.href.includes("sitemap") || link.title.includes("地图"));
  const assignedNavIds = new Set([aboutLink?.id, newsLink?.id, sitemapLink?.id].filter(Boolean));
  const extraNavLinks = navLinks.filter((link) => !assignedNavIds.has(link.id));
  const resolvedSyncState = syncState || articlePageSync.state;
  const resolvedPostCount = typeof postCount === "number" ? postCount : articlePageSync.count;
  const countLabel = resolvedSyncState === "live" && typeof resolvedPostCount === "number"
    ? `${resolvedPostCount} 篇公开文章`
    : resolvedSyncState === "loading" ? "正在读取公开文章" : "内容源暂时不可用";
  const syncLabel = resolvedSyncState === "live" ? "Notion 实时同步中" : resolvedSyncState === "loading" ? "正在同步" : "同步中断";
  const navigateToHeading = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("article-toc:navigate", { detail: { id } }));
  };

  useEffect(() => {
    if (typeof postCount === "number" || syncState) return;
    let active = true;
    loadSiteBootstrap()
      .then(({ posts }) => {
        if (!active) return;
        setArticlePageSync({
        count: posts.length,
        state: "live",
        });
      })
      .catch(() => {
        if (active) setArticlePageSync({ state: "unavailable" });
      });
    return () => { active = false; };
  }, [postCount, syncState]);

  return (
    <aside className="site-sidebar" aria-label="站点导航">
      <div className="sidebar-main">
        <div className="sidebar-brand">
          <Link className="sidebar-identity" href="/" aria-label="返回首页">
            {config.avatarUrl ? <img src={config.avatarUrl} alt={config.author} width="52" height="52" /> : null}
            <strong>{config.author}</strong>
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          {aboutLink && (
            <a href={aboutLink.href} target={aboutLink.external ? "_blank" : undefined} rel={aboutLink.external ? "noreferrer" : undefined}>
              <Info aria-hidden size={19} weight="regular" />{aboutLink.title || "关于我"}
            </a>
          )}
          {newsLink && (newsLink.external ? (
            <a href={newsLink.href} target="_blank" rel="noreferrer"><Newspaper aria-hidden size={19} weight="regular" />{newsLink.title || "资讯"}</a>
          ) : (
            <Link href={newsLink.href}><Newspaper aria-hidden size={19} weight="regular" />{newsLink.title || "资讯"}</Link>
          ))}
          {extraNavLinks.map((link) => link.external ? (
            <a href={link.href} target="_blank" rel="noreferrer" key={link.id}><ArrowSquareOut aria-hidden size={19} />{link.title}</a>
          ) : (
            <Link href={link.href} key={link.id}><Compass aria-hidden size={19} />{link.title}</Link>
          ))}
        </nav>

        {config.wordCloudEnabled ? <Link className="sidebar-cloud-link" href="/#word-cloud"><Cloud aria-hidden size={17} weight="regular" />{config.wordCloudLabel}</Link> : null}

        {toolLinks.length > 0 && (
          <details
            className="sidebar-section sidebar-tools"
            open={toolsDisclosure.open}
            onToggle={toolsDisclosure.onToggle}
          >
            <summary><span><Wrench aria-hidden size={16} />{config.toolsLabel} <small>{toolLinks.length}</small></span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
            <div className="sidebar-tool-list">
              {toolLinks.map((link) => (
                <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id} title={link.summary || link.title}>
                  <span className="tool-link-label">{link.icon ? <span aria-hidden>{link.icon}</span> : null}<span>{link.title}</span></span><ArrowSquareOut aria-hidden size={13} />
                </a>
              ))}
            </div>
          </details>
        )}

        {resolvedHeadings.length > 1 && (
          <details className="sidebar-section sidebar-toc" open={tocDisclosure.open} onToggle={tocDisclosure.onToggle}>
            <summary><span><List aria-hidden size={16} />目录 <small>{resolvedHeadings.length > 8 ? "较长" : ""}</small></span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
            <nav className="sidebar-toc-list" aria-label="文章目录">
              {resolvedHeadings.map((heading) => <a href={`#${heading.id}`} className={pendingHeadingId === heading.id ? "is-loading" : undefined} aria-busy={pendingHeadingId === heading.id || undefined} onClick={(event) => navigateToHeading(event, heading.id)} style={{ "--toc-level": heading.level } as CSSProperties} key={heading.id}>{heading.label}</a>)}
            </nav>
          </details>
        )}

        {config.categoriesEnabled && categories.length > 0 && onCategoryChange && (
          <details
            className="sidebar-section sidebar-categories"
            open={categoriesDisclosure.open}
            onToggle={categoriesDisclosure.onToggle}
          >
            <summary><span><FolderOpen aria-hidden size={16} />{config.categoriesLabel}</span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
            <div className="sidebar-category-list" role="group" aria-label="按分类筛选">
              {categories.map((item) => (
                <button type="button" className={item === activeCategory ? "active" : ""} aria-pressed={item === activeCategory} onClick={() => onCategoryChange(item)} key={item}>{item}</button>
              ))}
            </div>
          </details>
        )}

        <details className="mobile-menu">
          <summary><List aria-hidden size={18} /><span>菜单</span><CaretDown className="section-caret" aria-hidden size={13} /></summary>
          <nav
            className="mobile-menu-list"
            aria-label="移动端菜单"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a, button")) event.currentTarget.closest(".mobile-menu")?.removeAttribute("open");
            }}
          >
            {aboutLink && (
              <a href={aboutLink.href} target={aboutLink.external ? "_blank" : undefined} rel={aboutLink.external ? "noreferrer" : undefined}>
                {aboutLink.title || "关于我"}{aboutLink.external ? <small>外部</small> : null}
              </a>
            )}
            {newsLink && (newsLink.external ? (
              <a href={newsLink.href} target="_blank" rel="noreferrer">{newsLink.title || "资讯"}<small>外部</small></a>
            ) : (
              <Link href={newsLink.href}>{newsLink.title || "资讯"}</Link>
            ))}
            {extraNavLinks.map((link) => link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.id}>{link.title}<small>外部</small></a>
            ) : (
              <Link href={link.href} key={link.id}>{link.title}</Link>
            ))}
            {config.wordCloudEnabled ? <Link href="/#word-cloud">{config.wordCloudLabel}</Link> : null}
            {toolLinks.length > 0 && (
              <details className="mobile-menu-group mobile-menu-disclosure">
                <summary><span>{config.toolsLabel}</span><small>{toolLinks.length}</small><CaretDown className="section-caret" aria-hidden size={13} /></summary>
                <div className="mobile-menu-disclosure-content">
                  {toolLinks.map((link) => (
                    <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id}>{link.title}{link.external && <small>外部</small>}</a>
                  ))}
                </div>
              </details>
            )}
            {resolvedHeadings.length > 1 && (
              <details className="mobile-menu-group mobile-menu-disclosure">
                <summary><span>目录</span><small>{resolvedHeadings.length}</small><CaretDown className="section-caret" aria-hidden size={13} /></summary>
                <div className="mobile-menu-disclosure-content mobile-toc-list">
                  {resolvedHeadings.map((heading) => <a href={`#${heading.id}`} className={pendingHeadingId === heading.id ? "is-loading" : undefined} aria-busy={pendingHeadingId === heading.id || undefined} onClick={(event) => navigateToHeading(event, heading.id)} key={heading.id}>{heading.label}</a>)}
                </div>
              </details>
            )}
            {config.categoriesEnabled && categories.length > 0 && onCategoryChange && (
              <details className="mobile-menu-group mobile-menu-disclosure mobile-category-list">
                <summary><span>{config.categoriesLabel}</span><CaretDown className="section-caret" aria-hidden size={13} /></summary>
                <div className="mobile-menu-disclosure-content">
                  {categories.map((item) => (
                    <button type="button" className={item === activeCategory ? "active" : ""} aria-pressed={item === activeCategory} onClick={() => onCategoryChange(item)} key={item}>{item}</button>
                  ))}
                </div>
              </details>
            )}
            <div className="mobile-menu-status" aria-live="polite">
              <span>{countLabel}</span>
              <span className={`source ${resolvedSyncState === "live" ? "live" : ""}`}>{syncLabel}</span>
            </div>
            {config.repositoryUrl ? <a href={config.repositoryUrl} target="_blank" rel="noreferrer">{repositoryLabel(config.repositoryUrl)}<small>GitHub</small></a> : null}
          </nav>
        </details>

      </div>

      <div className="sidebar-footer">
        <div className="sidebar-sync-meta" aria-live="polite">
          <span>{countLabel}</span>
          <span className={`source ${resolvedSyncState === "live" ? "live" : ""}`}>{syncLabel}</span>
        </div>
        {config.repositoryUrl ? <a className="sidebar-repo-link" href={config.repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo aria-hidden size={14} />{repositoryLabel(config.repositoryUrl)}</a> : null}
        {config.rssEnabled && rssLink ? <Link className="sidebar-repo-link" href={rssLink.href}><Rss aria-hidden size={14} />{config.rssLabel}</Link> : null}
      </div>
    </aside>
  );
}

function repositoryLabel(value: string) {
  try { return new URL(value).pathname.split("/").filter(Boolean).at(-1) || "GitHub"; }
  catch { return "GitHub"; }
}

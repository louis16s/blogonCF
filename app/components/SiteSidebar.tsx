"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  Cloud,
  Compass,
  ArrowSquareOut,
  FolderOpen,
  GithubLogo,
  HouseLine,
  Info,
  List,
  Newspaper,
  Rss,
  Wrench,
} from "@phosphor-icons/react";
import type { SiteLink } from "../data/types";
import { usePersistedDisclosure } from "./usePersistedDisclosure";
import { loadSiteBootstrap } from "./siteBootstrap";
import { useSiteNavigation } from "./useSiteNavigation";

export type ContentSyncState = "loading" | "live" | "unavailable";

type SidebarProps = {
  siteLinks?: SiteLink[];
  postCount?: number;
  syncState?: ContentSyncState;
  categories?: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  showHomeLink?: boolean;
};

export function SiteSidebar({ siteLinks = [], postCount, syncState, categories = [], activeCategory, onCategoryChange, showHomeLink = false }: SidebarProps) {
  const resolvedLinks = useSiteNavigation(siteLinks);
  const toolsDisclosure = usePersistedDisclosure({ key: "blog.sidebar.tools.v1", legacyKey: "blog-sidebar-tools-open" });
  const categoriesDisclosure = usePersistedDisclosure({ key: "blog.sidebar.categories.v2", defaultOpen: false });
  const [articlePageSync, setArticlePageSync] = useState<{ count?: number; state: ContentSyncState }>({ state: "loading" });
  const toolLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "tool"), [resolvedLinks]);
  const navLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "nav" && !link.title.includes("归档") && !link.href.includes("#archive")), [resolvedLinks]);
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
            {/* This is the avatar used by the reference site. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/louis16s-avatar.jpg" alt="louis16s" width="52" height="52" />
            <strong>louis16s</strong>
          </Link>
          {showHomeLink && <Link className="sidebar-home-link" href="/"><span className="sidebar-home-icon"><HouseLine aria-hidden size={16} weight="duotone" /></span><span><small>HOME</small><strong>返回主页</strong></span><ArrowSquareOut className="sidebar-home-arrow" aria-hidden size={13} /></Link>}
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

        <section className="sidebar-browse" aria-labelledby="sidebar-browse-title">
          <p id="sidebar-browse-title">浏览</p>
          <div className="sidebar-browse-panel">
            <Link className="sidebar-cloud-link" href="/#word-cloud"><Cloud aria-hidden size={17} weight="regular" />词云</Link>

            {toolLinks.length > 0 && (
              <details
                className="sidebar-section sidebar-tools"
                open={toolsDisclosure.open}
                onToggle={toolsDisclosure.onToggle}
              >
                <summary><span><Wrench aria-hidden size={16} />小工具</span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
                <div className="sidebar-tool-list">
                  {toolLinks.map((link) => (
                    <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id} title={link.summary || link.title}>
                      <span className="tool-link-label"><span aria-hidden>{link.icon || "↗"}</span><span>{link.title}</span></span><ArrowSquareOut aria-hidden size={13} />
                    </a>
                  ))}
                </div>
              </details>
            )}

            {categories.length > 0 && onCategoryChange && (
              <details
                className="sidebar-section sidebar-categories"
                open={categoriesDisclosure.open}
                onToggle={categoriesDisclosure.onToggle}
              >
                <summary><span><FolderOpen aria-hidden size={16} />文章分类</span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
                <div className="sidebar-category-list" role="group" aria-label="按分类筛选">
                  {categories.map((item) => (
                    <button type="button" className={item === activeCategory ? "active" : ""} aria-pressed={item === activeCategory} onClick={() => onCategoryChange(item)} key={item}>{item}</button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </section>

        <details className="mobile-menu">
          <summary><List aria-hidden size={18} /><span>菜单</span><CaretDown className="section-caret" aria-hidden size={13} /></summary>
          <nav
            className="mobile-menu-list"
            aria-label="移动端菜单"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a, button")) event.currentTarget.closest(".mobile-menu")?.removeAttribute("open");
            }}
          >
            {showHomeLink && <Link href="/">返回主页</Link>}
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
            <Link href="/#word-cloud">词云</Link>
            {toolLinks.length > 0 && (
              <details className="mobile-menu-group mobile-menu-disclosure">
                <summary><span>小工具</span><CaretDown className="section-caret" aria-hidden size={13} /></summary>
                <div className="mobile-menu-disclosure-content">
                  {toolLinks.map((link) => (
                    <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id}>{link.title}{link.external && <small>外部</small>}</a>
                  ))}
                </div>
              </details>
            )}
            {categories.length > 0 && onCategoryChange && (
              <details className="mobile-menu-group mobile-menu-disclosure mobile-category-list">
                <summary><span>文章分类</span><CaretDown className="section-caret" aria-hidden size={13} /></summary>
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
            <a href="https://github.com/louis16s/blogonCF" target="_blank" rel="noreferrer">blogonCF<small>GitHub</small></a>
          </nav>
        </details>

      </div>

      <div className="sidebar-footer">
        <div className="sidebar-sync-meta" aria-live="polite">
          <span>{countLabel}</span>
          <span className={`source ${resolvedSyncState === "live" ? "live" : ""}`}>{syncLabel}</span>
        </div>
        <a className="sidebar-repo-link" href="https://github.com/louis16s/blogonCF" target="_blank" rel="noreferrer"><GithubLogo aria-hidden size={14} />blogonCF</a>
        {rssLink && <Link className="sidebar-repo-link" href={rssLink.href}><Rss aria-hidden size={14} />RSS 订阅</Link>}
      </div>
    </aside>
  );
}

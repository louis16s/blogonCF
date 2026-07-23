"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  CaretDown,
  Cloud,
  Compass,
  ArrowSquareOut,
  Info,
  List,
  Rss,
  Wrench,
} from "@phosphor-icons/react";
import type { SiteConfig, SiteLink } from "../data/types";
import { usePersistedDisclosure } from "./usePersistedDisclosure";
import { useSiteConfig } from "./useSiteConfig";
import { useSiteNavigation } from "./useSiteNavigation";

type SidebarProps = {
  siteConfig?: SiteConfig;
  siteLinks?: SiteLink[];
};

export function SiteSidebar({ siteConfig, siteLinks = [] }: SidebarProps) {
  const config = useSiteConfig(siteConfig);
  const resolvedLinks = useSiteNavigation(siteLinks);
  const toolsDisclosure = usePersistedDisclosure({ key: "blog.sidebar.tools.v1", legacyKey: "blog-sidebar-tools-open" });
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;
  const toolLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "tool"), [resolvedLinks]);
  const navLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "nav" && !link.title.includes("归档") && !link.href.includes("#archive")), [resolvedLinks]);
  const rssLink = resolvedLinks.find((link) => link.kind === "rss");
  const aboutLink = navLinks.find((link) => link.href.includes("#about") || link.title.includes("关于"));
  const sitemapLink = navLinks.find((link) => link.href.includes("sitemap") || link.title.includes("地图"));
  const assignedNavIds = new Set([aboutLink?.id, sitemapLink?.id].filter(Boolean));
  const extraNavLinks = navLinks.filter((link) => !assignedNavIds.has(link.id));

  return (
    <aside className="site-sidebar" aria-label="站点导航">
      <div className="sidebar-main">
        <Link className="sidebar-identity" href="/" aria-label="返回首页">
          {/* This is the avatar used by the reference site. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/louis16s-avatar.jpg" alt="louis16s" width="52" height="52" />
          <strong>louis16s</strong>
        </Link>

        <nav className="sidebar-nav" aria-label="主导航">
          <Link href="/#word-cloud"><Cloud aria-hidden size={19} weight="regular" />文章词云</Link>
          <Link href={aboutLink?.href || "/#about"}><Info aria-hidden size={19} weight="regular" />{aboutLink?.title || "关于我"}</Link>
          {extraNavLinks.map((link) => link.external ? (
            <a href={link.href} target="_blank" rel="noreferrer" key={link.id}><ArrowSquareOut aria-hidden size={19} />{link.title}</a>
          ) : (
            <Link href={link.href} key={link.id}><Compass aria-hidden size={19} />{link.title}</Link>
          ))}
        </nav>

        {toolLinks.length > 0 && (
          <details
            className="sidebar-section sidebar-tools"
            open={toolsDisclosure.open}
            onToggle={toolsDisclosure.onToggle}
          >
            <summary><span><Wrench aria-hidden size={16} />小工具 <small>{toolLinks.length}</small></span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
            <div className="sidebar-tool-list">
              {toolLinks.map((link) => (
                <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id} title={link.summary || link.title}>
                  <span className="tool-link-label"><span aria-hidden>{link.icon || "↗"}</span><span>{link.title}</span></span><ArrowSquareOut aria-hidden size={13} />
                </a>
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
              if (event.target instanceof Element && event.target.closest("a")) event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <Link href="/#word-cloud">文章词云</Link>
            {aboutLink && <Link href={aboutLink.href}>{aboutLink.title || "关于我"}</Link>}
            {extraNavLinks.map((link) => link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" key={link.id}>{link.title}<small>外部</small></a>
            ) : (
              <Link href={link.href} key={link.id}>{link.title}</Link>
            ))}
            {toolLinks.length > 0 && (
              <div className="mobile-menu-group">
                <p>小工具</p>
                {toolLinks.map((link) => (
                  <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id}>{link.title}{link.external && <small>外部</small>}</a>
                ))}
              </div>
            )}
            {rssLink && <Link href={rssLink.href}>RSS 订阅</Link>}
          </nav>
        </details>

        {rssLink && <Link className="rss-link" href={rssLink.href}><Rss aria-hidden size={20} />{rssLink.title || "RSS 订阅"}</Link>}
      </div>

      <div className="sidebar-footer">
        <p>© {config.author} {years}</p>
        <p>在 <a href="https://www.notion.so" target="_blank" rel="noreferrer">Notion</a> 写字，Cloudflare 带它兜风。</p>
      </div>
    </aside>
  );
}

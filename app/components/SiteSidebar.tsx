"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Archive,
  CaretDown,
  Compass,
  ArrowSquareOut,
  Info,
  Rss,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react";
import type { SiteConfig, SiteLink } from "../data/types";
import { usePersistedDisclosure } from "./usePersistedDisclosure";
import { useSiteConfig } from "./useSiteConfig";
import { useSiteNavigation } from "./useSiteNavigation";

type SidebarProps = {
  categories?: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  siteConfig?: SiteConfig;
  siteLinks?: SiteLink[];
};

export function SiteSidebar({ categories = [], activeCategory, onCategoryChange, siteConfig, siteLinks = [] }: SidebarProps) {
  const config = useSiteConfig(siteConfig);
  const resolvedLinks = useSiteNavigation(siteLinks);
  const quickDisclosure = usePersistedDisclosure({ key: "blog.sidebar.quick.v1", legacyKey: "blog-sidebar-quick-open" });
  const toolsDisclosure = usePersistedDisclosure({ key: "blog.sidebar.tools.v1", legacyKey: "blog-sidebar-tools-open" });
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;
  const toolLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "tool"), [resolvedLinks]);
  const navLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "nav"), [resolvedLinks]);
  const rssLink = resolvedLinks.find((link) => link.kind === "rss");
  const archiveLink = navLinks.find((link) => link.href.includes("#archive") || link.title.includes("归档"));
  const aboutLink = navLinks.find((link) => link.href.includes("#about") || link.title.includes("关于"));
  const sitemapLink = navLinks.find((link) => link.href.includes("sitemap") || link.title.includes("地图"));
  const assignedNavIds = new Set([archiveLink?.id, aboutLink?.id, sitemapLink?.id].filter(Boolean));
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
          <Link href={archiveLink?.href || "/#archive"}><Archive aria-hidden size={19} weight="regular" />{archiveLink?.title || "历史归档"}</Link>
          <Link href={aboutLink?.href || "/#about"}><Info aria-hidden size={19} weight="regular" />{aboutLink?.title || "关于我"}</Link>
          <Link href={sitemapLink?.href || "/sitemap.xml"}><TreeStructure aria-hidden size={19} weight="regular" />{sitemapLink?.title || "站点地图"}</Link>
          {extraNavLinks.map((link) => link.external ? (
            <a href={link.href} target="_blank" rel="noreferrer" key={link.id}><ArrowSquareOut aria-hidden size={19} />{link.title}</a>
          ) : (
            <Link href={link.href} key={link.id}><Compass aria-hidden size={19} />{link.title}</Link>
          ))}
        </nav>

        {categories.length > 0 && (
          <details
            className="sidebar-section quick-links"
            open={quickDisclosure.open}
            onToggle={quickDisclosure.onToggle}
          >
            <summary><span><Compass aria-hidden size={16} />快速访问 <small>{categories.length}</small></span><CaretDown className="section-caret" aria-hidden size={14} /></summary>
            <div className="quick-link-list">
              {categories.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={item === activeCategory ? "active" : ""}
                  onClick={() => onCategoryChange?.(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </details>
        )}

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

        {toolLinks.length > 0 && (
          <details className="mobile-tools">
            <summary aria-label="打开小工具菜单"><Wrench aria-hidden size={19} /></summary>
            <div className="mobile-tool-list">
              {toolLinks.map((link) => (
                <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id}>
                  <span>{link.icon ? `${link.icon} ` : ""}{link.title}</span><ArrowSquareOut aria-hidden size={13} />
                </a>
              ))}
            </div>
          </details>
        )}

        {rssLink && <Link className="rss-link" href={rssLink.href}><Rss aria-hidden size={20} />{rssLink.title || "RSS 订阅"}</Link>}
      </div>

      <div className="sidebar-footer">
        <p>© {config.author} {years}</p>
        <p>Powered by <a href="https://www.notion.so" target="_blank" rel="noreferrer">Notion</a> &amp; Cloudflare</p>
      </div>
    </aside>
  );
}

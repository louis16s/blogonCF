"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { useSiteConfig } from "./useSiteConfig";

type SidebarProps = {
  categories?: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  siteConfig?: SiteConfig;
  siteLinks?: SiteLink[];
};

export function SiteSidebar({ categories = [], activeCategory, onCategoryChange, siteConfig, siteLinks = [] }: SidebarProps) {
  const config = useSiteConfig(siteConfig);
  const [fetchedLinks, setFetchedLinks] = useState<SiteLink[]>([]);
  const [quickOpen, setQuickOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;
  const resolvedLinks = siteLinks.length ? siteLinks : fetchedLinks;
  const toolLinks = useMemo(() => resolvedLinks.filter((link) => link.kind === "tool"), [resolvedLinks]);
  const rssLink = resolvedLinks.find((link) => link.kind === "rss");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const quick = window.localStorage.getItem("blog-sidebar-quick-open");
      const tools = window.localStorage.getItem("blog-sidebar-tools-open");
      if (quick !== null) setQuickOpen(quick === "true");
      if (tools !== null) setToolsOpen(tools === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (siteLinks.length) return;
    const controller = new AbortController();
    fetch("/api/content/navigation", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => { if (Array.isArray(payload.links)) setFetchedLinks(payload.links); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [siteLinks.length]);
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
          <Link href="/#archive"><Archive aria-hidden size={19} weight="regular" />历史归档</Link>
          <Link href="/#about"><Info aria-hidden size={19} weight="regular" />关于我</Link>
          <Link href="/sitemap.xml"><TreeStructure aria-hidden size={19} weight="regular" />站点地图</Link>
        </nav>

        {categories.length > 0 && (
          <details
            className="sidebar-section quick-links"
            open={quickOpen}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setQuickOpen(open);
              window.localStorage.setItem("blog-sidebar-quick-open", String(open));
            }}
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
            open={toolsOpen}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setToolsOpen(open);
              window.localStorage.setItem("blog-sidebar-tools-open", String(open));
            }}
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

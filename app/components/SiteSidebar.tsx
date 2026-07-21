"use client";

import Link from "next/link";
import {
  Archive,
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
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;
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
          <section className="quick-links" aria-labelledby="quick-links-title">
            <div className="quick-links-title" id="quick-links-title"><span>快速访问</span><Compass aria-hidden size={17} /></div>
            <div className="quick-link-list">
              {categories.slice(0, 6).map((item) => (
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
          </section>
        )}

        {siteLinks.some((link) => link.kind === "tool") && (
          <section className="sidebar-tools" aria-labelledby="sidebar-tools-title">
            <div className="quick-links-title" id="sidebar-tools-title"><span>小工具</span><Wrench aria-hidden size={16} /></div>
            <div className="sidebar-tool-list">
              {siteLinks.filter((link) => link.kind === "tool").map((link) => (
                <a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} key={link.id}>
                  <span>{link.title}</span><ArrowSquareOut aria-hidden size={13} />
                </a>
              ))}
            </div>
          </section>
        )}

        <Link className="rss-link" href="/rss.xml"><Rss aria-hidden size={20} />RSS 订阅</Link>
      </div>

      <div className="sidebar-footer">
        <p>© {config.author} {years}</p>
        <p>Powered by <a href="https://www.notion.so" target="_blank" rel="noreferrer">Notion</a> &amp; Cloudflare</p>
      </div>
    </aside>
  );
}

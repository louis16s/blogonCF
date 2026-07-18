"use client";

import Link from "next/link";
import {
  Archive,
  Compass,
  Info,
  Rss,
  TreeStructure,
} from "@phosphor-icons/react";

type SidebarProps = {
  categories?: string[];
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
};

export function SiteSidebar({ categories = [], activeCategory, onCategoryChange }: SidebarProps) {
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

        <Link className="rss-link" href="/rss.xml"><Rss aria-hidden size={20} />RSS 订阅</Link>
      </div>

      <div className="sidebar-footer">
        <p>© louis16s 2020–{new Date().getFullYear()}</p>
        <p>Powered by <a href="https://www.notion.so" target="_blank" rel="noreferrer">Notion</a> &amp; Cloudflare</p>
      </div>
    </aside>
  );
}

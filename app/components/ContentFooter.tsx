"use client";

import type { SiteConfig } from "../data/types";
import { useSiteConfig } from "./useSiteConfig";

type ContentFooterProps = {
  id?: string;
  siteConfig?: SiteConfig;
  postCount?: number;
};

export function ContentFooter({ id, siteConfig, postCount }: ContentFooterProps) {
  const config = useSiteConfig(siteConfig);
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;

  return (
    <footer id={id} className="content-footer">
      <div className="footer-copy">
        <p className="footer-note">{typeof postCount === "number" ? `这里收录着 ${postCount} 个文章。不赶时间，慢慢翻。` : "页面看到底了。喝口水，再随便逛逛。"}</p>
        <p>偶尔拍照，或是写代码，剩下的时间用来对焦生活。</p>
      </div>
      <p className="footer-signature">© {config.author} {years}</p>
    </footer>
  );
}

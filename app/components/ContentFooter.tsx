"use client";

import { useEffect, useState } from "react";
import type { SiteConfig } from "../data/types";
import { DEFAULT_FOOTER_QUOTES } from "../data/types";
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
  const quotes = config.footerQuotes?.length ? config.footerQuotes : DEFAULT_FOOTER_QUOTES;
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setQuoteIndex(Math.floor(Math.random() * quotes.length)));
    return () => window.cancelAnimationFrame(frame);
  }, [quotes.length]);

  const quote = quotes[quoteIndex % quotes.length];

  return (
    <footer id={id} className="content-footer">
      <div className="footer-copy">
        <p className="footer-note">{typeof postCount === "number" ? `这里收录着 ${postCount} 个文章。不赶时间，慢慢翻。` : quote.lead}</p>
        <p>{quote.sub}</p>
      </div>
      <div className="footer-signature">
        <p>© {config.author} {years}</p>
        <p>在 <a href="https://www.notion.so/" target="_blank" rel="noreferrer">Notion</a> 创造，Cloudflare 带它兜风。</p>
      </div>
    </footer>
  );
}

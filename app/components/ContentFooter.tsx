"use client";

import { useEffect, useState } from "react";
import type { SiteConfig } from "../data/types";
import { DEFAULT_FOOTER_QUOTES } from "../data/types";
import { useSiteBootstrap } from "./siteBootstrap";

type ContentFooterProps = {
  id?: string;
  siteConfig?: SiteConfig;
  postCount?: number;
};

export function ContentFooter({ id, siteConfig, postCount }: ContentFooterProps) {
  const { config } = useSiteBootstrap({ initialConfig: siteConfig, initialLinks: [] });
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
        <p className="footer-note">{typeof postCount === "number" ? config.postCountText.replaceAll("{count}", String(postCount)) : quote.lead}</p>
        <p>{quote.sub}</p>
      </div>
      <div className="footer-signature">
        <p>© {config.author} {years}</p>
        <FooterCredit text={config.footerCredit} />
      </div>
    </footer>
  );
}

function FooterCredit({ text }: { text: string }) {
  const match = /\[([^\]]+)]\((https:\/\/[^\s)]+)\)/.exec(text);
  if (!match) return <p>{text}</p>;
  return <p>{text.slice(0, match.index)}<a href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a>{text.slice(match.index + match[0].length)}</p>;
}

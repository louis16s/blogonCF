"use client";

import { Archive } from "@phosphor-icons/react";
import Link from "next/link";
import type { SiteConfig } from "../data/types";
import { useSiteConfig } from "./useSiteConfig";

type ContentFooterProps = {
  id?: string;
  siteConfig?: SiteConfig;
};

export function ContentFooter({ id, siteConfig }: ContentFooterProps) {
  const config = useSiteConfig(siteConfig);
  const currentYear = new Date().getFullYear();
  const years = config.since === String(currentYear) ? config.since : `${config.since}–${currentYear}`;

  return (
    <footer id={id} className="content-footer">
      <div className="footer-copy">
        <p>© {config.author} {years}</p>
        <p>Powered by Notion &amp; Cloudflare</p>
      </div>
      <Link href="/#archive"><Archive aria-hidden size={15} />历史归档</Link>
    </footer>
  );
}

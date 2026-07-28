"use client";

import { useEffect, useState } from "react";
import type { SiteLink } from "../data/types";
import { loadSiteBootstrap } from "./siteBootstrap";

export function useSiteNavigation(initialLinks: SiteLink[] = []) {
  const [fetchedLinks, setFetchedLinks] = useState<SiteLink[]>([]);

  useEffect(() => {
    if (initialLinks.length) return;
    let active = true;
    loadSiteBootstrap()
      .then(({ links }) => { if (active) setFetchedLinks(links); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [initialLinks.length]);

  return initialLinks.length ? initialLinks : fetchedLinks;
}

"use client";

import { useEffect, useState } from "react";
import type { SiteLink } from "../data/types";
import { loadSiteBootstrap } from "./siteBootstrap";

export function useSiteNavigation(initialLinks?: SiteLink[]) {
  const [fetchedLinks, setFetchedLinks] = useState<SiteLink[]>([]);

  useEffect(() => {
    // `[]` is an authoritative, successfully resolved navigation result.
    // Only article routes omit the prop and need the shared bootstrap request.
    if (initialLinks !== undefined) return;
    let active = true;
    loadSiteBootstrap()
      .then(({ links }) => { if (active) setFetchedLinks(links); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [initialLinks]);

  return initialLinks ?? fetchedLinks;
}

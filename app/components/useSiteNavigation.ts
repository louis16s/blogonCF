"use client";

import { useEffect, useState } from "react";
import type { SiteLink } from "../data/types";
import { createSharedRequest } from "./clientState";

const loadSiteNavigation = createSharedRequest(() =>
  fetch("/api/content/navigation", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload): SiteLink[] => Array.isArray(payload.links) ? payload.links : [])
);

export function useSiteNavigation(initialLinks: SiteLink[] = []) {
  const [fetchedLinks, setFetchedLinks] = useState<SiteLink[]>([]);

  useEffect(() => {
    if (initialLinks.length) return;
    let active = true;
    loadSiteNavigation()
      .then((links) => { if (active) setFetchedLinks(links); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [initialLinks.length]);

  return initialLinks.length ? initialLinks : fetchedLinks;
}

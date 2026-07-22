"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "../data/types";
import { createSharedRequest } from "./clientState";

const loadSiteConfig = createSharedRequest(() =>
  fetch("/api/content/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload): SiteConfig => payload?.config?.author && payload?.config?.since ? payload.config : DEFAULT_SITE_CONFIG)
);

export function useSiteConfig(initialConfig?: SiteConfig) {
  const [fetchedConfig, setFetchedConfig] = useState(DEFAULT_SITE_CONFIG);

  useEffect(() => {
    if (initialConfig) return;

    let active = true;
    loadSiteConfig()
      .then((config) => { if (active) setFetchedConfig(config); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [initialConfig]);

  return initialConfig || fetchedConfig;
}

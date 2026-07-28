"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "../data/types";
import { loadSiteBootstrap } from "./siteBootstrap";

export function useSiteConfig(initialConfig?: SiteConfig) {
  const [fetchedConfig, setFetchedConfig] = useState(DEFAULT_SITE_CONFIG);

  useEffect(() => {
    if (initialConfig) return;

    let active = true;
    loadSiteBootstrap()
      .then(({ config }) => {
        if (active && config?.author && config?.since) setFetchedConfig(config);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [initialConfig]);

  return initialConfig || fetchedConfig;
}

"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "../data/types";

let configRequest: Promise<SiteConfig> | undefined;

function loadSiteConfig() {
  if (!configRequest) {
    configRequest = fetch("/api/content/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => payload?.config?.author && payload?.config?.since ? payload.config : DEFAULT_SITE_CONFIG)
      .catch((reason) => {
        configRequest = undefined;
        throw reason;
      });
  }
  return configRequest;
}

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

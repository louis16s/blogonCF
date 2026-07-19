"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type SiteConfig } from "../data/types";

export function useSiteConfig(initialConfig?: SiteConfig) {
  const [fetchedConfig, setFetchedConfig] = useState(DEFAULT_SITE_CONFIG);

  useEffect(() => {
    if (initialConfig) return;

    const controller = new AbortController();
    fetch("/api/content/config", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (payload?.config?.author && payload?.config?.since) setFetchedConfig(payload.config);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [initialConfig]);

  return initialConfig || fetchedConfig;
}

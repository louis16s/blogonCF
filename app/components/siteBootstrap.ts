"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SITE_CONFIG, type Post, type SiteConfig, type SiteLink } from "../data/types";
import { createSharedRequest } from "./clientState";

type SiteBootstrap = {
  posts: Post[];
  links: SiteLink[];
  config?: SiteConfig;
};

type SiteBootstrapOptions = {
  initialConfig?: SiteConfig;
  initialLinks?: SiteLink[];
  includePosts?: boolean;
};

/**
 * Article routes used to fetch navigation, configuration, and post statistics
 * independently. A single shared promise keeps those consumers on one public
 * bootstrap request without adding another client-side data dependency.
 */
export const loadSiteBootstrap = createSharedRequest(async (): Promise<SiteBootstrap> => {
  const response = await fetch("/api/content/posts");
  if (!response.ok) throw new Error("Site bootstrap is unavailable");
  const payload = await response.json();
  return {
    posts: Array.isArray(payload.posts) ? payload.posts : [],
    links: Array.isArray(payload.links) ? payload.links : [],
    config: payload.config,
  };
});

/**
 * Resolves all article-shell bootstrap consumers through one state/effect.
 * The shared request still deduplicates Sidebar and Footer callers, while
 * authoritative SSR props (including an empty links array) skip the request.
 */
export function useSiteBootstrap({ initialConfig, initialLinks, includePosts = false }: SiteBootstrapOptions) {
  const needsLoad = initialConfig === undefined || initialLinks === undefined || includePosts;
  const [remote, setRemote] = useState<SiteBootstrap>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!needsLoad) return;
    let active = true;
    loadSiteBootstrap()
      .then((payload) => {
        if (!active) return;
        setFailed(false);
        setRemote(payload);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [needsLoad]);

  const remoteConfig = remote?.config?.author && remote.config.since ? remote.config : undefined;
  return {
    config: initialConfig || remoteConfig || DEFAULT_SITE_CONFIG,
    links: initialLinks ?? remote?.links ?? [],
    posts: remote?.posts ?? [],
    loaded: !needsLoad || Boolean(remote),
    failed: needsLoad && failed && !remote,
  };
}

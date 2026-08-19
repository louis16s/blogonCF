"use client";

import type { Post, SiteConfig, SiteLink, SiteNotice } from "../data/types";
import { createSharedRequest } from "./clientState";

export type SiteBootstrap = {
  posts: Post[];
  links: SiteLink[];
  notice?: SiteNotice;
  config?: SiteConfig;
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
    notice: payload.notice?.id && payload.notice?.title ? payload.notice : undefined,
    config: payload.config,
  };
});

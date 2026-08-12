import type { Post, SiteConfig, SiteLink, SiteNotice } from "../app/data/types";
import { createRequestContext } from "./request-context";

export type HomePayload = {
  posts: Post[];
  links: SiteLink[];
  notice?: SiteNotice;
  config: SiteConfig;
};

const homeContext = createRequestContext<HomePayload>("louis16s.blog.home-context");
export const storeHomePayload = homeContext.store;
export const readHomePayload = homeContext.read;
export const clearHomePayload = homeContext.clear;

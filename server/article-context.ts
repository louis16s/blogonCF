import type { ContentBlock, Post, SiteConfig } from "../app/data/types";
type HeadingSummary = { id: string; label: string; level: number };
import { createRequestContext } from "./request-context";

export type ArticlePayload = {
  post?: Post;
  blocks?: ContentBlock[];
  headings?: HeadingSummary[];
  nextCursor?: string;
  truncated?: boolean;
  locked?: boolean;
  error?: string;
  status?: number;
  config?: SiteConfig;
};

const articleContext = createRequestContext<ArticlePayload>("louis16s.blog.article-context");
export const storeArticlePayload = articleContext.store;
export const readArticlePayload = articleContext.read;
export const clearArticlePayload = articleContext.clear;

import type { ContentBlock, Post } from "../app/data/types";
import { createRequestContext } from "./request-context";

export type ArticlePayload = {
  post?: Post;
  blocks?: ContentBlock[];
  truncated?: boolean;
  locked?: boolean;
  error?: string;
  status?: number;
};

const articleContext = createRequestContext<ArticlePayload>("louis16s.blog.article-context");
export const storeArticlePayload = articleContext.store;
export const readArticlePayload = articleContext.read;
export const clearArticlePayload = articleContext.clear;

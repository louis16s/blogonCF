import type { ContentBlock, Post } from "../app/data/types";

export type ArticlePayload = {
  post?: Post;
  blocks?: ContentBlock[];
  locked?: boolean;
  error?: string;
};

const contextKey = Symbol.for("louis16s.blog.article-context");

function contexts(): Map<string, ArticlePayload> {
  const root = globalThis as typeof globalThis & { [contextKey]?: Map<string, ArticlePayload> };
  return root[contextKey] ||= new Map<string, ArticlePayload>();
}

export function storeArticlePayload(payload: ArticlePayload): string {
  const key = crypto.randomUUID();
  contexts().set(key, payload);
  return key;
}

export function readArticlePayload(key: string | null): ArticlePayload | undefined {
  return key ? contexts().get(key) : undefined;
}

export function clearArticlePayload(key: string): void {
  contexts().delete(key);
}

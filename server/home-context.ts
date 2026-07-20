import type { Post, SiteConfig, SiteLink } from "../app/data/types";

export type HomePayload = {
  posts: Post[];
  links: SiteLink[];
  config: SiteConfig;
};

const contextKey = Symbol.for("louis16s.blog.home-context");

function contexts(): Map<string, HomePayload> {
  const root = globalThis as typeof globalThis & { [contextKey]?: Map<string, HomePayload> };
  return root[contextKey] ||= new Map<string, HomePayload>();
}

export function storeHomePayload(payload: HomePayload): string {
  const key = crypto.randomUUID();
  contexts().set(key, payload);
  return key;
}

export function readHomePayload(key: string | null): HomePayload | undefined {
  return key ? contexts().get(key) : undefined;
}

export function clearHomePayload(key: string): void {
  contexts().delete(key);
}

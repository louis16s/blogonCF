"use client";

export type LinkPreview = { title: string; subtitle: string; source: string };

const MAX_CONCURRENT_REQUESTS = 4;
const MAX_MEMORY_ENTRIES = 200;
const resolved = new Map<string, LinkPreview>();
const pending = new Map<string, Promise<LinkPreview>>();
const queue: Array<() => void> = [];
let activeRequests = 0;

/** Deduplicates and bounds preview requests made by bookmark-heavy pages. */
export function loadLinkPreview(url: string, signature: string): Promise<LinkPreview> {
  const key = `${signature}:${url}`;
  const cached = resolved.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = schedule(async () => {
    const response = await fetch(`/api/content/link-preview?url=${encodeURIComponent(url)}&signature=${encodeURIComponent(signature)}`);
    if (!response.ok) throw new Error("Link preview is unavailable");
    const value = await response.json() as Partial<LinkPreview>;
    const preview = {
      title: typeof value.title === "string" ? value.title : "",
      subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
      source: typeof value.source === "string" ? value.source : "",
    };
    remember(key, preview);
    return preview;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeRequests += 1;
      task().then(resolve, reject).finally(() => {
        activeRequests -= 1;
        queue.shift()?.();
      });
    };
    if (activeRequests < MAX_CONCURRENT_REQUESTS) run();
    else queue.push(run);
  });
}

function remember(key: string, value: LinkPreview): void {
  resolved.delete(key);
  resolved.set(key, value);
  while (resolved.size > MAX_MEMORY_ENTRIES) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
}

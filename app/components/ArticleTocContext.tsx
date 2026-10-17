"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type ArticleHeading = { id: string; label: string; level: number };
export type ArticleTocStatus = "ready" | "loading" | "error";

type ArticleTocState = {
  headings: ArticleHeading[];
  setHeadings: (headings: ArticleHeading[]) => void;
  status: ArticleTocStatus;
  setStatus: (status: ArticleTocStatus) => void;
  pendingHeadingId: string;
  setPendingHeadingId: (id: string) => void;
  retryVersion: number;
  retryHeadings: () => void;
};

const ArticleTocContext = createContext<ArticleTocState | null>(null);

export function ArticleTocProvider({ initialHeadings = [], children }: { initialHeadings?: ArticleHeading[]; children: ReactNode }) {
  const [headings, setHeadings] = useState(initialHeadings);
  const [status, setStatus] = useState<ArticleTocStatus>("ready");
  const [pendingHeadingId, setPendingHeadingId] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const retryHeadings = useCallback(() => setRetryVersion((version) => version + 1), []);
  const value = useMemo(() => ({ headings, setHeadings, status, setStatus, pendingHeadingId, setPendingHeadingId, retryVersion, retryHeadings }), [headings, status, pendingHeadingId, retryVersion, retryHeadings]);
  return <ArticleTocContext.Provider value={value}>{children}</ArticleTocContext.Provider>;
}

export function useArticleToc() {
  return useContext(ArticleTocContext);
}

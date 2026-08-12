"use client";

import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type ArticleHeading = { id: string; label: string; level: number };

type ArticleTocState = {
  headings: ArticleHeading[];
  setHeadings: (headings: ArticleHeading[]) => void;
};

const ArticleTocContext = createContext<ArticleTocState | null>(null);

export function ArticleTocProvider({ initialHeadings = [], children }: { initialHeadings?: ArticleHeading[]; children: ReactNode }) {
  const [headings, setHeadings] = useState(initialHeadings);
  const value = useMemo(() => ({ headings, setHeadings }), [headings]);
  return <ArticleTocContext.Provider value={value}>{children}</ArticleTocContext.Provider>;
}

export function useArticleToc() {
  return useContext(ArticleTocContext);
}

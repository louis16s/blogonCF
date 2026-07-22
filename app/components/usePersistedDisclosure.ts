"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";

type DisclosureOptions = {
  key: string;
  legacyKey?: string;
  defaultOpen?: boolean;
};

export function usePersistedDisclosure({ key, legacyKey, defaultOpen = true }: DisclosureOptions) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(key) ?? (legacyKey ? window.localStorage.getItem(legacyKey) : null);
        if (saved !== null) setOpen(saved === "true");
      } catch { /* Keep the accessible default when storage is unavailable. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [key, legacyKey]);

  const onToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    try { window.localStorage.setItem(key, String(nextOpen)); }
    catch { /* The disclosure still works without persistence. */ }
  }, [key]);

  return { open, onToggle };
}

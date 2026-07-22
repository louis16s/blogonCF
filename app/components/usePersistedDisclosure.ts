"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { readDisclosureState, writeDisclosureState } from "./clientState";

type DisclosureOptions = {
  key: string;
  legacyKey?: string;
  defaultOpen?: boolean;
};

export function usePersistedDisclosure({ key, legacyKey, defaultOpen = true }: DisclosureOptions) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setOpen(readDisclosureState(window.localStorage, key, legacyKey, defaultOpen));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [defaultOpen, key, legacyKey]);

  const onToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    writeDisclosureState(window.localStorage, key, nextOpen);
  }, [key]);

  return { open, onToggle };
}

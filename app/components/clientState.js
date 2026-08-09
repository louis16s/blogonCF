/** @template T @param {() => Promise<T>} load */
export function createSharedRequest(load) {
  /** @type {Promise<T> | undefined} */
  let request;
  return () => {
    if (!request) {
      request = load().catch((reason) => {
        request = undefined;
        throw reason;
      });
    }
    return request;
  };
}

export function readDisclosureState(storage, key, defaultOpen) {
  try {
    const saved = storage.getItem(key);
    return saved === null ? defaultOpen : saved === "true";
  } catch {
    return defaultOpen;
  }
}

export function writeDisclosureState(storage, key, open) {
  try { storage.setItem(key, String(open)); } catch {}
}

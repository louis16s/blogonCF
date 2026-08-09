export function createRequestContext<T>(name: string) {
  const contextKey = Symbol.for(name);
  const contexts = (): Map<string, T> => {
    const root = globalThis as typeof globalThis & { [contextKey]?: Map<string, T> };
    return root[contextKey] ||= new Map<string, T>();
  };
  return {
    store(payload: T): string {
      const key = crypto.randomUUID();
      contexts().set(key, payload);
      return key;
    },
    read(key: string | null): T | undefined {
      return key ? contexts().get(key) : undefined;
    },
    clear(key: string): void {
      contexts().delete(key);
    },
  };
}

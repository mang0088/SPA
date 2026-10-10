interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const PREFIX = 'tmdb:v1:';
const memory = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const namespacedKey = `${PREFIX}${key}`;
  const entry = memory.get(namespacedKey) as CacheEntry<T> | undefined;
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) memory.delete(namespacedKey);

  try {
    const stored = localStorage.getItem(namespacedKey);
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as CacheEntry<T>;
    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(namespacedKey);
      return undefined;
    }
    memory.set(namespacedKey, parsed as CacheEntry<unknown>);
    return parsed.value;
  } catch {
    return undefined;
  }
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const namespacedKey = `${PREFIX}${key}`;
  const entry: CacheEntry<T> = { value, expiresAt: Date.now() + ttlMs };
  memory.set(namespacedKey, entry as CacheEntry<unknown>);
  try {
    localStorage.setItem(namespacedKey, JSON.stringify(entry));
  } catch {
    // Memory caching remains available when browser storage is full or disabled.
  }
}

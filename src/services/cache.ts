/**
 * Simple in-memory cache with TTL-based expiry and pattern-based invalidation.
 *
 * Used by apiDbService to avoid redundant Firestore reads on polling cycles.
 * Each cache entry is keyed by a string (typically the API URL + query params)
 * and stores the parsed JSON response along with a timestamp.
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
}

const store = new Map<string, CacheEntry>();

/** Default time-to-live: 2 minutes */
const DEFAULT_TTL_MS = 2 * 60 * 1000;

/**
 * Retrieve a cached value if it exists and hasn't expired.
 * Returns `undefined` on cache miss or expiry.
 */
export function cacheGet<T = any>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > ttlMs) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

/**
 * Store a value in the cache.
 */
export function cacheSet<T = any>(key: string, data: T): void {
  store.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalidate (delete) a single cache key.
 */
export function cacheInvalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all cache keys whose key starts with the given prefix.
 * Useful for clearing an entire entity type (e.g. all lesson caches).
 */
export function cacheInvalidateByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Clear the entire cache. Use sparingly (e.g. on logout).
 */
export function cacheClear(): void {
  store.clear();
}

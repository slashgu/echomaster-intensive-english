/**
 * Simple in-memory cache with TTL-based expiry, pattern-based invalidation,
 * and invalidation listeners.
 *
 * Used by apiDbService to avoid redundant Firestore reads on polling cycles.
 * Each cache entry is keyed by a string (typically the API URL + query params)
 * and stores the parsed JSON response along with a timestamp.
 *
 * Invalidation listeners allow active subscriptions to immediately re-fetch
 * when a mutation invalidates their cache key, eliminating the delay between
 * a write and the next poll cycle.
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
}

const store = new Map<string, CacheEntry>();

/** Default time-to-live: 2 minutes */
const DEFAULT_TTL_MS = 2 * 60 * 1000;

// ── Invalidation listeners ──────────────────────────────────────────
// Each listener is keyed by its cache key and called whenever that key
// is invalidated (by exact match or prefix match).

type InvalidationListener = () => void;
const listeners = new Map<string, Set<InvalidationListener>>();

/**
 * Register a listener that fires whenever `key` is invalidated.
 * Returns an unsubscribe function.
 */
export function onCacheInvalidate(key: string, listener: InvalidationListener): () => void {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key)!.add(listener);
  return () => {
    const set = listeners.get(key);
    if (set) {
      set.delete(listener);
      if (set.size === 0) listeners.delete(key);
    }
  };
}

/** Notify all listeners registered for a given key. */
function notifyListeners(key: string): void {
  const set = listeners.get(key);
  if (set) {
    set.forEach(fn => fn());
  }
}

// ── Core cache API ──────────────────────────────────────────────────

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
 * Invalidate (delete) a single cache key and notify listeners.
 */
export function cacheInvalidate(key: string): void {
  store.delete(key);
  notifyListeners(key);
}

/**
 * Invalidate all cache keys whose key starts with the given prefix.
 * Useful for clearing an entire entity type (e.g. all lesson caches).
 * Notifies listeners for every matched key.
 */
export function cacheInvalidateByPrefix(prefix: string): void {
  const keysToNotify: string[] = [];
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      keysToNotify.push(key);
    }
  }
  // Also notify any listeners whose registered key matches the prefix,
  // even if there was no cache entry (the subscription still needs to re-fetch).
  for (const key of listeners.keys()) {
    if (key.startsWith(prefix) && !keysToNotify.includes(key)) {
      keysToNotify.push(key);
    }
  }
  keysToNotify.forEach(notifyListeners);
}

/**
 * Clear the entire cache. Use sparingly (e.g. on logout).
 */
export function cacheClear(): void {
  store.clear();
}

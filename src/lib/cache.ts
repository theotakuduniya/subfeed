interface CacheRecord<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const STORAGE_PREFIX = 'subfeed:cache:';
const MAX_MEMORY_ENTRIES = 120;

const memoryCache = new Map<string, CacheRecord<unknown>>();

function pruneMemoryCache(): void {
  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
  const oldestKey = memoryCache.keys().next().value;
  if (oldestKey) memoryCache.delete(oldestKey);
}

export function cacheGet<T>(key: string): T | null {
  const now = Date.now();
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    if (now < memEntry.expiresAt) {
      return memEntry.value as T;
    }
    memoryCache.delete(key);
  }

  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRecord<T>;
    if (!parsed || typeof parsed.expiresAt !== 'number') {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return null;
    }
    if (now >= parsed.expiresAt) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return null;
    }
    memoryCache.set(key, parsed);
    pruneMemoryCache();
    return parsed.value;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const record: CacheRecord<T> = {
    value,
    storedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };

  memoryCache.set(key, record);
  pruneMemoryCache();

  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(record));
  } catch {
    // If sessionStorage quota is exceeded, clear old subfeed cache entries and retry once
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove.slice(0, Math.ceil(keysToRemove.length / 2))) {
        sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(record));
    } catch {
      // Memory cache still holds the entry
    }
  }
}

export function cacheDelete(key: string): void {
  memoryCache.delete(key);
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Ignore
  }
}

export function cacheClearAll(): void {
  memoryCache.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      sessionStorage.removeItem(k);
    }
  } catch {
    // Ignore
  }
}

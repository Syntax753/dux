// Caches LLM responses keyed by (sessionId, action, worldState hash).
// Same action in the same world state returns instantly.
// Repeated actions get a summarized version.
// Max 500 entries — evicts oldest when full.

const MAX_CACHE_SIZE = 500;

interface CacheEntry {
  response: unknown;
  narrative: string;
  count: number;
  timestamp: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();

  private buildKey(
    sessionId: string,
    action: string,
    entityId: string,
    roomId: string,
    chainIndex: number,
    inventory: string[]
  ): string {
    return `${sessionId}:${roomId}:${chainIndex}:${action}:${entityId}:${inventory.sort().join(",")}`;
  }

  get(
    sessionId: string,
    action: string,
    entityId: string,
    roomId: string,
    chainIndex: number,
    inventory: string[]
  ): CacheEntry | undefined {
    const key = this.buildKey(sessionId, action, entityId, roomId, chainIndex, inventory);
    return this.cache.get(key);
  }

  set(
    sessionId: string,
    action: string,
    entityId: string,
    roomId: string,
    chainIndex: number,
    inventory: string[],
    narrative: string,
    response: unknown
  ): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    const key = this.buildKey(sessionId, action, entityId, roomId, chainIndex, inventory);
    const existing = this.cache.get(key);
    this.cache.set(key, {
      response,
      narrative,
      count: (existing?.count ?? 0) + 1,
      timestamp: Date.now(),
    });
  }

  static summarize(narrative: string, count: number): string {
    if (count === 1) return `You've already done this. ${narrative}`;
    return `You've tried this ${count + 1} times now. Nothing has changed.`;
  }

  clearSession(sessionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(sessionId + ":")) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }

  get size(): number {
    return this.cache.size;
  }
}

export const responseCache = new ResponseCache();

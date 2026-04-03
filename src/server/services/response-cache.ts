// Caches LLM responses keyed by (sessionId, action, worldState hash).
// Same action in the same world state returns instantly.
// Repeated actions get a summarized version.

interface CacheEntry {
  response: unknown;
  narrative: string;
  count: number; // how many times this exact action+state was hit
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();

  // Build a cache key from the action and relevant world state
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
    const key = this.buildKey(sessionId, action, entityId, roomId, chainIndex, inventory);
    const existing = this.cache.get(key);
    this.cache.set(key, {
      response,
      narrative,
      count: (existing?.count ?? 0) + 1,
    });
  }

  // Build a summary for repeated actions
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
}

export const responseCache = new ResponseCache();

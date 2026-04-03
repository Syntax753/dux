import type { GameStartResponse } from "../shared/types.js";
import LZString from "lz-string";

// --- Journey Trace ---
// The player's entire session is a trace. Each level visited is a span.
// Navigating between levels (stairs, exits) links spans together.

export interface JourneySpan {
  levelId: string;
  title: string;
  roomCount: number;
  depth: number; // 0 = surface, 1 = first descent, etc.
  enteredAt: number;
  leftAt?: number;
  enteredFrom?: string; // levelId of the level we came from
  direction?: "descend" | "ascend"; // how we got here
}

export interface Journey {
  id: string;
  startedAt: number;
  spans: JourneySpan[];
  currentSpanIndex: number;
  levelStack: string[]; // stack of levelIds — descend pushes, ascend pops
}

// --- Level Cache ---
// Keyed by unique level ID, stored compressed in localStorage

const CACHE_PREFIX = "dux_lv_";
const JOURNEY_KEY = "dux_journey";

export class JourneyManager {
  journey: Journey;

  constructor() {
    this.journey = {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      spans: [],
      currentSpanIndex: -1,
      levelStack: [],
    };
  }

  // --- Level cache (keyed by level ID) ---

  getCachedLevel(levelId: string): GameStartResponse | null {
    try {
      const compressed = localStorage.getItem(CACHE_PREFIX + levelId);
      if (!compressed) return null;
      const json = LZString.decompressFromUTF16(compressed);
      if (!json) return null;
      const data = JSON.parse(json) as GameStartResponse;
      console.log(
        `%c[journey] Cache hit: level "${data.level.title}" (${levelId})`,
        "color: #00e676"
      );
      return data;
    } catch {
      localStorage.removeItem(CACHE_PREFIX + levelId);
      return null;
    }
  }

  cacheLevel(levelId: string, data: GameStartResponse): void {
    try {
      const json = JSON.stringify(data);
      const compressed = LZString.compressToUTF16(json);
      localStorage.setItem(CACHE_PREFIX + levelId, compressed);
      const ratio = ((compressed.length / json.length) * 100).toFixed(0);
      console.log(
        `%c[journey] Cached level "${data.level.title}" (${levelId}) — ${json.length} → ${compressed.length} bytes (${ratio}%)`,
        "color: #00e676"
      );
    } catch {
      console.warn("[journey] localStorage full, evicting oldest");
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    // Remove the oldest span's cached level
    if (this.journey.spans.length > 1) {
      const oldest = this.journey.spans[0];
      localStorage.removeItem(CACHE_PREFIX + oldest.levelId);
      console.log(`%c[journey] Evicted level "${oldest.title}"`, "color: #ffab00");
    }
  }

  // --- Journey span management ---

  enterLevel(levelId: string, title: string, roomCount: number, from?: { levelId: string; direction: "descend" | "ascend" }): void {
    // Close current span if any
    if (this.currentSpanIndex >= 0) {
      this.journey.spans[this.currentSpanIndex].leftAt = Date.now();
    }

    const span: JourneySpan = {
      levelId,
      title,
      roomCount,
      depth: this.journey.levelStack.length,
      enteredAt: Date.now(),
      enteredFrom: from?.levelId,
      direction: from?.direction,
    };

    // Check if we've visited this level before
    const existingIdx = this.journey.spans.findIndex((s) => s.levelId === levelId);
    if (existingIdx >= 0) {
      // Returning to known level — update the span
      this.journey.spans[existingIdx].enteredAt = Date.now();
      this.journey.spans[existingIdx].leftAt = undefined;
      this.journey.currentSpanIndex = existingIdx;
      console.log(
        `%c[journey] ↩ Returning to known level "${title}" (depth ${span.depth})`,
        "color: #4fc3f7; font-weight: bold"
      );
    } else {
      // New level
      this.journey.spans.push(span);
      this.journey.currentSpanIndex = this.journey.spans.length - 1;
      console.log(
        `%c[journey] → Entering new level "${title}" (depth ${span.depth}, ${roomCount} rooms)`,
        "color: #4fc3f7; font-weight: bold"
      );
    }

    this.saveJourney();
  }

  descend(newLevelId: string): void {
    this.journey.levelStack.push(this.currentLevelId);
  }

  ascend(): string | null {
    return this.journey.levelStack.pop() ?? null;
  }

  get currentLevelId(): string {
    if (this.journey.currentSpanIndex < 0) return "";
    return this.journey.spans[this.journey.currentSpanIndex].levelId;
  }

  get currentDepth(): number {
    return this.journey.levelStack.length;
  }

  get parentLevelId(): string | null {
    if (this.journey.levelStack.length === 0) return null;
    return this.journey.levelStack[this.journey.levelStack.length - 1];
  }

  // --- Persistence ---

  private saveJourney(): void {
    try {
      localStorage.setItem(JOURNEY_KEY, JSON.stringify(this.journey));
    } catch { /* ignore */ }
  }

  // --- Debug: print journey trace ---

  printTrace(): void {
    console.group("%c[journey] Full journey trace", "color: #d4a574; font-weight: bold");
    for (let i = 0; i < this.journey.spans.length; i++) {
      const s = this.journey.spans[i];
      const indent = "  ".repeat(s.depth);
      const current = i === this.journey.currentSpanIndex ? " ← YOU ARE HERE" : "";
      const duration = s.leftAt ? ` (${((s.leftAt - s.enteredAt) / 1000).toFixed(0)}s)` : " (active)";
      const arrow = s.direction === "descend" ? "↓" : s.direction === "ascend" ? "↑" : "→";
      console.log(
        `%c${indent}${arrow} [depth ${s.depth}] "${s.title}" — ${s.roomCount} rooms${duration}${current}`,
        i === this.journey.currentSpanIndex ? "color: #4fc3f7; font-weight: bold" : "color: #78909c"
      );
    }
    console.groupEnd();
  }
}

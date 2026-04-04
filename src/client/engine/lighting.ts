import { LevelGrid } from "./level-grid.js";

// Light source definition
export interface LightSource {
  x: number;       // level-wide coords
  y: number;
  brightness: number; // 0-1 (percentage, e.g. 0.5 = 50%)
  radius: number;     // max tiles the light reaches
}

// Lighting system: computes per-tile brightness from all light sources.
// Light diminishes linearly with orthogonal (Manhattan) distance.
// Walls block light propagation.
// Each tile maintains brightness (0-1) used by the display manager.

export class LightingSystem {
  private grid: LevelGrid | null = null;
  private width = 0;
  private height = 0;

  // Per-cell brightness (0-1), recomputed each frame
  private brightness: Float32Array = new Float32Array(0);
  // Whether the player has ever illuminated this cell (for fog of war)
  private revealed: Uint8Array = new Uint8Array(0);

  // Static light sources (torches, etc.) — placed once when room loads
  private staticLights: LightSource[] = [];

  init(grid: LevelGrid): void {
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.brightness = new Float32Array(this.width * this.height);
    this.revealed = new Uint8Array(this.width * this.height);
    this.staticLights = [];
  }

  addLight(light: LightSource): void {
    this.staticLights.push(light);
  }

  clearStaticLights(): void {
    this.staticLights = [];
  }

  // Recompute all lighting. Called each frame.
  update(playerX: number, playerY: number): void {
    if (!this.grid) return;

    // Reset brightness
    this.brightness.fill(0);

    // Player light source (60% brightness, radius 8)
    this.applyLight({ x: playerX, y: playerY, brightness: 0.6, radius: 8 });

    // Static lights (torches etc.)
    for (const light of this.staticLights) {
      this.applyLight(light);
    }

    // Mark any lit cell as revealed
    for (let i = 0; i < this.brightness.length; i++) {
      if (this.brightness[i] > 0.01) {
        this.revealed[i] = 1;
      }
    }
  }

  // Get brightness at a cell (0-1)
  getBrightness(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.brightness[y * this.width + x];
  }

  // Has this cell ever been lit?
  isRevealed(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.revealed[y * this.width + x] === 1;
  }

  // Apply a single light source using flood fill that respects walls
  private applyLight(light: LightSource): void {
    if (!this.grid) return;
    const { x: lx, y: ly, brightness: maxB, radius } = light;

    // BFS flood from light source, blocked by walls
    const visited = new Set<number>();
    const queue: Array<{ x: number; y: number; dist: number }> = [{ x: lx, y: ly, dist: 0 }];
    visited.add(ly * this.width + lx);

    while (queue.length > 0) {
      const { x, y, dist } = queue.shift()!;

      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      if (dist > radius) continue;

      // Calculate brightness: linear falloff with distance
      const falloff = 1 - dist / (radius + 1);
      const contribution = maxB * falloff;

      // Add to existing brightness (multiple lights stack, capped at 1)
      const idx = y * this.width + x;
      this.brightness[idx] = Math.min(1, this.brightness[idx] + contribution);

      // If this cell is a wall, it receives light but doesn't propagate further
      const cell = this.grid.cells[y][x];
      if (cell === "wall") continue;

      // Expand to 4 cardinal neighbors
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        const nIdx = ny * this.width + nx;
        if (visited.has(nIdx)) continue;
        visited.add(nIdx);
        queue.push({ x: nx, y: ny, dist: dist + 1 });
      }
    }
  }
}

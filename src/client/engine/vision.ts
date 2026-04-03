import { LevelGrid } from "./level-grid.js";

// Fog of war with line-of-sight raycasting.
// - "visible": player can currently see this cell
// - "revealed": player has seen this cell before but can't see it now (dimmed)
// - "hidden": player has never seen this cell (black)

export type Visibility = "visible" | "revealed" | "hidden";

export class VisionSystem {
  private grid: LevelGrid | null = null;
  private width = 0;
  private height = 0;

  // Per-cell state
  private visible: boolean[] = []; // currently visible this frame
  private revealed: boolean[] = []; // ever seen

  init(grid: LevelGrid): void {
    this.grid = grid;
    this.width = grid.width;
    this.height = grid.height;
    this.visible = new Array(this.width * this.height).fill(false);
    this.revealed = new Array(this.width * this.height).fill(false);
  }

  // Recalculate visibility from the player's position
  update(playerX: number, playerY: number): void {
    if (!this.grid) return;

    // Clear current visibility
    this.visible.fill(false);

    // Player's cell is always visible
    this.markVisible(playerX, playerY);

    // Cast rays in all directions using symmetric shadowcasting
    // For infinite vision, cast to the edge of the grid
    const maxRange = Math.max(this.width, this.height);
    this.castRays(playerX, playerY, maxRange);
  }

  getVisibility(x: number, y: number): Visibility {
    const idx = y * this.width + x;
    if (idx < 0 || idx >= this.visible.length) return "hidden";
    if (this.visible[idx]) return "visible";
    if (this.revealed[idx]) return "revealed";
    return "hidden";
  }

  private markVisible(x: number, y: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = y * this.width + x;
    this.visible[idx] = true;
    this.revealed[idx] = true;
  }

  private isOpaque(x: number, y: number): boolean {
    if (!this.grid) return true;
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
    const cell = this.grid.cells[y][x];
    // Walls block vision, everything else is transparent
    return cell === "wall";
  }

  // Raycasting using recursive shadowcasting (8 octants)
  // Based on the classic roguelike algorithm by Björn Bergström
  private castRays(px: number, py: number, range: number): void {
    // Cast in all 8 octants
    for (let octant = 0; octant < 8; octant++) {
      this.castOctant(px, py, range, 1, 1.0, 0.0, octant);
    }
  }

  private castOctant(
    px: number, py: number,
    range: number,
    row: number,
    startSlope: number,
    endSlope: number,
    octant: number
  ): void {
    if (startSlope < endSlope) return;

    let nextStart = startSlope;

    for (let r = row; r <= range; r++) {
      let blocked = false;

      for (let col = Math.floor(r * endSlope); col >= 0 && col <= Math.ceil(r * startSlope); col--) {
        const [x, y] = this.transformOctant(px, py, r, col, octant);

        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;

        const leftSlope = (col + 0.5) / (r - 0.5);
        const rightSlope = (col - 0.5) / (r + 0.5);

        if (startSlope < rightSlope) continue;
        if (endSlope > leftSlope) continue;

        // This cell is visible
        this.markVisible(x, y);

        if (blocked) {
          if (this.isOpaque(x, y)) {
            nextStart = rightSlope;
            continue;
          } else {
            blocked = false;
            nextStart = leftSlope; // fixed: was startSlope
          }
        } else {
          if (this.isOpaque(x, y) && r < range) {
            blocked = true;
            this.castOctant(px, py, range, r + 1, nextStart, rightSlope, octant);
            nextStart = rightSlope; // fixed
          }
        }
      }

      if (blocked) break;
    }
  }

  private transformOctant(px: number, py: number, row: number, col: number, octant: number): [number, number] {
    switch (octant) {
      case 0: return [px + col, py - row];
      case 1: return [px + row, py - col];
      case 2: return [px + row, py + col];
      case 3: return [px + col, py + row];
      case 4: return [px - col, py + row];
      case 5: return [px - row, py + col];
      case 6: return [px - row, py - col];
      case 7: return [px - col, py - row];
      default: return [px, py];
    }
  }
}

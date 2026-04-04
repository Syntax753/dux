import type {
  TileSet,
  TilePattern,
  LevelSpatialMap,
} from "../../shared/types.js";
import { LevelGrid } from "./level-grid.js";
import { Camera } from "./camera.js";
import { LightingSystem, type LightSource } from "./lighting.js";
import { type PlacedItem, getItemDef } from "./item-registry.js";

const TILE_PX = 8;
const NATIVE_SCALE = 4;
const CELL_PX = TILE_PX * NATIVE_SCALE;

export class DisplayManager {
  private tileSet: TileSet | null = null;
  private canvasW = 0;
  private canvasH = 0;
  private levelGrid: LevelGrid | null = null;
  private _roomCount = 0;
  readonly camera = new Camera();
  readonly lighting = new LightingSystem();
  private placedItems: PlacedItem[] = [];
  showRoomIds = false; // debug: toggle with displayManager.showRoomIds = true in console

  init(
    spatialMap: LevelSpatialMap,
    tileSet: TileSet,
    canvasWidth: number,
    canvasHeight: number,
    levelGrid: LevelGrid
  ): void {
    this.tileSet = tileSet;
    this.canvasW = canvasWidth;
    this.canvasH = canvasHeight;
    this.levelGrid = levelGrid;
    this._roomCount = spatialMap.rooms.filter((r) => r.roomId !== "exit").length;
    this.lighting.init(levelGrid);
    this.placedItems = [];
  }

  getPlacedItems(): PlacedItem[] {
    return this.placedItems;
  }

  // Find a placed decoration item adjacent to a position
  findNearbyItem(x: number, y: number): PlacedItem | null {
    const offsets = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of offsets) {
      const item = this.placedItems.find((i) => i.x === x + dx && i.y === y + dy);
      if (item) return item;
    }
    return null;
  }

  addItem(item: PlacedItem): void {
    this.placedItems.push(item);
    // Register light source if the item emits light
    const itemDef = getItemDef(item.typeId);
    if (itemDef && (itemDef.brightness ?? 0) > 0) {
      this.lighting.addLight({

        x: item.x,
        y: item.y,
        brightness: itemDef.brightness!,
        radius: itemDef.lightRadius ?? 4,
      });
    }
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
  }

  // Call every frame before render
  update(playerX: number, playerY: number): void {
    this.camera.setViewport(this.canvasW, this.canvasH, CELL_PX);
    this.camera.follow(playerX, playerY);
    this.camera.update();
    this.lighting.update(playerX, playerY);
  }

  // Snap camera to player (no smooth, used on room load)
  snapCamera(playerX: number, playerY: number): void {
    this.camera.setViewport(this.canvasW, this.canvasH, CELL_PX);
    this.camera.snapTo(playerX, playerY);
  }

  render(
    ctx: CanvasRenderingContext2D,
    playerX: number,
    playerY: number,
    currentRoomId: string
  ): void {
    if (!this.levelGrid || !this.tileSet) return;

    // Camera center in pixel space
    const camPxX = this.camera.x * CELL_PX;
    const camPxY = this.camera.y * CELL_PX;

    // Offset: shift so camera center is at canvas center
    const offsetX = Math.round(this.canvasW / 2 - camPxX);
    const offsetY = Math.round(this.canvasH / 2 - camPxY);

    // Visible cell range (with margin)
    const margin = 2;
    const startCol = Math.max(0, Math.floor(-offsetX / CELL_PX) - margin);
    const startRow = Math.max(0, Math.floor(-offsetY / CELL_PX) - margin);
    const endCol = Math.min(this.levelGrid.width, Math.ceil((this.canvasW - offsetX) / CELL_PX) + margin);
    const endRow = Math.min(this.levelGrid.height, Math.ceil((this.canvasH - offsetY) / CELL_PX) + margin);

    // Clear
    ctx.fillStyle = "#050508";
    ctx.fillRect(0, 0, this.canvasW, this.canvasH);

    // Draw other layers faded (if multi-layer)
    const currentLayer = this.levelGrid.currentLayer;
    for (const [layer, layerCells] of this.levelGrid.layers) {
      if (layer === currentLayer) continue;
      const layerFade = 0.15; // other layers shown at 15% brightness
      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const cell = layerCells[row]?.[col];
          if (!cell || cell === "wall") continue;
          let pattern: TilePattern;
          if (cell === "corridor") {
            pattern = this.tileSet.floor;
          } else {
            pattern = this.tileSet[cell] ?? this.tileSet.floor;
          }
          const sx = offsetX + col * CELL_PX;
          const sy = offsetY + row * CELL_PX;
          this.drawTileLit(ctx, pattern, sx, sy, layerFade);
        }
      }
    }

    // Draw current layer cells with brightness-based shading
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const bright = this.lighting.getBrightness(col, row);

        // No light = invisible
        if (bright < 0.01) continue;

        const cell = this.levelGrid.cells[row][col];

        // Skip deep walls with no visible neighbors
        if (cell === "wall" && !this.hasNonWallNeighbor(col, row)) continue;

        let pattern: TilePattern;
        if (cell === "corridor") {
          pattern = this.tileSet.floor;
        } else {
          pattern = this.tileSet[cell] ?? this.tileSet.floor;
        }

        const sx = offsetX + col * CELL_PX;
        const sy = offsetY + row * CELL_PX;

        if (bright > 0.01) {
          // Currently lit by a light source — draw at actual brightness
          this.drawTileLit(ctx, pattern, sx, sy, bright);
        }
        // else: 0 brightness = pitch black, don't draw anything
      }
    }

    // Draw room ID labels on tiles (debug overlay)
    if (this.showRoomIds) {
      ctx.font = `${Math.max(6, CELL_PX * 0.3)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Draw one label per room, centered in the room
      for (const [roomId, off] of this.levelGrid.roomOffsets) {
        const cx = offsetX + (off.cellX + off.width / 2) * CELL_PX;
        const cy = offsetY + (off.cellY + off.height / 2) * CELL_PX;
        // Background
        const label = roomId.replace("room_", "R");
        const tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(cx - tw / 2, cy - 6, tw, 12);
        // Text
        ctx.fillStyle = "#d4a574";
        ctx.fillText(label, cx, cy);
      }

      // Also draw small room ID on each tile border
      ctx.font = `${Math.max(5, CELL_PX * 0.2)}px monospace`;
      ctx.globalAlpha = 0.3;
      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const owner = this.levelGrid.cellOwner[row][col];
          if (!owner) continue;
          const bright = this.lighting.getBrightness(col, row);
          if (bright < 0.01 && !this.lighting.isRevealed(col, row)) continue;
          const sx = offsetX + col * CELL_PX + 2;
          const sy = offsetY + row * CELL_PX + CELL_PX - 2;
          ctx.fillStyle = "#aaa";
          ctx.fillText(owner.replace("room_", ""), sx, sy);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Draw player — always fully lit
    const playerPattern = this.tileSet.player ?? this.tileSet.floor;
    const psx = offsetX + playerX * CELL_PX;
    const psy = offsetY + playerY * CELL_PX;
    this.drawTile(ctx, playerPattern, psx, psy);
  }

  renderEntities(
    ctx: CanvasRenderingContext2D,
    entities: Array<{ x: number; y: number }>,
    currentRoomId: string
  ): void {
    if (!this.levelGrid || !this.tileSet) return;

    const camPxX = this.camera.x * CELL_PX;
    const camPxY = this.camera.y * CELL_PX;
    const offsetX = Math.round(this.canvasW / 2 - camPxX);
    const offsetY = Math.round(this.canvasH / 2 - camPxY);

    const pattern = this.tileSet.object ?? this.tileSet.floor;
    for (const e of entities) {
      const bright = this.lighting.getBrightness(e.x, e.y);
      if (bright < 0.01 && !this.lighting.isRevealed(e.x, e.y)) continue;

      const sx = offsetX + e.x * CELL_PX;
      const sy = offsetY + e.y * CELL_PX;

      if (sx + CELL_PX < 0 || sx > this.canvasW || sy + CELL_PX < 0 || sy > this.canvasH) continue;

      if (bright < 0.01) continue; // invisible in darkness
      this.drawTileLit(ctx, pattern, sx, sy, bright);
    }
  }

  // Convert level-wide cell coords to screen pixel coords (for radial menu positioning)
  cellToScreen(levelX: number, levelY: number): { sx: number; sy: number } {
    const camPxX = this.camera.x * CELL_PX;
    const camPxY = this.camera.y * CELL_PX;
    const offsetX = Math.round(this.canvasW / 2 - camPxX);
    const offsetY = Math.round(this.canvasH / 2 - camPxY);
    return {
      sx: offsetX + levelX * CELL_PX + CELL_PX / 2,
      sy: offsetY + levelY * CELL_PX + CELL_PX / 2,
    };
  }

  private hasNonWallNeighbor(x: number, y: number): boolean {
    const g = this.levelGrid!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < g.width && ny >= 0 && ny < g.height) {
        if (g.cells[ny][nx] !== "wall") return true;
      }
    }
    return false;
  }

  get ready(): boolean {
    return this.levelGrid !== null && this.tileSet !== null;
  }

  get roomCount(): number {
    return this._roomCount;
  }

  private drawTile(ctx: CanvasRenderingContext2D, pattern: TilePattern, sx: number, sy: number): void {
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        ctx.fillStyle = pattern[py]?.[px] ?? "#ff00ff";
        ctx.fillRect(sx + px * NATIVE_SCALE, sy + py * NATIVE_SCALE, NATIVE_SCALE, NATIVE_SCALE);
      }
    }
  }

  // Draw a tile scaled by brightness (0 = black, 1 = full color)
  private drawTileLit(ctx: CanvasRenderingContext2D, pattern: TilePattern, sx: number, sy: number, brightness: number): void {
    const b = Math.max(0, Math.min(1, brightness));
    for (let py = 0; py < TILE_PX; py++) {
      for (let px = 0; px < TILE_PX; px++) {
        ctx.fillStyle = scaleColor(pattern[py]?.[px] ?? "#ff00ff", b);
        ctx.fillRect(sx + px * NATIVE_SCALE, sy + py * NATIVE_SCALE, NATIVE_SCALE, NATIVE_SCALE);
      }
    }
  }
}

function scaleColor(hex: string, brightness: number): string {
  const r = Math.floor(parseInt(hex.slice(1, 3), 16) * brightness);
  const g = Math.floor(parseInt(hex.slice(3, 5), 16) * brightness);
  const b = Math.floor(parseInt(hex.slice(5, 7), 16) * brightness);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

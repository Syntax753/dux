import type { RoomLayout, TileSet, TilePattern } from "../../shared/types.js";

const TILE_PX = 8;
const SCALE = 4;
const CELL_PX = TILE_PX * SCALE; // 32px per cell

export const CANVAS_SIZE = 16 * CELL_PX; // 512px for 16x16 grid

export function initCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  canvas.style.width = `${CANVAS_SIZE}px`;
  canvas.style.height = `${CANVAS_SIZE}px`;
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function renderRoom(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  tileSet: TileSet,
  entities: Array<{ id: string; x: number; y: number }>,
  playerX: number,
  playerY: number
): void {
  // Draw grid cells
  for (let row = 0; row < layout.height; row++) {
    for (let col = 0; col < layout.width; col++) {
      const cellType = layout.cells[row][col];
      const pattern = tileSet[cellType] ?? tileSet.floor;
      drawTile(ctx, pattern, col * CELL_PX, row * CELL_PX);
    }
  }

  // Draw entities on top (object tile with slight tint)
  for (const entity of entities) {
    const pattern = tileSet.object ?? tileSet.floor;
    drawTile(ctx, pattern, entity.x * CELL_PX, entity.y * CELL_PX);
  }

  // Draw player
  const playerPattern = tileSet.player ?? tileSet.floor;
  drawTile(ctx, playerPattern, playerX * CELL_PX, playerY * CELL_PX);
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  pattern: TilePattern,
  screenX: number,
  screenY: number
): void {
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const color = pattern[py]?.[px] ?? "#ff00ff"; // magenta for missing
      ctx.fillStyle = color;
      ctx.fillRect(
        screenX + px * SCALE,
        screenY + py * SCALE,
        SCALE,
        SCALE
      );
    }
  }
}

export function cellToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: x * CELL_PX + CELL_PX / 2, sy: y * CELL_PX + CELL_PX / 2 };
}

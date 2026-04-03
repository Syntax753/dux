import type { RoomLayout, CellType } from "../../shared/types.js";

const WALKABLE: Set<CellType> = new Set(["floor", "exit", "object"]);

export function canMoveTo(layout: RoomLayout, x: number, y: number): boolean {
  if (x < 0 || x >= layout.width || y < 0 || y >= layout.height) return false;
  return WALKABLE.has(layout.cells[y][x]);
}

export function isExit(layout: RoomLayout, x: number, y: number): boolean {
  if (x < 0 || x >= layout.width || y < 0 || y >= layout.height) return false;
  return layout.cells[y][x] === "exit";
}

export function isLockedExit(layout: RoomLayout, x: number, y: number): boolean {
  if (x < 0 || x >= layout.width || y < 0 || y >= layout.height) return false;
  return layout.cells[y][x] === "exit_locked";
}

export function getExitDirection(layout: RoomLayout, x: number, y: number): string | null {
  const exit = layout.exits.find((e) => e.x === x && e.y === y);
  return exit?.direction ?? null;
}

export function getAdjacentEntity(
  entities: Array<{ id: string; x: number; y: number }>,
  playerX: number,
  playerY: number
): { id: string; x: number; y: number } | null {
  // Check all 4 cardinal directions + current tile
  const offsets = [
    [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
  ];
  for (const [dx, dy] of offsets) {
    const entity = entities.find(
      (e) => e.x === playerX + dx && e.y === playerY + dy
    );
    if (entity) return entity;
  }
  return null;
}

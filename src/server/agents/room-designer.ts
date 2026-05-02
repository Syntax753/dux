import type { RoomDefinition } from "../models/level.js";
import type { RoomLayout } from "../../shared/types.js";

export interface RoomDesignOptions {
  isStartRoom?: boolean;
  isFinalRoom?: boolean;
}

// Deterministic room layout — no LLM call. Walls on perimeter, optional carved
// corners for non-rectangular shapes, exits opened in the appropriate edges,
// stairs in start/final rooms, entities placed on interior floor tiles.
export async function designRoom(
  room: RoomDefinition,
  _scene: string,
  visibleEntities: Array<{ id: string; name: string }>,
  _style: unknown,
  _availableTileTypes: string[],
  options: RoomDesignOptions = {}
): Promise<RoomLayout> {
  const W = room.width;
  const H = room.height;
  const cells: RoomLayout["cells"] = [];

  for (let row = 0; row < H; row++) {
    const r: RoomLayout["cells"][number] = [];
    for (let col = 0; col < W; col++) {
      if (row === 0 || row === H - 1 || col === 0 || col === W - 1) {
        r.push("wall");
      } else {
        r.push("floor");
      }
    }
    cells.push(r);
  }

  const carveW = Math.max(0, Math.floor(W / 3));
  const carveH = Math.max(0, Math.floor(H / 3));
  if (carveW > 0 && carveH > 0 && W > 5 && H > 5) {
    const numCorners = Math.floor(Math.random() * 3) + 1;
    const corners = [
      { r: 0, c: 0 },
      { r: 0, c: W - carveW },
      { r: H - carveH, c: 0 },
      { r: H - carveH, c: W - carveW },
    ];
    corners.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(numCorners, corners.length); i++) {
      const { r, c } = corners[i];
      for (let y = r; y < r + carveH; y++) {
        for (let x = c; x < c + carveW; x++) {
          cells[y][x] = "wall";
        }
      }
    }
  }

  const gridExits: RoomLayout["exits"] = [];
  for (const exit of room.exits) {
    const midX = Math.floor(W / 2);
    const midY = Math.floor(H / 2);
    let x: number, y: number;
    switch (exit.direction) {
      case "north": x = midX; y = 0; break;
      case "south": x = midX; y = H - 1; break;
      case "east":  x = W - 1; y = midY; break;
      case "west":  x = 0;     y = midY; break;
      default: x = midX; y = 0;
    }
    cells[y][x] = "floor";
    const dx = exit.direction === "east" ? -1 : exit.direction === "west" ? 1 : 0;
    const dy = exit.direction === "south" ? -1 : exit.direction === "north" ? 1 : 0;
    for (let step = 1; step <= 2; step++) {
      const px = x + dx * step;
      const py = y + dy * step;
      if (px >= 0 && px < W && py >= 0 && py < H) cells[py][px] = "floor";
    }
    gridExits.push({ x, y, direction: exit.direction, toRoomId: exit.to, locked: false });
  }

  if (options.isStartRoom && H > 2 && W > 2) {
    const stX = Math.floor(W / 2);
    const stY = Math.min(H - 2, H - 2);
    if (cells[stY][stX] === "floor") cells[stY][stX] = "stairs_up";
  }
  if (options.isFinalRoom && H > 2 && W > 2) {
    const stX = Math.floor(W / 2);
    const stY = Math.max(1, 1);
    if (cells[stY][stX] === "floor") cells[stY][stX] = "stairs_down";
  }

  const gridEntities: RoomLayout["entities"] = [];
  let placed = 0;
  for (const e of visibleEntities) {
    const ex = Math.min(W - 2, 1 + (placed * 2) % Math.max(1, W - 2));
    const ey = Math.min(H - 2, 1 + Math.floor(placed / Math.max(1, W - 2)));
    if (ey > 0 && ey < H - 1 && ex > 0 && ex < W - 1 && cells[ey][ex] === "floor") {
      cells[ey][ex] = "object";
      gridEntities.push({ id: e.id, x: ex, y: ey });
    }
    placed++;
  }

  const psX = Math.floor(W / 2);
  const psY = Math.max(1, H - 2);

  return {
    roomId: room.id,
    width: W,
    height: H,
    cells,
    entities: gridEntities,
    exits: gridExits,
    playerStart: { x: psX, y: psY },
  };
}

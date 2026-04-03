import type { RoomDefinition } from "../models/level.js";
import type { RoomLayout, RoomStyle } from "../../shared/types.js";
import { callAgent } from "../services/llm-client.js";
import { ROOM_DESIGNER_SYSTEM } from "../prompts/room-designer-system.js";

export interface RoomDesignOptions {
  isStartRoom?: boolean;
  isFinalRoom?: boolean;
}

export async function designRoom(
  room: RoomDefinition,
  scene: string,
  visibleEntities: Array<{ id: string; name: string }>,
  style: RoomStyle,
  availableTileTypes: string[],
  options: RoomDesignOptions = {}
): Promise<RoomLayout> {
  const W = room.width;
  const H = room.height;

  const exits = room.exits
    .map((e) => {
      const locked = e.requires ? " (locked)" : "";
      return `${e.direction} → ${e.to === "exit" ? "level exit" : e.to}${locked}`;
    })
    .join(", ");

  const entities = visibleEntities
    .map((e) => `- ${e.id} (${e.name})`)
    .join("\n");

  const stairsNote = options.isStartRoom
    ? "\nPlace a stairs_up tile near the south wall (ascending staircase from previous level)."
    : options.isFinalRoom
    ? "\nPlace a stairs_down tile near the north wall (descending staircase to next level)."
    : "";

  const userMessage = `Design a ${W}x${H} grid layout for this room:

Room: ${room.name}
Size: ${W} wide × ${H} tall
Scene: ${scene}
Ambience: ${style.ambience}

Exits: ${exits}

Entities to place:
${entities || "(none)"}

Available tile types (use ONLY these): ${availableTileTypes.join(", ")}
${stairsNote}
Remember: the grid must be exactly ${W} columns × ${H} rows. Walls on perimeter. Make the room non-rectangular if possible (carve corners for L/T/cross shapes).`;

  const response = await callAgent(
    ROOM_DESIGNER_SYSTEM,
    [{ role: "user", content: userMessage }],
    undefined,
    undefined,
    2048
  );

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(text) as Omit<RoomLayout, "roomId">;
    if (parsed.cells?.length !== H || parsed.cells[0]?.length !== W) {
      console.warn(`[room-designer] Size mismatch for "${room.name}": expected ${W}x${H}, got ${parsed.cells?.[0]?.length}x${parsed.cells?.length}. Using fallback.`);
      return generateFallbackLayout(room, visibleEntities, options);
    }
    return { ...parsed, roomId: room.id };
  } catch {
    return generateFallbackLayout(room, visibleEntities, options);
  }
}

function generateFallbackLayout(
  room: RoomDefinition,
  entities: Array<{ id: string; name: string }>,
  options: RoomDesignOptions
): RoomLayout {
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

  // Carve corners for non-rectangular shapes (rooms > 5x5)
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

  // Place exits as floor openings (corridors handle connectivity)
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
    // Clear inward path
    const dx = exit.direction === "east" ? -1 : exit.direction === "west" ? 1 : 0;
    const dy = exit.direction === "south" ? -1 : exit.direction === "north" ? 1 : 0;
    for (let step = 1; step <= 2; step++) {
      const px = x + dx * step;
      const py = y + dy * step;
      if (px >= 0 && px < W && py >= 0 && py < H) cells[py][px] = "floor";
    }
    gridExits.push({ x, y, direction: exit.direction, toRoomId: exit.to, locked: false });
  }

  // Place stairs
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

  // Place entities on interior floor tiles
  const gridEntities: RoomLayout["entities"] = [];
  let placed = 0;
  for (const e of entities) {
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

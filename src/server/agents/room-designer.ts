import type { RoomDefinition } from "../models/level.js";
import type { RoomLayout, RoomStyle } from "../../shared/types.js";
import { callAgent } from "../services/llm-client.js";
import { ROOM_DESIGNER_SYSTEM } from "../prompts/room-designer-system.js";

export async function designRoom(
  room: RoomDefinition,
  scene: string,
  visibleEntities: Array<{ id: string; name: string }>,
  style: RoomStyle,
  availableTileTypes: string[]
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

  const userMessage = `Design a ${W}x${H} grid layout for this room:

Room: ${room.name}
Size: ${W} wide × ${H} tall
Scene: ${scene}
Ambience: ${style.ambience}

Exits: ${exits}

Entities to place:
${entities || "(none)"}

Available tile types (use ONLY these): ${availableTileTypes.join(", ")}

Remember: the grid must be exactly ${W} columns × ${H} rows. Walls on perimeter, exits centered on the correct edge.`;

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
    // Validate dimensions match
    if (parsed.cells?.length !== H || parsed.cells[0]?.length !== W) {
      console.warn(`[room-designer] Size mismatch for "${room.name}": expected ${W}x${H}, got ${parsed.cells?.[0]?.length}x${parsed.cells?.length}. Using fallback.`);
      return generateFallbackLayout(room, visibleEntities);
    }
    return { ...parsed, roomId: room.id };
  } catch {
    return generateFallbackLayout(room, visibleEntities);
  }
}

function generateFallbackLayout(
  room: RoomDefinition,
  entities: Array<{ id: string; name: string }>
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

  const gridExits: RoomLayout["exits"] = [];
  for (const exit of room.exits) {
    let x: number, y: number;
    const midX = Math.floor(W / 2);
    const midY = Math.floor(H / 2);
    switch (exit.direction) {
      case "north": x = midX; y = 0; break;
      case "south": x = midX; y = H - 1; break;
      case "east":  x = W - 1; y = midY; break;
      case "west":  x = 0;     y = midY; break;
      default: x = midX; y = 0;
    }
    const locked = !!exit.requires;
    cells[y][x] = locked ? "exit_locked" : "exit";
    gridExits.push({ x, y, direction: exit.direction, toRoomId: exit.to, locked });
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

  // Player start near south or center
  const psX = midX(W);
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

function midX(w: number): number {
  return Math.floor(w / 2);
}

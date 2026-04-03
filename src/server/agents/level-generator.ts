import type { LevelDefinition, RoomDefinition } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { LEVEL_GENERATOR_SYSTEM } from "../prompts/level-generator-system.js";
import { generateBSPLayout, type BSPResult, type BSPPartition } from "../services/bsp-generator.js";
import { buildCorridors, type PlacedRoom, type CorridorResult } from "../services/corridor-builder.js";
import { v4 as uuid } from "uuid";

export interface GeneratedLevel {
  level: LevelDefinition;
  bsp: BSPResult;
  placedRooms: PlacedRoom[];
  corridors: CorridorResult;
}

export async function generateLevel(roomCount: number): Promise<GeneratedLevel> {
  // 1. BSP partitions the space — instant
  const bsp = generateBSPLayout(roomCount);
  console.log(`[level-generator] BSP: ${bsp.partitions.length} partitions in ${bsp.totalWidth}x${bsp.totalHeight}`);

  // 2. Place rooms within partitions — irregular shapes that fill the partition creatively
  const placedRooms: PlacedRoom[] = bsp.partitions.map((p) => placeRoomInPartition(p));

  // 3. Corridor builder connects sibling rooms
  const corridors = buildCorridors(placedRooms, bsp.siblings);
  console.log(`[level-generator] Corridors: ${corridors.segments.length} segments, ${corridors.crossroads.length} crossroads`);

  // 4. Build room adjacency from siblings
  const roomAdj = new Map<string, Set<string>>();
  for (const r of placedRooms) roomAdj.set(r.id, new Set());
  for (const s of bsp.siblings) {
    roomAdj.get(s.leftId)?.add(s.rightId);
    roomAdj.get(s.rightId)?.add(s.leftId);
  }

  // 5. LLM generates creative content
  const roomSummary = placedRooms.map((r) => {
    const neighbors = [...(roomAdj.get(r.id) ?? [])].join(", ");
    return `- ${r.id}: ${r.width}x${r.height}, connects to [${neighbors}]`;
  }).join("\n");

  const userMessage = `Design creative content for a ${roomCount}-room dungeon.

Room layout (from BSP):
${roomSummary}

Start room: ${placedRooms[0].id}. Final room: ${placedRooms[placedRooms.length - 1].id}.

For each room provide: name, description_hint, and puzzle chain.
Items from early rooms should be usable in later rooms.

Respond with valid JSON:
{
  "title": "Level Title",
  "theme": "dungeon/crypt/etc",
  "mood": "mysterious/ominous/etc",
  "rooms": {
    "room_1": { "name": "Room Name", "description_hint": "description", "chain": [...] }
  }
}
Chain: [{ "id": "step_id", "verb": "LOOK|GET|USE|OPEN", "target": "obj_id", "on": "opt", "reveals": ["opt"], "hint": "text" }]`;

  const maxTokens = Math.max(2048, roomCount * 250);
  let title = "The Dungeon";
  let theme = "dungeon";
  let mood = "mysterious";
  const roomContent = new Map<string, { name: string; description_hint: string; chain: RoomDefinition["chain"] }>();

  try {
    const response = await callAgent(LEVEL_GENERATOR_SYSTEM, [{ role: "user", content: userMessage }], undefined, undefined, maxTokens);
    let text = response.text.trim();
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(text);
    title = parsed.title || title;
    theme = parsed.theme || theme;
    mood = parsed.mood || mood;
    for (const [id, content] of Object.entries(parsed.rooms ?? {})) {
      roomContent.set(id, content as { name: string; description_hint: string; chain: RoomDefinition["chain"] });
    }
  } catch (err) {
    console.warn("[level-generator] LLM content failed, using fallbacks:", err);
  }

  // 6. Assemble LevelDefinition
  const rooms: RoomDefinition[] = placedRooms.map((pr, i) => {
    const content = roomContent.get(pr.id);
    const neighbors = [...(roomAdj.get(pr.id) ?? [])];

    const exits: RoomDefinition["exits"] = neighbors.map((nId) => {
      const neighbor = placedRooms.find((r) => r.id === nId)!;
      return { direction: getDirection(pr, neighbor), to: nId };
    });

    const chain = content?.chain ?? [{
      id: `step_${i + 1}`,
      verb: i === 0 ? "LOOK" : "GET",
      target: i === 0 ? "inscription" : `artifact_${i}`,
      reveals: i === 0 ? ["old_key"] : undefined,
      hint: `Something in room ${i + 1}`,
    }];

    if (i === placedRooms.length - 1 && chain.length > 0) {
      exits.push({ direction: "north", to: "exit", requires: chain[chain.length - 1].id });
    }

    return {
      id: pr.id,
      name: content?.name ?? `Chamber ${i + 1}`,
      description_hint: content?.description_hint ?? "A stone chamber",
      width: pr.width,
      height: pr.height,
      exits,
      chain,
    };
  });

  const level: LevelDefinition = {
    id: `level_${uuid().slice(0, 8)}`,
    title, theme, mood,
    start_room: placedRooms[0].id,
    rooms,
  };

  return { level, bsp, placedRooms, corridors };
}

// Place a room inside a BSP partition — not necessarily rectangular.
// Room fills most of the partition with 1-cell padding, but with random shrinkage on each side.
function placeRoomInPartition(p: BSPPartition): PlacedRoom {
  const pad = 1;
  const maxW = p.w - pad * 2;
  const maxH = p.h - pad * 2;

  // Random shrinkage: 0-30% off each dimension
  const shrinkW = Math.floor(Math.random() * maxW * 0.3);
  const shrinkH = Math.floor(Math.random() * maxH * 0.3);
  const w = Math.max(3, maxW - shrinkW);
  const h = Math.max(3, maxH - shrinkH);

  // Random offset within remaining space
  const offsetX = Math.floor(Math.random() * (maxW - w + 1));
  const offsetY = Math.floor(Math.random() * (maxH - h + 1));

  return {
    id: p.id,
    x: p.x + pad + offsetX,
    y: p.y + pad + offsetY,
    width: w,
    height: h,
  };
}

function getDirection(from: PlacedRoom, to: PlacedRoom): string {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

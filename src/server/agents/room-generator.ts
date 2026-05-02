import type { LevelDefinition, RoomDefinition } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { ROOM_GENERATOR_SYSTEM } from "../prompts/room-generator-system.js";

export interface RoomData {
  scene: string;
  entities: Array<{
    id: string;
    name: string;
    description: string;
    portable: boolean;
  }>;
}

export interface RoomGeneratorOutput {
  rooms: Record<string, RoomData>;
}

// Build entities deterministically from a room's puzzle chain. Mirrors the old
// fallback path in this file: each chain step's target becomes an entity, each
// step's `on` becomes an entity if not already covered, and `verb === GET`
// marks portability.
export function deriveRoomFromChain(room: RoomDefinition): RoomData {
  const entities: RoomData["entities"] = [];
  const seen = new Set<string>();

  const add = (id: string, hint: string, portable: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    entities.push({
      id,
      name: id.replace(/_/g, " "),
      description: hint || id.replace(/_/g, " "),
      portable,
    });
  };

  for (const step of room.chain) {
    add(step.target, step.hint, step.verb.toUpperCase() === "GET");
    if (step.on) {
      const onHint = room.chain.find((s) => s.target === step.on)?.hint ?? "";
      add(step.on, onHint, false);
    }
    if (step.reveals) {
      for (const id of step.reveals) {
        const hint = room.chain.find((s) => s.target === id)?.hint ?? "";
        add(id, hint, false);
      }
    }
  }

  return {
    scene: room.description_hint
      ? `You find yourself in ${room.name}. ${room.description_hint}.`
      : `You stand in ${room.name}.`,
    entities,
  };
}

// LLM call for ONE room's scene + entities. Much smaller and faster than
// generating all rooms in one shot.
export async function generateStartRoomScene(
  room: RoomDefinition,
  level: LevelDefinition
): Promise<RoomData> {
  const exits = room.exits
    .map((e) => `${e.direction} → ${e.to === "exit" ? "level exit" : e.to}${e.requires ? ` (locked until "${e.requires}")` : ""}`)
    .join(", ");

  const chain = room.chain
    .map((step, i) => {
      let line = `${i + 1}. ${step.verb} ${step.target.replace(/_/g, " ")}`;
      if (step.on) line += ` on ${step.on.replace(/_/g, " ")}`;
      if (step.reveals) line += ` (reveals: ${step.reveals.map((r) => r.replace(/_/g, " ")).join(", ")})`;
      line += ` — ${step.hint}`;
      return line;
    })
    .join("\n  ");

  const userMessage = `Generate the scene + entities for the START room of this level.

Title: ${level.title}
Theme: ${level.theme}
Mood: ${level.mood}

Room: ${room.name} (id: ${room.id})
Hint: ${room.description_hint}
Exits: ${exits}
Puzzle chain:
  ${chain}

Output JSON ONLY for this single room:
{
  "rooms": {
    "${room.id}": {
      "scene": "...",
      "entities": [{ "id": "...", "name": "...", "description": "...", "portable": false }]
    }
  }
}`;

  const response = await callAgent(
    "room-generator(start)",
    ROOM_GENERATOR_SYSTEM,
    [{ role: "user", content: userMessage }],
    undefined,
    undefined,
    1024
  );

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(text) as RoomGeneratorOutput;
    const data = parsed.rooms[room.id];
    if (data) return data;
  } catch {
    // fall through to derivation
  }
  return deriveRoomFromChain(room);
}

// Build a full RoomGeneratorOutput where the start room is LLM-generated and
// the rest are derived deterministically from chain data.
export async function generateRoomsForLevel(level: LevelDefinition): Promise<RoomGeneratorOutput> {
  const rooms: RoomGeneratorOutput["rooms"] = {};
  const startRoom = level.rooms.find((r) => r.id === level.start_room)!;

  rooms[startRoom.id] = await generateStartRoomScene(startRoom, level);

  for (const r of level.rooms) {
    if (r.id === startRoom.id) continue;
    rooms[r.id] = deriveRoomFromChain(r);
  }

  return { rooms };
}

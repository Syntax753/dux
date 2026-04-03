import type { LevelDefinition } from "../models/level.js";
import type { LevelSpatialMap } from "../../shared/types.js";
import { callAgent } from "../services/llm-client.js";
import { LEVEL_ARCHITECT_SYSTEM } from "../prompts/level-architect-system.js";

export async function planSpatialLayout(
  level: LevelDefinition
): Promise<LevelSpatialMap> {
  const roomDescs = level.rooms
    .map((r) => {
      const exits = r.exits
        .map((e) => `${e.direction} → ${e.to}`)
        .join(", ");
      return `- ${r.id} (${r.name}): exits [${exits}]`;
    })
    .join("\n");

  const userMessage = `Plan the spatial layout for this level:

Title: ${level.title}
Start room: ${level.start_room}
Rooms:
${roomDescs}`;

  const response = await callAgent(LEVEL_ARCHITECT_SYSTEM, [
    { role: "user", content: userMessage },
  ]);

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return JSON.parse(text) as LevelSpatialMap;
  } catch {
    // Deterministic fallback: place rooms linearly
    const rooms = level.rooms.map((r, i) => ({
      roomId: r.id,
      gridX: i,
      gridY: 0,
    }));
    const connections: LevelSpatialMap["connections"] = [];
    for (const room of level.rooms) {
      for (const exit of room.exits) {
        if (exit.to !== "exit") {
          connections.push({
            fromRoomId: room.id,
            toRoomId: exit.to,
            direction: exit.direction,
          });
        }
      }
    }
    return { rooms, connections };
  }
}

import type { LevelDefinition } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { ROOM_GENERATOR_SYSTEM } from "../prompts/room-generator-system.js";
import { agentLog, type AgentContext } from "../services/agent-logger.js";

export interface RoomGeneratorOutput {
  rooms: Record<
    string,
    {
      scene: string;
      entities: Array<{
        id: string;
        name: string;
        description: string;
        portable: boolean;
      }>;
    }
  >;
}

export async function generateRooms(
  level: LevelDefinition,
  ctx?: AgentContext
): Promise<RoomGeneratorOutput> {
  const logCtx = ctx ?? agentLog.fromSpan("?", "?", "room-generator", "generateRooms");
  agentLog.start(logCtx, ["llm/claude-sonnet"], `Generating scenes + entities for ${level.rooms.length} rooms`);
  const roomDescriptions = level.rooms
    .map((room) => {
      const exits = room.exits
        .map((e) => {
          let desc = `${e.direction} → ${e.to === "exit" ? "level exit" : e.to}`;
          if (e.requires) desc += ` (locked until step "${e.requires}")`;
          return desc;
        })
        .join(", ");

      const chain = room.chain
        .map((step, i) => {
          let desc = `${i + 1}. ${step.verb} ${step.target.replace(/_/g, " ")}`;
          if (step.on) desc += ` on ${step.on.replace(/_/g, " ")}`;
          if (step.reveals)
            desc += ` (reveals: ${step.reveals.map((r) => r.replace(/_/g, " ")).join(", ")})`;
          desc += ` — ${step.hint}`;
          return desc;
        })
        .join("\n    ");

      return `Room: ${room.name} (id: ${room.id})
  Hint: ${room.description_hint}
  Exits: ${exits}
  Puzzle chain:
    ${chain}`;
    })
    .join("\n\n");

  const userMessage = `Generate scenes and entities for this multi-room level:

Title: ${level.title}
Theme: ${level.theme}
Mood: ${level.mood}
Rooms: ${level.rooms.length}

${roomDescriptions}

Remember: hidden objects (those in "reveals") should be hinted at but not explicitly described. Visible objects should be clearly present. Exits should be referenced naturally in each scene.`;

  const response = await callAgent("room-generator", ROOM_GENERATOR_SYSTEM, [
    { role: "user", content: userMessage },
  ]);

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return JSON.parse(text) as RoomGeneratorOutput;
  } catch {
    // Fallback: generate basic descriptions from room hints
    const rooms: RoomGeneratorOutput["rooms"] = {};
    for (const room of level.rooms) {
      const entities: RoomGeneratorOutput["rooms"][string]["entities"] = [];
      for (const step of room.chain) {
        entities.push({
          id: step.target,
          name: step.target.replace(/_/g, " "),
          description: step.hint,
          portable: step.verb.toUpperCase() === "GET",
        });
        if (step.on) {
          entities.push({
            id: step.on,
            name: step.on.replace(/_/g, " "),
            description:
              room.chain.find((s) => s.target === step.on)?.hint ||
              step.on.replace(/_/g, " "),
            portable: false,
          });
        }
      }
      rooms[room.id] = {
        scene: `You find yourself in ${room.name}. ${room.description_hint}.`,
        entities,
      };
    }
    return { rooms };
  }
}

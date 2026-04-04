import type { RoomStyle } from "../../shared/types.js";
import type { LevelDefinition } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { STYLE_AGENT_SYSTEM } from "../prompts/style-agent-system.js";
import { agentLog, type AgentContext } from "../services/agent-logger.js";

export async function generateLevelStyle(
  level: LevelDefinition
): Promise<RoomStyle> {
  const roomSummary = level.rooms
    .map((r) => `- ${r.name}: ${r.description_hint}`)
    .join("\n");

  const userMessage = `Generate a unified color palette for this dungeon level:

Title: ${level.title}
Theme: ${level.theme}
Mood: ${level.mood}

Rooms:
${roomSummary}

This palette will be used for ALL rooms in the level — tiles should look consistent throughout.`;

  const response = await callAgent(STYLE_AGENT_SYSTEM, [
    { role: "user", content: userMessage },
  ]);

  try {
    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return JSON.parse(text) as RoomStyle;
  } catch {
    return {
      palette: {
        wall: "#2a2a3a",
        floor: "#1a1a2e",
        accent: "#d4a574",
        highlight: "#8b6914",
        shadow: "#0a0a14",
      },
      ambience: "dark",
    };
  }
}

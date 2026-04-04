import type { NarrationEvent } from "../../shared/types.js";
import { callAgent } from "../services/llm-client.js";
import { NARRATOR_SYSTEM } from "../prompts/narrator-system.js";
import { agentLog, type AgentContext } from "../services/agent-logger.js";

interface NarratorContext {
  roomName: string;
  theme: string;
  mood: string;
  scene: string;
  inventory: string[];
}

export async function narrate(
  event: NarrationEvent,
  context: NarratorContext
): Promise<string> {
  let eventDesc: string;

  switch (event.type) {
    case "enter_room":
      eventDesc = event.firstVisit
        ? `The player enters ${context.roomName} for the first time.`
        : `The player returns to ${context.roomName}.`;
      break;
    case "interact":
      eventDesc = `The player ${event.action}s the ${event.entityId.replace(/_/g, " ")}. Result: ${event.result}`;
      break;
    case "pickup":
      eventDesc = `The player picks up the ${event.entityId.replace(/_/g, " ")}.`;
      break;
    case "puzzle_advance":
      eventDesc = `A puzzle step is completed: ${event.hint}`;
      break;
    case "hint":
      eventDesc = `The player seems stuck. Context: ${event.context}`;
      break;
    case "level_complete":
      eventDesc = "The player has completed the level!";
      break;
    case "exit_blocked":
      eventDesc = `The player tries to go ${event.direction} but the way is blocked.`;
      break;
  }

  const userMessage = `Room: ${context.roomName}
Theme: ${context.theme}
Mood: ${context.mood}
Scene: ${context.scene}
Inventory: ${context.inventory.length > 0 ? context.inventory.join(", ") : "empty"}

Event: ${eventDesc}`;

  const response = await callAgent(NARRATOR_SYSTEM, [
    { role: "user", content: userMessage },
  ]);

  return response.text.trim();
}

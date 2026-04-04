import type { LevelDefinition } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { QUEST_AGENT_SYSTEM } from "../prompts/quest-agent-system.js";

export interface QuestStep {
  id: string;
  roomId: string;
  action: "visit" | "pickup" | "use" | "interact";
  target: string | null;
  description: string;
}

export interface QuestReward {
  type: "narrative" | "item" | "shortcut";
  description: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  type: "fetch" | "explore" | "solve" | "survive" | "collect";
  isMain: boolean;
  steps: QuestStep[];
  reward: QuestReward;
  completed: boolean;
  currentStep: number;
}

export async function generateQuests(level: LevelDefinition): Promise<Quest[]> {
  const roomSummary = level.rooms.map((r) => {
    const chainItems = r.chain.map((s) => `${s.verb} ${s.target}`).join(", ");
    const exits = r.exits.map((e) => `${e.direction}→${e.to}`).join(", ");
    return `- ${r.id} "${r.name}" (${r.width}x${r.height}): chain=[${chainItems}] exits=[${exits}]`;
  }).join("\n");

  const userMessage = `Design quests for this ${level.rooms.length}-room dungeon:

Title: ${level.title}
Theme: ${level.theme}
Mood: ${level.mood}
Start room: ${level.start_room}

Rooms:
${roomSummary}

Generate 1 main quest + ${Math.min(3, Math.max(1, level.rooms.length - 2))} side quest(s).`;

  try {
    const response = await callAgent(
      QUEST_AGENT_SYSTEM,
      [{ role: "user", content: userMessage }],
      undefined,
      undefined,
      2048
    );

    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(text) as { quests: Omit<Quest, "completed" | "currentStep">[] };
    return parsed.quests.map((q) => ({
      ...q,
      completed: false,
      currentStep: 0,
    }));
  } catch (err) {
    console.warn("[quest-agent] Failed to generate quests, using fallback:", err);
    return generateFallbackQuests(level);
  }
}

function generateFallbackQuests(level: LevelDefinition): Quest[] {
  const lastRoom = level.rooms[level.rooms.length - 1];
  return [
    {
      id: "main_quest",
      title: "Escape the Dungeon",
      description: `Find your way through all ${level.rooms.length} rooms and reach the exit.`,
      type: "explore",
      isMain: true,
      steps: level.rooms.map((r, i) => ({
        id: `mq_step_${i}`,
        roomId: r.id,
        action: "visit" as const,
        target: null,
        description: `Explore ${r.name}`,
      })),
      reward: { type: "narrative", description: "You find the way out." },
      completed: false,
      currentStep: 0,
    },
  ];
}

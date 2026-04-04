import type { LevelDefinition, RoomDefinition, RoomCategory } from "../models/level.js";
import { callAgent } from "../services/llm-client.js";
import { LEVEL_GENERATOR_SYSTEM } from "../prompts/level-generator-system.js";
import { generateBSPLayout } from "../services/bsp-generator.js";
import { buildDungeonGraph, type DungeonGraph } from "../services/dungeon-graph.js";
import { v4 as uuid } from "uuid";
import { broadcastSSE } from "../services/tracer.js";

export interface GeneratedLevel {
  level: LevelDefinition;
  graph: DungeonGraph;
}

export async function generateLevel(roomCount: number): Promise<GeneratedLevel> {
  // 1. BSP partitions the space
  const bsp = generateBSPLayout(roomCount);
  console.log(`[level-generator] BSP: ${bsp.partitions.length} partitions in ${bsp.totalWidth}x${bsp.totalHeight}`);

  // 2. Dungeon graph: places rooms, builds MST + extra edges, computes corridors, validates connectivity
  const graph = buildDungeonGraph(bsp.partitions, bsp.totalWidth, bsp.totalHeight);

  // 3. Build adjacency for the level definition
  const roomAdj = new Map<string, Set<string>>();
  for (const r of graph.rooms) roomAdj.set(r.id, new Set());
  for (const e of graph.edges) {
    roomAdj.get(e.fromId)?.add(e.toId);
    roomAdj.get(e.toId)?.add(e.fromId);
  }

  // 4. LLM generates creative content
  const roomSummary = graph.rooms.map((r) => {
    const neighbors = [...(roomAdj.get(r.id) ?? [])].join(", ");
    return `- ${r.id}: ${r.width}x${r.height}, connects to [${neighbors}]`;
  }).join("\n");

  const userMessage = `Design creative content for a ${roomCount}-room dungeon.

Room layout:
${roomSummary}

Start room: ${graph.rooms[0].id}. Final room: ${graph.rooms[graph.rooms.length - 1].id}.

For each room provide: name, description_hint, and puzzle chain.

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

  // 5. Assemble LevelDefinition
  const rooms: RoomDefinition[] = graph.rooms.map((gr, i) => {
    const content = roomContent.get(gr.id);
    const neighbors = [...(roomAdj.get(gr.id) ?? [])];

    const exits: RoomDefinition["exits"] = neighbors.map((nId) => {
      const neighbor = graph.rooms.find((r) => r.id === nId)!;
      return { direction: getDirection(gr, neighbor), to: nId };
    });

    const chain = content?.chain ?? [{
      id: `step_${i + 1}`,
      verb: i === 0 ? "LOOK" : "GET",
      target: i === 0 ? "inscription" : `artifact_${i}`,
      reveals: i === 0 ? ["old_key"] : undefined,
      hint: `Something in room ${i + 1}`,
    }];

    if (i === graph.rooms.length - 1 && chain.length > 0) {
      exits.push({ direction: "north", to: "exit", requires: chain[chain.length - 1].id });
    }

    const category = assignRoomCategory();

    return {
      id: gr.id,
      name: content?.name ?? `Chamber ${i + 1}`,
      description_hint: content?.description_hint ?? "A stone chamber",
      category,
      width: gr.width,
      height: gr.height,
      exits,
      chain,
    };
  });

  const level: LevelDefinition = {
    id: `level_${uuid().slice(0, 8)}`,
    title, theme, mood,
    start_room: graph.rooms[0].id,
    rooms,
  };

  // Log room category breakdown
  const catCounts: Record<string, number> = {};
  for (const r of rooms) {
    catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
  }
  const breakdown = Object.entries(catCounts).map(([cat, n]) => `${cat}:${n}`).join(", ");
  console.log(`[level-generator] Room categories: ${breakdown} | Theme: ${theme} | Mood: ${mood}`);
  for (const r of rooms) {
    console.log(`[level-generator]   ${r.id} "${r.name}" — ${r.category} (${r.width}x${r.height})`);
  }
  broadcastSSE("level-rooms", {
    theme, mood,
    categories: catCounts,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, category: r.category, size: `${r.width}x${r.height}` })),
  });

  return { level, graph };
}

// Room category probabilities: 75% cell, 20% open-air, 5% shrine
function assignRoomCategory(): RoomCategory {
  const roll = Math.random();
  if (roll < 0.75) return "cell";
  if (roll < 0.95) return "open-air";
  return "shrine";
}

function getDirection(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number; height: number }): string {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

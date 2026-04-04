// Game Agent: top-level orchestrator that coordinates all sub-agents.
// Uses Claude's tool-use to decide which agents to call and in what order.

import type { LevelDefinition } from "../models/level.js";
import type { GameState } from "../models/game-state.js";
import type { RoomStyle, TileSet, ClientRoomData } from "../../shared/types.js";
import { callAgent, runAgentLoop, type Tool } from "../services/llm-client.js";
import { GAME_AGENT_SYSTEM } from "../prompts/game-agent-system.js";
import { generateLevel, type GeneratedLevel } from "./level-generator.js";
import { generateRooms, type RoomGeneratorOutput } from "./room-generator.js";
import { generateLevelStyle } from "./style-agent.js";
import { generateLevelTiles } from "./tile-artist.js";
import { designRoom, type RoomDesignOptions } from "./room-designer.js";
import { generateQuests, type Quest } from "./quest-agent.js";
import { narrate } from "./narrator.js";
import { createGameState, populateEntities } from "../models/game-state.js";
import { setSession } from "../services/session-store.js";
import { Tracer } from "../services/tracer.js";
import { agentLog } from "../services/agent-logger.js";
import { v4 as uuid } from "uuid";

// Tool definitions for the game agent
const gameTools: Tool[] = [
  {
    name: "generate_level",
    description: "Generate the dungeon structure with rooms, corridors, theme, and puzzles. Must be called first.",
    input_schema: {
      type: "object" as const,
      properties: {
        roomCount: { type: "number", description: "Number of rooms to generate" },
        reasoning: { type: "string", description: "Why you're generating this level" },
      },
      required: ["roomCount", "reasoning"],
    },
  },
  {
    name: "generate_room_scenes",
    description: "Generate scene descriptions and entity lists for all rooms. Needs level definition.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Why scenes are needed now" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "generate_style",
    description: "Generate unified color palette for the level. Needs level definition.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Why style is needed now" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "generate_quests",
    description: "Generate quests spanning multiple rooms. Needs level definition.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Why quests are needed now" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "design_start_room",
    description: "Design the grid layout for the start room. Needs scenes + style + tiles.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Why designing start room now" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "narrate_entrance",
    description: "Generate atmospheric entrance narrative for the start room.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Why narrating now" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "finalize",
    description: "All required steps complete. Finalize the game state and return to the player.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Summary of what was generated" },
      },
      required: ["summary"],
    },
  },
];

export interface GameAgentResult {
  state: GameState;
  narrative: string;
  trace: ReturnType<Tracer["finish"]>;
}

export async function runGameAgent(roomCount: number): Promise<GameAgentResult> {
  const tracer = new Tracer("game-agent", `Orchestrating ${roomCount}-room dungeon`, "server");
  const ctx = tracer.rootContext;
  agentLog.start(ctx, [
    "generate_level", "generate_room_scenes", "generate_style",
    "generate_tiles", "design_room", "generate_quests", "narrate",
  ], `Player requested ${roomCount} rooms. Orchestrating full pipeline.`);

  // State accumulated across tool calls
  let level: LevelDefinition | null = null;
  let generatedLevel: GeneratedLevel | null = null;
  let generated: RoomGeneratorOutput | null = null;
  let levelStyle: RoomStyle | null = null;
  let levelTileSet: TileSet | null = null;
  let quests: Quest[] = [];
  let narrative = "";
  let state: GameState | null = null;

  // Parallel task tracking
  let scenesPromise: Promise<RoomGeneratorOutput> | null = null;
  let stylePromise: Promise<RoomStyle> | null = null;
  let questsPromise: Promise<Quest[]> | null = null;

  // Tool execution function
  const executeTool = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    const reasoning = (input.reasoning as string) || "";

    switch (name) {
      case "generate_level": {
        const span = tracer.startSpan("level-generator", `Generate ${roomCount}-room level`, tracer.rootId, reasoning);
        agentLog.call(ctx, "level-generator", reasoning);
        const result = await generateLevel(roomCount, tracer.contextFor(span));
        level = result.level;
        generatedLevel = result;
        tracer.endSpan(span.id, { title: level.title, rooms: level.rooms.length, theme: level.theme });
        agentLog.result(ctx, "level-generator", `"${level.title}" — ${level.rooms.length} rooms, theme: ${level.theme}`);

        // Kick off parallel tasks immediately
        const sceneSpan = tracer.startSpan("room-generator", `Scenes for ${level.rooms.length} rooms`, tracer.rootId, "Parallel: scenes needed for room design");
        scenesPromise = generateRooms(level).then((r) => { tracer.endSpan(sceneSpan.id, { rooms: Object.keys(r.rooms).length }); return r; });

        const styleSpan = tracer.startSpan("style-agent", `Palette for "${level.title}"`, tracer.rootId, "Parallel: style needed for tiles");
        stylePromise = generateLevelStyle(level).then((s) => { tracer.endSpan(styleSpan.id, s); return s; });

        const questSpan = tracer.startSpan("quest-agent", `Quests for "${level.title}"`, tracer.rootId, "Parallel: quests for player objectives");
        questsPromise = generateQuests(level).then((q) => { tracer.endSpan(questSpan.id, { count: q.length }); return q; });

        return { success: true, title: level.title, rooms: level.rooms.length, theme: level.theme, mood: level.mood, parallelStarted: ["scenes", "style", "quests"] };
      }

      case "generate_room_scenes": {
        agentLog.call(ctx, "room-generator", reasoning);
        if (scenesPromise) {
          generated = await scenesPromise;
        } else if (level) {
          const span = tracer.startSpan("room-generator", "Scenes", tracer.rootId, reasoning);
          generated = await generateRooms(level);
          tracer.endSpan(span.id);
        }
        agentLog.result(ctx, "room-generator", `${Object.keys(generated?.rooms ?? {}).length} rooms with scenes`);
        return { success: true, roomCount: Object.keys(generated?.rooms ?? {}).length };
      }

      case "generate_style": {
        agentLog.call(ctx, "style-agent", reasoning);
        if (stylePromise) {
          levelStyle = await stylePromise;
        } else if (level) {
          const span = tracer.startSpan("style-agent", "Palette", tracer.rootId, reasoning);
          levelStyle = await generateLevelStyle(level);
          tracer.endSpan(span.id, levelStyle);
        }
        // Generate tiles immediately (instant)
        if (levelStyle) {
          const tileSpan = tracer.startSpan("tile-artist", "Tileset", tracer.rootId, "Programmatic tiles from palette");
          levelTileSet = generateLevelTiles(levelStyle);
          tracer.endSpan(tileSpan.id, { types: Object.keys(levelTileSet) });
        }
        agentLog.result(ctx, "style-agent + tile-artist", `Palette + ${Object.keys(levelTileSet ?? {}).length} tile types`);
        return { success: true, ambience: levelStyle?.ambience, tileTypes: Object.keys(levelTileSet ?? {}) };
      }

      case "generate_quests": {
        agentLog.call(ctx, "quest-agent", reasoning);
        if (questsPromise) {
          quests = await questsPromise;
        } else if (level) {
          const span = tracer.startSpan("quest-agent", "Quests", tracer.rootId, reasoning);
          quests = await generateQuests(level);
          tracer.endSpan(span.id, { count: quests.length });
        }
        agentLog.result(ctx, "quest-agent", `${quests.length} quests generated`);
        return { success: true, questCount: quests.length };
      }

      case "design_start_room": {
        if (!level || !generated || !levelStyle || !levelTileSet) {
          return { success: false, error: "Missing dependencies: need level, scenes, style, and tiles first" };
        }

        // Ensure scenes/style/quests are resolved
        if (scenesPromise && !generated) generated = await scenesPromise;
        if (stylePromise && !levelStyle) levelStyle = await stylePromise;
        if (questsPromise && !quests.length) quests = await questsPromise;

        // Create game state
        const sessionId = uuid();
        state = createGameState(sessionId, level);
        state.levelStyle = levelStyle;
        state.levelTileSet = levelTileSet;
        state.quests = quests;

        // Store scenes
        for (const room of level.rooms) {
          const data = generated.rooms[room.id];
          if (data) state.rooms.get(room.id)!.scene = data.scene;
        }

        // Build spatial map
        if (generatedLevel?.graph) {
          const g = generatedLevel.graph;
          state.spatialMap = {
            rooms: g.rooms.map((r) => ({ roomId: r.id, gridX: r.x, gridY: r.y })),
            connections: g.edges.map((e) => {
              const from = g.rooms.find((r) => r.id === e.fromId)!;
              const to = g.rooms.find((r) => r.id === e.toId)!;
              const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
              const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
              const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "east" : "west") : (dy > 0 ? "south" : "north");
              return { fromRoomId: e.fromId, toRoomId: e.toId, direction };
            }),
            corridorSegments: g.edges.flatMap((e) => {
              const segs: Array<{ x1: number; y1: number; x2: number; y2: number; type: "horizontal" | "vertical" }> = [];
              for (let i = 0; i < e.waypoints.length - 1; i++) {
                const a = e.waypoints[i], b = e.waypoints[i + 1];
                if (a.y === b.y) segs.push({ x1: Math.min(a.x, b.x), y1: a.y, x2: Math.max(a.x, b.x), y2: a.y, type: "horizontal" });
                else segs.push({ x1: a.x, y1: Math.min(a.y, b.y), x2: a.x, y2: Math.max(a.y, b.y), type: "vertical" });
              }
              return segs;
            }),
          };
        }

        // Design start room
        const startRoom = level.rooms.find((r) => r.id === level!.start_room)!;
        const roomData = generated.rooms[startRoom.id];
        const availableTiles = Object.keys(levelTileSet);

        agentLog.call(ctx, "room-designer", `${reasoning} — ${startRoom.width}x${startRoom.height} ${startRoom.category} room`);
        const span = tracer.startSpan("room-designer", `Start room "${startRoom.name}"`, tracer.rootId, reasoning);
        const layout = await designRoom(startRoom, roomData?.scene ?? "", roomData?.entities ?? [], levelStyle, availableTiles, { isStartRoom: true });
        state.roomLayouts.set(startRoom.id, layout);
        tracer.endSpan(span.id, { width: layout.width, height: layout.height });
        agentLog.result(ctx, "room-designer", `${layout.width}x${layout.height} grid, ${layout.entities.length} entities`);

        // Populate entities
        const entityMap: Record<string, Array<{ id: string; name: string; description: string; portable: boolean }>> = {};
        for (const [roomId, rd] of Object.entries(generated.rooms)) entityMap[roomId] = rd.entities;
        populateEntities(state, entityMap);

        // Background: design other rooms
        const otherRooms = level.rooms.filter((r) => r.id !== level!.start_room);
        for (const room of otherRooms) {
          const bgTracer = new Tracer("background-room", `Layout for "${room.name}"`, "server", tracer.traceId);
          const rd = generated.rooms[room.id];
          const isFinal = room.id === level!.rooms[level!.rooms.length - 1].id;
          const promise = designRoom(room, rd?.scene ?? "", rd?.entities ?? [], levelStyle!, availableTiles, { isFinalRoom: isFinal })
            .then((l) => { state!.roomLayouts.set(room.id, l); setSession(state!); console.log(`[background] ✓ "${room.name}" ready`); })
            .catch((err) => console.error(`[background] ✗ "${room.name}":`, err));
          state.pendingRooms.set(room.id, promise);
        }

        setSession(state);
        return { success: true, startRoom: startRoom.name, backgroundRooms: otherRooms.length };
      }

      case "narrate_entrance": {
        if (!level || !generated) return { success: false, error: "Need level and scenes first" };
        const startRoom = level.rooms.find((r) => r.id === level!.start_room)!;
        const scene = generated.rooms[startRoom.id]?.scene ?? "";

        agentLog.call(ctx, "narrator", reasoning);
        const span = tracer.startSpan("narrator", `Entrance for "${startRoom.name}"`, tracer.rootId, reasoning);
        narrative = await narrate(
          { type: "enter_room", roomId: startRoom.id, firstVisit: true },
          { roomName: startRoom.name, theme: level.theme, mood: level.mood, scene, inventory: [] }
        );
        tracer.endSpan(span.id, { length: narrative.length });
        agentLog.result(ctx, "narrator", `${narrative.length} chars`);
        return { success: true, narrativeLength: narrative.length };
      }

      case "finalize": {
        agentLog.done(ctx, input.summary as string, Date.now() - tracer.rootContext.traceId.length); // placeholder
        return { success: true, ready: true };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  };

  // Run the agent loop — Claude decides what to call and when
  const userMessage = `A player wants to start a new dungeon with ${roomCount} rooms. Orchestrate the generation pipeline. Call generate_level first, then coordinate the remaining agents efficiently. When everything is ready, call finalize.`;

  await runAgentLoop(
    GAME_AGENT_SYSTEM,
    [{ role: "user", content: userMessage }],
    gameTools,
    executeTool
  );

  if (!state || !level) {
    throw new Error("Game agent failed to generate the game state");
  }

  const finalLevel = level as LevelDefinition;
  const finalState = state as GameState;
  agentLog.done(ctx, `"${finalLevel.title}" — ${finalLevel.rooms.length} rooms, ${quests.length} quests`, Date.now() - tracer.rootContext.traceId.length);

  return { state: finalState, narrative, trace: tracer.finish() };
}

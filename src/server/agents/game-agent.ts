// Game Agent: top-level orchestrator that coordinates all sub-agents.
// Dependency graph between sub-agents is fixed (level → scenes/style/quests → start room layout → narration),
// so we orchestrate explicitly. This works under any VITE_AI_MODE (live/mock/api) without depending on tool-use.

import type { LevelDefinition } from "../models/level.js";
import type { GameState } from "../models/game-state.js";
import type { RoomStyle, TileSet } from "../../shared/types.js";
import { generateLevel, type GeneratedLevel } from "./level-generator.js";
import { generateRooms, type RoomGeneratorOutput } from "./room-generator.js";
import { generateLevelStyle } from "./style-agent.js";
import { generateLevelTiles } from "./tile-artist.js";
import { designRoom } from "./room-designer.js";
import { generateQuests, type Quest } from "./quest-agent.js";
import { narrate } from "./narrator.js";
import { createGameState, populateEntities } from "../models/game-state.js";
import { setSession } from "../services/session-store.js";
import { Tracer } from "../services/tracer.js";
import { agentLog } from "../services/agent-logger.js";
import { v4 as uuid } from "uuid";

export interface GameAgentResult {
  state: GameState;
  narrative: string;
  trace: ReturnType<Tracer["finish"]>;
}

export async function runGameAgent(roomCount: number): Promise<GameAgentResult> {
  const tracer = new Tracer("game-agent", `Orchestrating ${roomCount}-room dungeon`, "server");
  const ctx = tracer.rootContext;
  const startedAt = Date.now();
  agentLog.start(ctx, [
    "level-generator", "room-generator", "style-agent", "tile-artist",
    "quest-agent", "room-designer", "narrator",
  ], `Player requested ${roomCount} rooms. Orchestrating full pipeline.`);

  // --- Phase 1: build the dungeon skeleton ---
  const levelSpan = tracer.startSpan("level-generator", `Generate ${roomCount}-room level`, tracer.rootId, `Player requested ${roomCount} rooms. Producing BSP layout, dungeon graph, and creative content.`);
  agentLog.call(ctx, "level-generator", `Generating ${roomCount}-room dungeon`);
  const generatedLevel: GeneratedLevel = await generateLevel(roomCount, tracer.contextFor(levelSpan));
  const level: LevelDefinition = generatedLevel.level;
  tracer.endSpan(levelSpan.id, { title: level.title, rooms: level.rooms.length, theme: level.theme });
  agentLog.result(ctx, "level-generator", `"${level.title}" — ${level.rooms.length} rooms, theme: ${level.theme}`);

  // --- Phase 2: scenes, style+tiles, and quests in parallel ---
  // All three only need the level definition. tile-artist runs as soon as style resolves.
  const phase2Span = tracer.startSpan("phase-2", "Parallel: scenes + style/tiles + quests", tracer.rootId, "Three independent agents — all need only the level definition.");

  const scenesPromise: Promise<RoomGeneratorOutput> = (async () => {
    const span = tracer.startSpan("room-generator", `Scenes for ${level.rooms.length} rooms`, phase2Span.id, "Generating scene text + entity lists for every room.");
    agentLog.call(ctx, "room-generator", `Scenes for ${level.rooms.length} rooms`);
    const result = await generateRooms(level);
    tracer.endSpan(span.id, { rooms: Object.keys(result.rooms).length });
    agentLog.result(ctx, "room-generator", `${Object.keys(result.rooms).length} rooms with scenes`);
    return result;
  })();

  const stylePromise: Promise<{ style: RoomStyle; tileSet: TileSet }> = (async () => {
    const span = tracer.startSpan("style-agent", `Palette for "${level.title}"`, phase2Span.id, `Theme: "${level.theme}", mood: "${level.mood}". Producing the unified palette.`);
    agentLog.call(ctx, "style-agent", `Palette for "${level.title}"`);
    const style = await generateLevelStyle(level);
    tracer.endSpan(span.id, style);

    const tileSpan = tracer.startSpan("tile-artist", "Tileset", phase2Span.id, "Programmatic 8x8 patterns from the palette — no LLM call.");
    const tileSet = generateLevelTiles(style);
    tracer.endSpan(tileSpan.id, { types: Object.keys(tileSet) });
    agentLog.result(ctx, "style-agent + tile-artist", `Palette + ${Object.keys(tileSet).length} tile types`);

    return { style, tileSet };
  })();

  const questsPromise: Promise<Quest[]> = (async () => {
    const span = tracer.startSpan("quest-agent", `Quests for "${level.title}"`, phase2Span.id, "Main + side quests spanning multiple rooms to encourage exploration.");
    agentLog.call(ctx, "quest-agent", `Quests for "${level.title}"`);
    const result = await generateQuests(level);
    tracer.endSpan(span.id, { count: result.length });
    agentLog.result(ctx, "quest-agent", `${result.length} quests generated`);
    return result;
  })();

  const [generated, { style: levelStyle, tileSet: levelTileSet }, quests] = await Promise.all([
    scenesPromise,
    stylePromise,
    questsPromise,
  ]);
  tracer.endSpan(phase2Span.id);

  // --- Phase 3: build state, design start room layout, narrate entrance (last two parallel) ---
  const sessionId = uuid();
  const state = createGameState(sessionId, level);
  state.levelStyle = levelStyle;
  state.levelTileSet = levelTileSet;
  state.quests = quests;

  for (const room of level.rooms) {
    const data = generated.rooms[room.id];
    if (data) state.rooms.get(room.id)!.scene = data.scene;
  }

  // Spatial map from the dungeon graph
  if (generatedLevel.graph) {
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

  const startRoom = level.rooms.find((r) => r.id === level.start_room)!;
  const startRoomData = generated.rooms[startRoom.id];
  const availableTiles = Object.keys(levelTileSet);

  const phase3Span = tracer.startSpan("phase-3", "Parallel: start room layout + entrance narration", tracer.rootId, "Both have their inputs ready from phase 2 and are independent.");

  const [layout, narrative] = await Promise.all([
    (async () => {
      const span = tracer.startSpan("room-designer", `Start room "${startRoom.name}"`, phase3Span.id, `Assembling ${startRoom.width}x${startRoom.height} ${startRoom.category} grid for the start room.`);
      agentLog.call(ctx, "room-designer", `${startRoom.width}x${startRoom.height} ${startRoom.category} room`);
      const result = await designRoom(startRoom, startRoomData?.scene ?? "", startRoomData?.entities ?? [], levelStyle, availableTiles, { isStartRoom: true });
      tracer.endSpan(span.id, { width: result.width, height: result.height });
      agentLog.result(ctx, "room-designer", `${result.width}x${result.height} grid, ${result.entities.length} entities`);
      return result;
    })(),
    (async () => {
      const span = tracer.startSpan("narrator", `Entrance for "${startRoom.name}"`, phase3Span.id, `Player entering "${startRoom.name}" for the first time. Atmospheric 1-3 sentences.`);
      agentLog.call(ctx, "narrator", `Entrance narrative`);
      const result = await narrate(
        { type: "enter_room", roomId: startRoom.id, firstVisit: true },
        { roomName: startRoom.name, theme: level.theme, mood: level.mood, scene: startRoomData?.scene ?? "", inventory: [] }
      );
      tracer.endSpan(span.id, { length: result.length });
      agentLog.result(ctx, "narrator", `${result.length} chars`);
      return result;
    })(),
  ]);
  tracer.endSpan(phase3Span.id);

  state.roomLayouts.set(startRoom.id, layout);
  state.rooms.get(startRoom.id)!.entryNarrative = narrative;

  // Populate entities for every room (start room gets grid positions, others default to 0,0 until their layout completes)
  const entityMap: Record<string, Array<{ id: string; name: string; description: string; portable: boolean }>> = {};
  for (const [roomId, rd] of Object.entries(generated.rooms)) entityMap[roomId] = rd.entities;
  populateEntities(state, entityMap);

  // --- Phase 4: background — design remaining room layouts (don't await) ---
  const otherRooms = level.rooms.filter((r) => r.id !== level.start_room);
  if (otherRooms.length > 0) {
    const bgSpan = tracer.startSpan("background", `Queued ${otherRooms.length} room layout(s)`, tracer.rootId, `Other rooms generated in the background while the player explores the start room.`);
    tracer.endSpan(bgSpan.id, { rooms: otherRooms.map((r) => r.id) });

    for (const room of otherRooms) {
      const bgTracer = new Tracer("background-room", `Layout for "${room.name}"`, "server", tracer.traceId);
      const rd = generated.rooms[room.id];
      const isFinal = room.id === level.rooms[level.rooms.length - 1].id;
      const promise = designRoom(room, rd?.scene ?? "", rd?.entities ?? [], levelStyle, availableTiles, { isFinalRoom: isFinal })
        .then((l) => { state.roomLayouts.set(room.id, l); setSession(state); console.log(`[background] ✓ "${room.name}" ready`); bgTracer.finish(); })
        .catch((err) => { console.error(`[background] ✗ "${room.name}":`, err); bgTracer.finish(); });
      state.pendingRooms.set(room.id, promise);
    }
  }

  setSession(state);
  agentLog.done(ctx, `"${level.title}" — ${level.rooms.length} rooms, ${quests.length} quests`, Date.now() - startedAt);

  return { state, narrative, trace: tracer.finish() };
}

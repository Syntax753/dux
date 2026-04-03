import http from "http";
import { v4 as uuid } from "uuid";
import { getLevel, getAllLevels } from "./services/level-loader.js";
import { getSession, setSession } from "./services/session-store.js";
import { createGameState } from "./models/game-state.js";
import { Tracer, addSSEClient } from "./services/tracer.js";
import { responseCache, ResponseCache } from "./services/response-cache.js";
import { generateRooms, type RoomGeneratorOutput } from "./agents/room-generator.js";
import { planSpatialLayout } from "./agents/level-architect.js";
import { generateLevelStyle } from "./agents/style-agent.js";
import { designRoom } from "./agents/room-designer.js";
import { generateLevelTiles } from "./agents/tile-artist.js";
import { narrate } from "./agents/narrator.js";
import { getItemActions } from "./agents/item-agent.js";
import { checkAction, advanceChain, moveRoom } from "./agents/tools.js";
import { generateLevel, type GeneratedLevel } from "./agents/level-generator.js";
import type { BSPResult } from "./services/bsp-generator.js";
import type { CorridorResult } from "./services/corridor-builder.js";
import type { ClientRoomData } from "../shared/types.js";
import type { GameState } from "./models/game-state.js";
import type { RoomDefinition } from "./models/level.js";

// --- JSON helpers ---

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// --- Game helpers ---

function buildClientRoomData(state: GameState, roomId: string): ClientRoomData {
  const room = state.level.rooms.find((r) => r.id === roomId)!;
  const layout = state.roomLayouts.get(roomId)!;
  const entities = state.entities.getEntitiesInRoom(roomId).map((e) => ({
    id: e.id,
    name: e.name,
    x: e.location.type === "room" ? e.location.x : 0,
    y: e.location.type === "room" ? e.location.y : 0,
    portable: e.portable,
  }));

  return {
    roomId,
    roomName: room.name,
    layout,
    tileSet: state.levelTileSet!,
    style: state.levelStyle!,
    entities,
    playerStart: layout.playerStart,
  };
}

function getNarratorContext(state: GameState) {
  const room = state.level.rooms.find((r) => r.id === state.currentRoomId)!;
  const roomState = state.rooms.get(state.currentRoomId)!;
  return {
    roomName: room.name,
    theme: state.level.theme,
    mood: state.level.mood,
    scene: roomState.scene,
    inventory: state.entities.getInventory().map((e) => e.name),
  };
}

async function generateRoomLayout(
  state: GameState,
  room: RoomDefinition,
  generated: RoomGeneratorOutput,
  tracer?: Tracer,
  parentSpanId?: string
): Promise<void> {
  const roomData = generated.rooms[room.id];
  const entities = roomData?.entities ?? [];
  const availableTiles = Object.keys(state.levelTileSet!);

  const span = tracer?.startSpan("room-designer", `Grid layout for "${room.name}"`, parentSpanId, `Assembling a 16x16 grid for "${room.name}" using shared tile types [${availableTiles.join(", ")}]. Placing ${entities.length} entities, ${room.exits.length} exit(s), and architectural features.`);
  const layout = await designRoom(room, roomData?.scene ?? "", entities, state.levelStyle!, availableTiles);
  state.roomLayouts.set(room.id, layout);
  if (span) tracer!.endSpan(span.id, { width: layout.width, height: layout.height, entityCount: layout.entities.length });

  const hiddenObjects = new Set<string>();
  for (const r of state.level.rooms) {
    for (const step of r.chain) {
      if (step.reveals) {
        for (const rev of step.reveals) hiddenObjects.add(rev);
      }
    }
  }
  for (const entity of entities) {
    if (state.entities.getEntity(entity.id)) continue;
    const gridPos = layout.entities.find((e) => e.id === entity.id);
    const x = gridPos?.x ?? 0;
    const y = gridPos?.y ?? 0;
    state.entities.addEntity({
      ...entity,
      location: hiddenObjects.has(entity.id)
        ? { type: "hidden", roomId: room.id, x, y }
        : { type: "room", roomId: room.id, x, y },
    });
  }
}

async function ensureRoomReady(state: GameState, roomId: string): Promise<void> {
  const pending = state.pendingRooms.get(roomId);
  if (pending) {
    await pending;
    state.pendingRooms.delete(roomId);
  }
}

// --- Route handler ---

type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

const routes: Record<string, Record<string, RouteHandler>> = {
  GET: {},
  POST: {},
};

// SSE endpoint for real-time trace streaming
routes.GET["/api/trace/stream"] = async (_req, res) => {
  addSSEClient(res);
};

routes.GET["/api/levels"] = async (_req, res) => {
  const levels = getAllLevels().map((l) => {
    let totalSteps = 0;
    for (const r of l.rooms) totalSteps += r.chain.length;
    return { id: l.id, title: l.title, theme: l.theme, mood: l.mood, rooms: l.rooms.length, steps: totalSteps };
  });
  json(res, 200, { levels });
};

routes.POST["/api/game/start"] = async (req, res) => {
  const body = (await readBody(req)) as { levelId?: string; roomCount?: number };

  let level;
  let bsp: BSPResult | null = null;
  let corridors: CorridorResult | null = null;
  let placedRooms: import("./services/corridor-builder.js").PlacedRoom[] | null = null;
  const tracer = new Tracer("game/start", body.levelId ? `Starting level "${body.levelId}"` : `Generating ${body.roomCount ?? 5}-room level`);

  if (body.levelId) {
    level = getLevel(body.levelId);
    if (!level) { json(res, 404, { error: `Level "${body.levelId}" not found` }); return; }
  } else {
    const roomCount = Math.max(1, Math.min(50, body.roomCount ?? 5));
    const bspSpan = tracer.startSpan("bsp-generator", `BSP partitioning ${roomCount} rooms`, undefined, `Binary Space Partitioning creates non-overlapping partitions. Rooms placed within partitions with random sizing. Instant, no LLM.`);
    const corrSpan = tracer.startSpan("corridor-builder", `Connecting rooms with corridors`, undefined, `Corridor builder connects sibling rooms from BSP tree. L-shaped corridors with crossroads where paths overlap.`);
    const genSpan = tracer.startSpan("level-generator", `Creative content for ${roomCount} rooms`, undefined, `LLM generates names, themes, puzzles for each BSP room.`);
    try {
      const result = await generateLevel(roomCount);
      level = result.level;
      bsp = result.bsp;
      corridors = result.corridors;
      placedRooms = result.placedRooms;
      tracer.endSpan(bspSpan.id, { partitions: bsp.partitions.length, grid: `${bsp.totalWidth}x${bsp.totalHeight}` });
      tracer.endSpan(corrSpan.id, { segments: corridors.segments.length, crossroads: corridors.crossroads.length });
      tracer.endSpan(genSpan.id, { title: level.title, theme: level.theme, rooms: level.rooms.length });
    } catch (err) {
      tracer.errorSpan(genSpan.id, (err as Error).message);
      tracer.errorSpan(corrSpan.id, (err as Error).message);
      tracer.errorSpan(bspSpan.id, (err as Error).message);
      json(res, 500, { error: "Failed to generate level", trace: tracer.finish() });
      return;
    }
  }

  try {
    const sessionId = uuid();
    const state = createGameState(sessionId, level);
    const startRoom = level.rooms.find((r) => r.id === level.start_room)!;

    // --- Phase 1: room-generator + level-architect + style-agent ALL in parallel ---
    // These are independent — all only need the level definition
    const phase1Span = tracer.startSpan("phase-1", `Parallel: scenes + layout + style`, tracer.rootId, `Running 3 agents in parallel: room-generator (scenes/entities), level-architect (spatial positions), style-agent (color palette). All only need the level definition — no dependencies between them.`);

    // Build spatial map from BSP + corridor data
    const spatialMapPromise = (placedRooms && corridors)
      ? (async () => {
          const span = tracer.startSpan("spatial-map", `Building spatial map from BSP + corridors`, phase1Span.id, `Room positions from BSP, corridor segments from corridor-builder. Instant.`);
          const result: import("../shared/types.js").LevelSpatialMap = {
            rooms: placedRooms!.map((r) => ({ roomId: r.id, gridX: r.x, gridY: r.y })),
            connections: bsp!.siblings.map((s) => {
              const from = placedRooms!.find((r) => r.id === s.leftId)!;
              const to = placedRooms!.find((r) => r.id === s.rightId)!;
              const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
              const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
              const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "east" : "west") : (dy > 0 ? "south" : "north");
              // Find the corridor segment connecting these rooms
              const seg = corridors!.segments.find((seg) =>
                (seg.x1 >= from.x && seg.x1 < from.x + from.width) ||
                (seg.x1 >= to.x && seg.x1 < to.x + to.width)
              );
              return {
                fromRoomId: s.leftId, toRoomId: s.rightId, direction,
                fromX: from.x + Math.floor(from.width / 2),
                fromY: from.y + Math.floor(from.height / 2),
                toX: to.x + Math.floor(to.width / 2),
                toY: to.y + Math.floor(to.height / 2),
              };
            }),
            corridorSegments: corridors!.segments.map((s) => ({
              x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, type: s.type,
            })),
          };
          tracer.endSpan(span.id, { rooms: result.rooms.length, segments: corridors!.segments.length });
          return result;
        })()
      : (async () => {
          const span = tracer.startSpan("level-architect", `Planning spatial layout for ${level.rooms.length} rooms`, phase1Span.id, `Assigning (x,y) grid positions to ${level.rooms.length} room(s) based on exit connections.`);
          const result = await planSpatialLayout(level);
          tracer.endSpan(span.id, result);
          return result;
        })();

    const [generated, spatialMap, levelStyle] = await Promise.all([
      (async () => {
        const span = tracer.startSpan("room-generator", `Generating scenes for ${level.rooms.length} rooms`, phase1Span.id, `Level "${level.title}" has ${level.rooms.length} room(s). Need text descriptions and entity lists for each room.`);
        const result = await generateRooms(level);
        tracer.endSpan(span.id, { roomCount: Object.keys(result.rooms).length });
        return result;
      })(),
      spatialMapPromise,
      (async () => {
        const span = tracer.startSpan("style-agent", `Unified palette for "${level.title}"`, phase1Span.id, `Theme: "${level.theme}", mood: "${level.mood}". Generating color palette for all rooms.`);
        const result = await generateLevelStyle(level);
        const tileSpan = tracer.startSpan("tile-artist", `Shared tileset`, phase1Span.id, `Programmatic tiles from palette — instant, no LLM.`);
        state.levelTileSet = generateLevelTiles(result);
        tracer.endSpan(tileSpan.id, { tileTypes: Object.keys(state.levelTileSet!) });
        tracer.endSpan(span.id, result);
        return result;
      })(),
    ]);

    tracer.endSpan(phase1Span.id);

    // Store results
    state.spatialMap = spatialMap;
    state.levelStyle = levelStyle;
    for (const room of level.rooms) {
      const data = generated.rooms[room.id];
      if (data) state.rooms.get(room.id)!.scene = data.scene;
    }

    // --- Phase 2: start room layout + narrator in parallel ---
    // Room designer needs scenes + tiles (both ready). Narrator needs scene text (ready).
    const phase2Span = tracer.startSpan("phase-2", `Parallel: start room layout + narrator`, tracer.rootId, `Room designer assembles the start room grid. Narrator generates entrance text. Both run in parallel — both have their inputs ready from phase 1.`);

    const [, narrative] = await Promise.all([
      (async () => {
        const span = tracer.startSpan("room-layout", `Layout for "${startRoom.name}"`, phase2Span.id, `Assembling 16x16 grid for start room. Uses shared tileset tile types.`);
        await generateRoomLayout(state, startRoom, generated, tracer, span.id);
        tracer.endSpan(span.id);
      })(),
      (async () => {
        const span = tracer.startSpan("narrator", `Entrance narrative for "${startRoom.name}"`, phase2Span.id, `Player entering "${startRoom.name}" for the first time. Atmospheric 1-3 sentences.`);
        const result = await narrate(
          { type: "enter_room", roomId: level.start_room, firstVisit: true },
          { roomName: startRoom.name, theme: level.theme, mood: level.mood, scene: generated.rooms[startRoom.id]?.scene ?? "", inventory: [] }
        );
        tracer.endSpan(span.id, { length: result.length });
        return result;
      })(),
    ]);

    tracer.endSpan(phase2Span.id);

    // --- Phase 3: background generation — adjacent rooms first, then rest ---
    const otherRooms = level.rooms.filter((r) => r.id !== level.start_room);
    if (otherRooms.length > 0) {
      // Prioritize rooms directly connected to the start room
      const adjacentIds = new Set(
        startRoom.exits.map((e) => e.to).filter((to) => to !== "exit" && to !== "level_exit")
      );
      const adjacentRooms = otherRooms.filter((r) => adjacentIds.has(r.id));
      const distantRooms = otherRooms.filter((r) => !adjacentIds.has(r.id));

      const bgSpan = tracer.startSpan("background", `Queued ${otherRooms.length} room layout(s) (${adjacentRooms.length} adjacent first)`, tracer.rootId, `Adjacent rooms (${adjacentRooms.map((r) => r.name).join(", ")}) are prioritized — player might walk into them via corridors. Distant rooms generated after.`);
      tracer.endSpan(bgSpan.id, { adjacent: adjacentRooms.map((r) => r.id), distant: distantRooms.map((r) => r.id) });

      // Generate adjacent rooms first (in parallel with each other)
      const adjacentPromise = Promise.all(
        adjacentRooms.map((room) => {
          const bgTracer = new Tracer("background-room", `Background (adjacent): layout for "${room.name}"`);
          const promise = generateRoomLayout(state, room, generated, bgTracer, bgTracer.rootId)
            .then(() => { console.log(`[background] ✓ Adjacent room "${room.name}" ready`); setSession(state); })
            .catch((err) => { console.error(`[background] ✗ Room "${room.name}" failed:`, err); });
          state.pendingRooms.set(room.id, promise);
          return promise;
        })
      );

      // Distant rooms start after adjacent rooms complete
      adjacentPromise.then(() => {
        for (const room of distantRooms) {
          const bgTracer = new Tracer("background-room", `Background (distant): layout for "${room.name}"`);
          const promise = generateRoomLayout(state, room, generated, bgTracer, bgTracer.rootId)
            .then(() => { console.log(`[background] ✓ Distant room "${room.name}" ready`); setSession(state); })
            .catch((err) => { console.error(`[background] ✗ Room "${room.name}" failed:`, err); });
          state.pendingRooms.set(room.id, promise);
        }
      });
    }

    setSession(state);

    let totalSteps = 0;
    for (const r of level.rooms) totalSteps += r.chain.length;

    json(res, 200, {
      sessionId,
      level: {
        id: level.id, title: level.title, rooms: level.rooms.length, steps: totalSteps,
        spatialMap: state.spatialMap,
        roomSizes: level.rooms.map((r) => ({ roomId: r.id, width: r.width, height: r.height })),
      },
      currentRoom: buildClientRoomData(state, level.start_room),
      narrative,
      trace: tracer.finish(),
    });
  } catch (err) {
    console.error("Error starting game:", err);
    json(res, 500, { error: (err as Error).message, trace: tracer.finish() });
  }
};

routes.POST["/api/game/move"] = async (req, res) => {
  const { sessionId, direction } = (await readBody(req)) as { sessionId: string; direction: string };
  const state = getSession(sessionId);
  if (!state) { json(res, 404, { error: "Session not found" }); return; }

  const tracer = new Tracer("game/move", `Move ${direction}`);

  try {
    const moveSpan = tracer.startSpan("puzzle-system", `Attempting move ${direction}`, undefined, `Player wants to move ${direction}. Checking if an exit exists in that direction and whether it's locked (requires a completed puzzle step).`);
    const result = moveRoom(state, direction);
    tracer.endSpan(moveSpan.id, result);

    let narrative: string | undefined;
    let newRoom: ClientRoomData | undefined;

    if (result.moved && !result.completed) {
      if (state.pendingRooms.has(state.currentRoomId)) {
        const waitSpan = tracer.startSpan("background-wait", `Waiting for "${result.newRoom}" layout to finish`);
        await ensureRoomReady(state, state.currentRoomId);
        tracer.endSpan(waitSpan.id);
      }

      const narSpan = tracer.startSpan("narrator", `Enter ${result.newRoom}`);
      const roomState = state.rooms.get(state.currentRoomId)!;
      narrative = await narrate(
        { type: "enter_room", roomId: state.currentRoomId, firstVisit: !roomState.visited },
        getNarratorContext(state)
      );
      tracer.endSpan(narSpan.id, { length: narrative.length });
      newRoom = buildClientRoomData(state, state.currentRoomId);
    } else if (!result.moved) {
      const narSpan = tracer.startSpan("narrator", `Blocked exit ${direction}`);
      narrative = await narrate({ type: "exit_blocked", direction }, getNarratorContext(state));
      tracer.endSpan(narSpan.id, { length: narrative.length });
    } else if (result.completed) {
      const narSpan = tracer.startSpan("narrator", "Level complete");
      narrative = await narrate({ type: "level_complete" }, getNarratorContext(state));
      tracer.endSpan(narSpan.id, { length: narrative.length });
    }

    setSession(state);
    json(res, 200, { moved: result.moved, message: result.message, newRoom, narrative, completed: result.completed, trace: tracer.finish() });
  } catch (err) {
    console.error("Error moving:", err);
    json(res, 500, { error: (err as Error).message, trace: tracer.finish() });
  }
};

routes.POST["/api/game/interact"] = async (req, res) => {
  const { sessionId, entityId } = (await readBody(req)) as { sessionId: string; entityId: string };
  const state = getSession(sessionId);
  if (!state) { json(res, 404, { error: "Session not found" }); return; }

  const tracer = new Tracer("game/interact", `Interact with ${entityId}`);

  try {
    const entity = state.entities.getEntity(entityId);
    if (!entity || !state.entities.isRevealed(entityId)) {
      json(res, 404, { error: "Entity not found or not visible" });
      return;
    }

    const room = state.level.rooms.find((r) => r.id === state.currentRoomId)!;
    const roomState = state.rooms.get(state.currentRoomId)!;

    const span = tracer.startSpan("item-agent", `Determining actions for "${entity.name}"`, undefined, `Player pressed interact near "${entity.name}" (portable: ${entity.portable}). Item agent evaluates what actions are available (look/get/use) based on entity type, player inventory, and current puzzle state.`);
    const actions = await getItemActions(entity, state.entities.getInventory(), room.chain, roomState.chainIndex);
    tracer.endSpan(span.id, { actionCount: actions.length });

    json(res, 200, { actions, entityId, entityName: entity.name, trace: tracer.finish() });
  } catch (err) {
    console.error("Error interacting:", err);
    json(res, 500, { error: (err as Error).message, trace: tracer.finish() });
  }
};

routes.POST["/api/game/action"] = async (req, res) => {
  const { sessionId, entityId, action, instrument } = (await readBody(req)) as { sessionId: string; entityId: string; action: string; instrument?: string };
  const state = getSession(sessionId);
  if (!state) { json(res, 404, { error: "Session not found" }); return; }

  const roomState = state.rooms.get(state.currentRoomId)!;
  const inventoryIds = state.entities.getInventory().map((e) => e.id);

  const tracer = new Tracer("game/action", `${action} ${entityId}`);

  // Check cache — same action + same world state = instant response
  const cached = responseCache.get(sessionId, action, entityId, state.currentRoomId, roomState.chainIndex, inventoryIds);
  if (cached) {
    const cacheSpan = tracer.startSpan("cache", `Cache hit for ${action} ${entityId}`, undefined, `This exact action was already performed in the same world state (room: ${state.currentRoomId}, chainIndex: ${roomState.chainIndex}). Returning cached response. Repeated ${cached.count} time(s) before.`);
    const narrative = ResponseCache.summarize(cached.narrative, cached.count);
    responseCache.set(sessionId, action, entityId, state.currentRoomId, roomState.chainIndex, inventoryIds, cached.narrative, cached.response);
    tracer.endSpan(cacheSpan.id, { count: cached.count + 1 });

    json(res, 200, { success: false, narrative, stateChanges: {}, inventory: state.entities.getInventory().map((e) => ({ id: e.id, name: e.name })), trace: tracer.finish(), cached: true });
    return;
  }

  try {
    const stateChanges: Record<string, unknown> = {};

    if (action === "look") {
      const entity = state.entities.getEntity(entityId);
      const narSpan = tracer.startSpan("narrator", `Look at ${entity?.name}`, undefined, `Player chose "look" on "${entity?.name}". Generating a descriptive narrative of the object.`);
      const narrative = await narrate(
        { type: "interact", entityId, action: "look", result: entity?.description ?? "" },
        getNarratorContext(state)
      );
      tracer.endSpan(narSpan.id);

      // Cache look results (non-state-changing)
      responseCache.set(sessionId, action, entityId, state.currentRoomId, roomState.chainIndex, inventoryIds, narrative, {});

      setSession(state);
      json(res, 200, { success: true, narrative, stateChanges: {}, inventory: state.entities.getInventory().map((e) => ({ id: e.id, name: e.name })), trace: tracer.finish() });
      return;
    }

    const checkSpan = tracer.startSpan("puzzle-system", `Check ${action} ${entityId}`, undefined, `Checking if "${action}" on "${entityId}" matches the current puzzle chain step.`);
    const verb = action.toUpperCase();
    const checkResult = checkAction(state, verb, entityId, instrument);
    tracer.endSpan(checkSpan.id, checkResult);

    let narrative: string;

    if (checkResult.matches) {
      // State-changing action — don't cache (world state changes after this)
      const advSpan = tracer.startSpan("puzzle-system", "Advancing chain", undefined, `Action matched! Advancing the puzzle: revealing new objects, updating inventory, checking if exit unlocks.`);
      const advResult = advanceChain(state);
      tracer.endSpan(advSpan.id, advResult);

      if (advResult.addedToInventory) stateChanges.entityRemoved = advResult.addedToInventory;
      if (advResult.newlyRevealed.length > 0) stateChanges.entityRevealed = advResult.newlyRevealed;
      stateChanges.puzzleAdvanced = true;
      stateChanges.levelComplete = advResult.completed;

      const room = state.level.rooms.find((r) => r.id === state.currentRoomId)!;
      for (const exit of room.exits) {
        if (exit.requires && state.completedSteps.has(exit.requires)) {
          stateChanges.exitUnlocked = exit.direction;
        }
      }

      const narSpan = tracer.startSpan("narrator", "Puzzle advance narrative", undefined, `Puzzle step completed. Generating a dramatic moment-of-progress narrative.`);
      const event = advResult.addedToInventory
        ? { type: "pickup" as const, entityId: advResult.addedToInventory }
        : { type: "puzzle_advance" as const, stepId: checkResult.currentStep!.target, hint: checkResult.message };
      narrative = await narrate(event, getNarratorContext(state));
      tracer.endSpan(narSpan.id);
    } else {
      // Non-advancing action — cache it
      const narSpan = tracer.startSpan("narrator", `Non-chain interaction: ${checkResult.reason}`, undefined, `Action didn't match puzzle chain (${checkResult.reason}). Generating flavor text for a non-advancing interaction.`);
      narrative = await narrate(
        { type: "interact", entityId, action, result: checkResult.message },
        getNarratorContext(state)
      );
      tracer.endSpan(narSpan.id);

      responseCache.set(sessionId, action, entityId, state.currentRoomId, roomState.chainIndex, inventoryIds, narrative, checkResult);
    }

    setSession(state);
    json(res, 200, { success: checkResult.matches, narrative, stateChanges, inventory: state.entities.getInventory().map((e) => ({ id: e.id, name: e.name })), trace: tracer.finish() });
  } catch (err) {
    console.error("Error executing action:", err);
    json(res, 500, { error: (err as Error).message, trace: tracer.finish() });
  }
};

routes.GET["/api/game/state"] = async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.pathname.split("/").pop()!;
  const state = getSession(sessionId);
  if (!state) { json(res, 404, { error: "Session not found" }); return; }

  let totalSteps = 0, completedSteps = 0;
  for (const r of state.level.rooms) {
    totalSteps += r.chain.length;
    completedSteps += state.rooms.get(r.id)!.chainIndex;
  }

  json(res, 200, {
    levelId: state.levelId,
    title: state.level.title,
    currentRoom: state.currentRoomId,
    completed: state.completed,
    progress: `${completedSteps}/${totalSteps}`,
    inventory: state.entities.getInventory().map((e) => ({ id: e.id, name: e.name })),
    pendingRooms: [...state.pendingRooms.keys()],
  });
};

// --- Router ---

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = req.url ?? "";

  // Match exact routes first
  const handler = routes[method]?.[url];
  if (handler) {
    await handler(req, res);
    return true;
  }

  // Match parameterized routes (e.g., /api/game/state/:sessionId)
  if (method === "GET" && url.startsWith("/api/game/state/")) {
    await routes.GET["/api/game/state"]!(req, res);
    return true;
  }

  return false;
}

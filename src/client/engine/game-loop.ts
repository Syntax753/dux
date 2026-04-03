import { InputHandler } from "./input.js";
import { PlayerManager } from "./player-manager.js";
import { DisplayManager } from "./display-manager.js";
import type { GameClientState } from "../state.js";
import { addNarrative } from "../state.js";
import { moveDirection, interact, performAction } from "../game-api.js";
import { logTrace } from "../ui/trace-logger.js";
import { renderNarrativePanel } from "../ui/narrative-panel.js";
import { renderInventoryPanel } from "../ui/inventory-panel.js";
import { showRadialMenu, hideRadialMenu } from "../ui/radial-menu.js";
import type { RoomLayout } from "../../shared/types.js";

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let input: InputHandler;
let state: GameClientState;
let busy = false;
let onDescendCallback: ((currentRoomCount: number) => void) | null = null;
let onAscendCallback: (() => void) | null = null;
// Called when player walks into a room — used to trigger server-side session update + narrator
let onEnterRoomCallback: ((roomId: string) => void) | null = null;

export const playerManager = new PlayerManager();
export const displayManager = new DisplayManager();

const C = {
  move: "color: #81c784",
  blocked: "color: #ffab00",
  blockedCached: "color: #616161",
  interact: "color: #ffb74d; font-weight: bold",
  action: "color: #e57373; font-weight: bold",
  radial: "color: #9575cd",
  transition: "color: #4fc3f7; font-weight: bold",
  entity: "color: #ba68c8",
  state: "color: #78909c",
};

function dbg(style: string, ...args: unknown[]): void {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log(`%c${msg}`, style);
}

export function setOnDescend(cb: (currentRoomCount: number) => void): void { onDescendCallback = cb; }
export function setOnAscend(cb: () => void): void { onAscendCallback = cb; }
export function setOnEnterRoom(cb: (roomId: string) => void): void { onEnterRoomCallback = cb; }

const CANVAS_W = 640;
const CANVAS_H = 640;

export function initGameLoop(canvasEl: HTMLCanvasElement, gameState: GameClientState): void {
  canvas = canvasEl;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  canvas.style.imageRendering = "pixelated";
  ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  input = new InputHandler();
  state = gameState;
  requestAnimationFrame(tick);
}

function tick(): void {
  if (state.screen === "playing" && displayManager.ready) {
    handleInput();
    render();
  }
  requestAnimationFrame(tick);
}

function handleInput(): void {
  if (busy) return;
  input.consumeEscape();

  if (input.consumeInteract() && state.screen === "playing") {
    const entity = playerManager.getAdjacentEntity();
    if (entity) {
      dbg(C.interact, `▶ [interact] Player pressed E near "${entity.name}" at (${entity.x},${entity.y}) — requesting actions from item-agent`);
      handleInteract(entity.id, entity.roomId);
    } else {
      dbg(C.blockedCached, `⊘ [interact] No entity nearby`);
    }
    return;
  }

  if (state.screen !== "playing") return;
  const dir = input.getMovementDirection();
  if (!dir) return;

  const result = playerManager.tryMove(dir);

  switch (result.type) {
    case "moved":
      state.playerX = result.x;
      state.playerY = result.y;
      break;

    case "entered_room":
      dbg(C.transition, `▶ [movement] Walked into room "${result.roomId}" at (${result.x},${result.y})`);
      state.playerX = result.x;
      state.playerY = result.y;
      if (onEnterRoomCallback) onEnterRoomCallback(result.roomId);
      break;

    case "blocked":
      if (result.cached) {
        dbg(C.blockedCached, `⊘ [movement] Bump ${dir} (cached) — ${result.message}`);
      } else {
        dbg(C.blocked, `⊘ [movement] Bump ${dir} — ${result.message}`);
        addNarrative(state, result.message);
        renderNarrativePanel(state.narrativeLog);
      }
      break;

    case "blocked_exit":
      if (result.cached) {
        dbg(C.blockedCached, `⊘ [movement] Locked exit ${result.direction} (cached) — ${result.message}`);
      } else {
        dbg(C.blocked, `⊘ [movement] Locked exit ${result.direction} — ${result.message}`);
        addNarrative(state, result.message);
        renderNarrativePanel(state.narrativeLog);
      }
      break;

    case "descend_stairs": {
      const roomCount = displayManager.roomCount;
      dbg(C.transition, `▶ [movement] Descending stairs — next level: ${roomCount + 1} rooms`);
      addNarrative(state, "You descend the ancient staircase, deeper into the dungeon...");
      renderNarrativePanel(state.narrativeLog);
      if (onDescendCallback) onDescendCallback(roomCount);
      break;
    }

    case "ascend_stairs":
      dbg(C.transition, `▶ [movement] Ascending stairs — returning to previous level`);
      addNarrative(state, "You climb the worn steps back up...");
      renderNarrativePanel(state.narrativeLog);
      if (onAscendCallback) onAscendCallback();
      break;
  }
}

async function handleInteract(entityId: string, roomId: string): Promise<void> {
  if (!state.sessionId) return;
  busy = true;
  try {
    const res = await interact(state.sessionId, entityId);
    logTrace(res.trace);

    const entity = playerManager.getAdjacentEntity();
    dbg(C.radial, `✓ [interact] Item-agent returned ${res.actions.length} actions for "${res.entityName}": [${res.actions.map((a) => `${a.action}${a.enabled ? "" : " (disabled)"}`).join(", ")}]`);

    const { sx, sy } = displayManager.cellToScreen(entity?.x ?? 0, entity?.y ?? 0);
    const rect = canvas.getBoundingClientRect();

    state.radialMenu = {
      entityId,
      entityName: res.entityName,
      actions: res.actions,
      screenX: rect.left + sx,
      screenY: rect.top + sy,
    };
    state.screen = "radial-menu";

    showRadialMenu(state.radialMenu, async (action) => {
      dbg(C.action, `▶ [action] Player selected "${action}" on "${res.entityName}"`);
      hideRadialMenu();
      state.screen = "playing";
      state.radialMenu = null;

      busy = true;
      try {
        const actionRes = await performAction(state.sessionId!, entityId, action);
        logTrace(actionRes.trace);

        const cached = (actionRes as unknown as { cached?: boolean }).cached;
        if (cached) {
          dbg(C.state, `✓ [action] Response from cache`);
        } else if (actionRes.success) {
          dbg(C.action, `✓ [action] Success! State changes:`, actionRes.stateChanges);
        } else {
          dbg(C.state, `✓ [action] No effect`);
        }

        if (actionRes.narrative) addNarrative(state, actionRes.narrative);
        state.inventory = actionRes.inventory;

        if (actionRes.stateChanges.entityRemoved) {
          const removed = actionRes.stateChanges.entityRemoved as string;
          dbg(C.entity, `  → [entity] Removed "${removed}"`);
          playerManager.removeEntity(roomId, removed);
        }
        if (actionRes.stateChanges.exitUnlocked) {
          const dir = actionRes.stateChanges.exitUnlocked as string;
          dbg(C.entity, `  → [exit] Unlocked ${dir}`);
          playerManager.unlockExit(roomId, dir);
        }

        renderNarrativePanel(state.narrativeLog);
        renderInventoryPanel(state.inventory);
      } catch (err) {
        addNarrative(state, `Error: ${(err as Error).message}`);
      } finally {
        busy = false;
      }
    });
  } catch (err) {
    addNarrative(state, `Error: ${(err as Error).message}`);
    state.screen = "playing";
  } finally {
    busy = false;
  }
}

// Place torches on wall-adjacent floor tiles in a room
export function placeTorchesForRoom(roomId: string): void {
  const off = playerManager.levelGrid.roomOffsets.get(roomId);
  if (!off) return;

  const grid = playerManager.levelGrid;
  let placed = 0;

  for (let ly = 0; ly < off.height; ly++) {
    for (let lx = 0; lx < off.width; lx++) {
      const gx = off.cellX + lx;
      const gy = off.cellY + ly;
      const cell = grid.getCell(gx, gy);

      // Only place on floor tiles
      if (cell !== "floor" && cell !== "corridor") continue;

      // Check if adjacent to a wall
      let adjacentWall = false;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.getCell(gx + dx, gy + dy) === "wall") {
          adjacentWall = true;
          break;
        }
      }
      if (!adjacentWall) continue;

      // Place torches sparsely — every ~5 wall-adjacent tiles
      if (placed % 5 === 0) {
        displayManager.addItem({ typeId: "torch", x: gx, y: gy });
      }
      placed++;
    }
  }

  if (placed > 0) {
    dbg(C.entity, `  🔥 [lighting] Placed ${Math.floor(placed / 5)} torches in "${roomId}"`);
  }
}

function render(): void {
  if (!displayManager.ready) return;

  // Update camera — smooth follow toward player
  displayManager.update(playerManager.playerX, playerManager.playerY);

  displayManager.render(ctx, playerManager.playerX, playerManager.playerY, playerManager.currentRoomId);

  // Draw entities from all loaded rooms in level-wide coords
  const allEntities: Array<{ x: number; y: number }> = [];
  for (const [roomId] of playerManager.levelGrid.roomOffsets) {
    allEntities.push(...playerManager.getEntitiesLevelCoords(roomId));
  }
  displayManager.renderEntities(ctx, allEntities, playerManager.currentRoomId);
}

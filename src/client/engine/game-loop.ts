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
import { getItemType, getItemActions as getRegistryActions, getItemsByTheme } from "./item-registry.js";

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
    // Check for decoration items first (no server call needed)
    const decoration = displayManager.findNearbyItem(playerManager.playerX, playerManager.playerY);
    if (decoration) {
      const itemType = getItemType(decoration.typeId);
      if (itemType) {
        dbg(C.interact, `▶ [interact] Player pressed E near decoration "${itemType.name}" — using registry verbs (no server call)`);
        handleDecorationInteract(itemType.name, decoration.x, decoration.y, getRegistryActions(itemType));
        return;
      }
    }

    // Then check for server entities (puzzle items — need LLM)
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

// Handle interaction with a decoration item (from registry — no server call)
function handleDecorationInteract(
  name: string,
  itemX: number,
  itemY: number,
  actions: Array<{ action: string; label: string; description: string; enabled: boolean }>
): void {
  const { sx, sy } = displayManager.cellToScreen(itemX, itemY);
  const rect = canvas.getBoundingClientRect();

  state.radialMenu = {
    entityId: `deco_${itemX}_${itemY}`,
    entityName: name,
    actions,
    screenX: rect.left + sx,
    screenY: rect.top + sy,
  };
  state.screen = "radial-menu";

  showRadialMenu(state.radialMenu, (action) => {
    hideRadialMenu();
    state.screen = "playing";
    state.radialMenu = null;

    const selected = actions.find((a) => a.action === action);
    if (selected) {
      dbg(C.action, `✓ [decoration] "${action}" on "${name}" — "${selected.description}"`);
      addNarrative(state, selected.description);
      renderNarrativePanel(state.narrativeLog);
    }
  });
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

// Place themed decoration items in a room (lights on walls + decorations on floor)
export function decorateRoom(roomId: string, theme: string = "dungeon"): void {
  const off = playerManager.levelGrid.roomOffsets.get(roomId);
  if (!off) return;

  const grid = playerManager.levelGrid;
  const themedItems = getItemsByTheme(theme);
  const lightItems = themedItems.filter((i) => i.brightness > 0);
  const decoItems = themedItems.filter((i) => i.brightness === 0 && !i.passable);

  let wallAdjCount = 0;
  let floorCount = 0;
  let lightsPlaced = 0;
  let decosPlaced = 0;

  for (let ly = 0; ly < off.height; ly++) {
    for (let lx = 0; lx < off.width; lx++) {
      const gx = off.cellX + lx;
      const gy = off.cellY + ly;
      if (grid.getCell(gx, gy) !== "floor") continue;

      let adjacentWall = false;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.getCell(gx + dx, gy + dy) === "wall") { adjacentWall = true; break; }
      }

      if (adjacentWall) {
        if (wallAdjCount % 10 === 0 && lightItems.length > 0) {
          const item = lightItems[lightsPlaced % lightItems.length];
          displayManager.addItem({ typeId: item.id, x: gx, y: gy });
          lightsPlaced++;
        }
        wallAdjCount++;
      } else {
        if (floorCount % 15 === 0 && decoItems.length > 0) {
          const item = decoItems[decosPlaced % decoItems.length];
          displayManager.addItem({ typeId: item.id, x: gx, y: gy });
          decosPlaced++;
        }
        floorCount++;
      }
    }
  }

  if (lightsPlaced + decosPlaced > 0) {
    dbg(C.entity, `  🏰 [decorate] "${roomId}": ${lightsPlaced} lights + ${decosPlaced} decorations (theme: ${theme})`);
  }
}

// Light up corridors sparsely
export function decorateCorridors(theme: string = "dungeon"): void {
  const grid = playerManager.levelGrid;
  const lightItems = getItemsByTheme(theme).filter((i) => i.brightness > 0);
  if (lightItems.length === 0) return;

  let placed = 0;
  let count = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[y][x] === "corridor") {
        if (count % 12 === 0) {
          const item = lightItems[placed % lightItems.length];
          displayManager.addItem({ typeId: item.id, x, y });
          placed++;
        }
        count++;
      }
    }
  }
  if (placed > 0) dbg(C.entity, `  🔥 [decorate] ${placed} corridor lights (theme: ${theme})`);
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

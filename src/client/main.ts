import { startGame } from "./game-api.js";
import { createInitialState, loadRoom, addNarrative } from "./state.js";
import { initGameLoop, playerManager, displayManager, setOnDescend, setOnAscend, setOnEnterRoom, decorateRoom, decorateCorridors } from "./engine/game-loop.js";
import { setRoomSize } from "./engine/level-grid.js";
import { initNarrativePanel, renderNarrativePanel } from "./ui/narrative-panel.js";
import { initInventoryPanel, renderInventoryPanel } from "./ui/inventory-panel.js";
import { initRadialMenu } from "./ui/radial-menu.js";
import { logTrace, initTraceStream } from "./ui/trace-logger.js";
import { JourneyManager } from "./journey.js";

const state = createInitialState();
const journey = new JourneyManager();

// --- DOM refs ---
const optionsScreen = document.getElementById("options-screen")!;
const roomCountInput = document.getElementById("room-count") as HTMLInputElement;
const startBtn = document.getElementById("start-btn")!;
const gameEl = document.getElementById("game")!;
const canvasEl = document.getElementById("game-canvas") as HTMLCanvasElement;
const loadingEl = document.getElementById("loading")!;
const statusEl = document.getElementById("status")!;

// --- Options screen ---

startBtn.addEventListener("click", () => {
  const roomCount = Math.max(1, Math.min(50, parseInt(roomCountInput.value, 10) || 5));
  enterNewLevel(roomCount);
});

roomCountInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    startBtn.click();
  }
});

// --- Enter a level (new generation or from cache) ---

async function enterNewLevel(roomCount: number, from?: { levelId: string; direction: "descend" | "ascend" }): Promise<void> {
  optionsScreen.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  loadingEl.textContent = "Generating world...";

  try {
    console.log(`%c[DUX] Generating ${roomCount}-room dungeon...`, "color: #d4a574; font-weight: bold");
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed++;
      loadingEl.textContent = `Generating world... (${elapsed}s)`;
    }, 1000);

    let res;
    try {
      res = await startGame(undefined, roomCount);
    } finally {
      clearInterval(timer);
    }

    console.log("%c[DUX] World generated in " + elapsed + "s", "color: #81c784; font-weight: bold");
    logTrace(res.trace);

    // Cache by level ID
    journey.cacheLevel(res.level.id, res);

    // Track in journey
    journey.enterLevel(res.level.id, res.level.title, roomCount, from);

    applyLevel(res);
  } catch (err) {
    console.error("[DUX] Game start failed:", err);
    loadingEl.textContent = `Error: ${(err as Error).message}`;
  }
}

// Load a previously visited level from cache — no AI calls
function returnToLevel(levelId: string): boolean {
  const cached = journey.getCachedLevel(levelId);
  if (!cached) {
    console.log(`%c[journey] Cache miss for level ${levelId} — cannot return`, "color: #ef5350");
    return false;
  }

  console.log(`%c[DUX] Returning to "${cached.level.title}" from cache — instant!`, "color: #00e676; font-weight: bold");

  journey.enterLevel(cached.level.id, cached.level.title, cached.level.rooms, {
    levelId: journey.currentLevelId,
    direction: "ascend",
  });

  applyLevel(cached);
  return true;
}

// Apply a level response to the game state
function applyLevel(res: ReturnType<typeof createInitialState> extends never ? never : Awaited<ReturnType<typeof startGame>>): void {
  state.sessionId = res.sessionId;
  state.levelTitle = res.level.title;
  state.spatialMap = res.level.spatialMap;

  // Set room sizes before grid init (used by LevelGrid to size the unified grid)
  for (const rs of res.level.roomSizes) {
    setRoomSize(rs.roomId, rs.width, rs.height);
  }

  playerManager.initLevel(
    res.currentRoom.tileSet,
    res.currentRoom.style,
    res.level.spatialMap
  );
  playerManager.loadRoom(res.currentRoom);

  // Ensure corridors connect into the loaded room
  playerManager.levelGrid.finalizeConnectivity();

  // Init display + lighting before placing decorations
  displayManager.init(
    res.level.spatialMap,
    res.currentRoom.tileSet,
    canvasEl.width || 640,
    canvasEl.height || 640,
    playerManager.levelGrid
  );

  // Decorate the start room and corridors based on level theme
  const theme = res.level.title.toLowerCase().includes("crypt") ? "crypt"
    : res.level.title.toLowerCase().includes("forest") ? "forest"
    : res.level.title.toLowerCase().includes("cave") ? "cavern"
    : res.level.title.toLowerCase().includes("castle") ? "castle"
    : "dungeon";
  decorateRoom(res.currentRoom.roomId, theme);
  decorateCorridors(theme);

  loadRoom(state, res.currentRoom);
  state.playerX = playerManager.playerX;
  state.playerY = playerManager.playerY;
  displayManager.snapCamera(playerManager.playerX, playerManager.playerY);
  addNarrative(state, res.narrative);

  loadingEl.classList.add("hidden");
  gameEl.classList.remove("hidden");

  const depthLabel = journey.currentDepth > 0 ? ` | Depth ${journey.currentDepth}` : "";
  statusEl.textContent = `${res.level.title} | ${res.currentRoom.roomName}${depthLabel}`;

  state.screen = "playing";
  renderNarrativePanel(state.narrativeLog);
  renderInventoryPanel(state.inventory);

  journey.printTrace();
}

// --- Room entry: player walked from corridor into a room ---
setOnEnterRoom((roomId) => {
  const depthLabel = journey.currentDepth > 0 ? ` | Depth ${journey.currentDepth}` : "";
  statusEl.textContent = `${state.levelTitle} | ${roomId}${depthLabel}`;
});

// --- Staircase descent: generate next level with more rooms ---
setOnDescend((currentRoomCount) => {
  const nextRoomCount = currentRoomCount + 1;
  const currentLevelId = journey.currentLevelId;
  journey.descend(currentLevelId);

  console.log(`%c[DUX] Descending to next level with ${nextRoomCount} rooms...`, "color: #d4a574; font-weight: bold");
  enterNewLevel(nextRoomCount, { levelId: currentLevelId, direction: "descend" });
});

// --- Staircase ascent: return to previous level from cache ---
setOnAscend(() => {
  const parentId = journey.parentLevelId;
  if (!parentId) {
    addNarrative(state, "There is nowhere to ascend to — this is where your journey began.");
    renderNarrativePanel(state.narrativeLog);
    return;
  }

  const poppedId = journey.ascend();
  if (!poppedId) return;

  const success = returnToLevel(poppedId);
  if (!success) {
    addNarrative(state, "The way back has collapsed... you cannot return.");
    renderNarrativePanel(state.narrativeLog);
  }
});

// --- Listen for radial menu dismiss ---
window.addEventListener("radial-dismissed", () => {
  if (state.screen === "radial-menu") {
    state.screen = "playing";
    state.radialMenu = null;
  }
});

// --- Init ---

initTraceStream();
initNarrativePanel();
initInventoryPanel();
initRadialMenu();
initGameLoop(canvasEl, state);

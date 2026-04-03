import type {
  ClientRoomData,
  RoomLayout,
  TileSet,
  RoomStyle,
  LevelSpatialMap,
  RadialAction,
} from "../shared/types.js";

export interface GameClientState {
  sessionId: string | null;
  levelTitle: string;
  spatialMap: LevelSpatialMap | null;

  // Current room
  room: ClientRoomData | null;

  // Player
  playerX: number;
  playerY: number;

  // Entities currently visible in the room (updated from server)
  entities: Array<{ id: string; name: string; x: number; y: number; portable: boolean }>;

  // Inventory
  inventory: Array<{ id: string; name: string }>;

  // UI state
  screen: "level-select" | "loading" | "playing" | "radial-menu";
  radialMenu: {
    entityId: string;
    entityName: string;
    actions: RadialAction[];
    screenX: number;
    screenY: number;
  } | null;

  // Narrative log
  narrativeLog: Array<{ text: string; timestamp: number }>;
}

export function createInitialState(): GameClientState {
  return {
    sessionId: null,
    levelTitle: "",
    spatialMap: null,
    room: null,
    playerX: 0,
    playerY: 0,
    entities: [],
    inventory: [],
    screen: "level-select",
    radialMenu: null,
    narrativeLog: [],
  };
}

export function loadRoom(state: GameClientState, roomData: ClientRoomData): void {
  state.room = roomData;
  state.playerX = roomData.playerStart.x;
  state.playerY = roomData.playerStart.y;
  state.entities = [...roomData.entities];
  state.radialMenu = null;
}

export function addNarrative(state: GameClientState, text: string): void {
  state.narrativeLog.push({ text, timestamp: Date.now() });
  // Keep last 50 messages
  if (state.narrativeLog.length > 50) {
    state.narrativeLog.shift();
  }
}

// ---- Tile Art ----

/** 8x8 grid of hex color strings, e.g. "#1a1a2e" */
export type TilePattern = string[][];

export interface TileSet {
  wall: TilePattern;
  floor: TilePattern;
  object: TilePattern;
  player: TilePattern;
  [key: string]: TilePattern;
}

// ---- Style ----

export interface RoomStyle {
  palette: {
    wall: string;
    floor: string;
    accent: string;
    highlight: string;
    shadow: string;
  };
  ambience: "dark" | "lit" | "mystical" | "ominous" | "warm";
}

// ---- Room Grid Layout ----

export type CellType = "wall" | "floor" | "object" | "stairs_down" | "stairs_up" | "ladder_up" | "ladder_down";

export interface GridEntity {
  id: string;
  x: number;
  y: number;
}

export interface GridExit {
  x: number;
  y: number;
  direction: string;
  toRoomId: string; // or "exit" for level completion
  locked: boolean;
}

export interface RoomLayout {
  roomId: string;
  width: number;
  height: number;
  cells: CellType[][];
  entities: GridEntity[];
  exits: GridExit[];
  playerStart: { x: number; y: number };
}

// ---- Level Spatial Map ----

export interface RoomPlacement {
  roomId: string;
  gridX: number;
  gridY: number;
}

export interface CorridorSegmentData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: "horizontal" | "vertical";
}

export interface LevelSpatialMap {
  rooms: RoomPlacement[];
  connections: Array<{
    fromRoomId: string;
    toRoomId: string;
    direction: string;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
  }>;
  corridorSegments?: CorridorSegmentData[]; // pre-computed corridor paths from corridor-builder
}

// ---- Interaction ----

export interface RadialAction {
  action: "look" | "get" | "use";
  label: string;
  description: string;
  enabled: boolean;
  reason?: string;
}

// ---- Narration Events ----

export type NarrationEvent =
  | { type: "enter_room"; roomId: string; firstVisit: boolean }
  | { type: "interact"; entityId: string; action: string; result: string }
  | { type: "pickup"; entityId: string }
  | { type: "puzzle_advance"; stepId: string; hint: string }
  | { type: "hint"; context: string }
  | { type: "level_complete" }
  | { type: "exit_blocked"; direction: string };

// ---- Tracing ----

export interface TraceSpan {
  id: string;
  parentId?: string;
  agent: string;
  purpose: string;
  reasoning?: string; // why this agent was called, what it evaluated
  startTime: number;
  endTime?: number;
  children: TraceSpan[];
  input?: unknown;
  output?: unknown;
  status: "running" | "completed" | "error";
  error?: string;
}

// ---- API Payloads ----

export interface ClientRoomData {
  roomId: string;
  roomName: string;
  layout: RoomLayout;
  tileSet: TileSet;
  style: RoomStyle;
  entities: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    portable: boolean;
  }>;
  playerStart: { x: number; y: number };
}

export interface RoomSizeInfo {
  roomId: string;
  width: number;
  height: number;
}

export interface GameStartResponse {
  sessionId: string;
  level: {
    id: string;
    title: string;
    rooms: number;
    steps: number;
    spatialMap: LevelSpatialMap;
    roomSizes: RoomSizeInfo[];
  };
  currentRoom: ClientRoomData;
  narrative: string;
  trace: TraceSpan;
}

export interface MoveResponse {
  moved: boolean;
  message?: string;
  newRoom?: ClientRoomData;
  narrative?: string;
  completed?: boolean;
  trace: TraceSpan;
}

export interface InteractResponse {
  actions: RadialAction[];
  entityId: string;
  entityName: string;
  trace: TraceSpan;
}

export interface ActionResponse {
  success: boolean;
  narrative: string;
  stateChanges: {
    entityRemoved?: string;
    entityRevealed?: string[];
    exitUnlocked?: string;
    puzzleAdvanced?: boolean;
    levelComplete?: boolean;
  };
  inventory: Array<{ id: string; name: string }>;
  trace: TraceSpan;
}

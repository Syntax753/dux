import type { LevelDefinition } from "./level.js";
import type {
  LevelSpatialMap,
  RoomLayout,
  RoomStyle,
  TileSet,
} from "../../shared/types.js";

import { EntityManager } from "../services/entity-manager.js";

export interface RoomState {
  roomId: string;
  scene: string;
  chainIndex: number;
  visited: boolean;
}

export interface GameState {
  sessionId: string;
  levelId: string;
  level: LevelDefinition;
  currentRoomId: string;
  rooms: Map<string, RoomState>;
  entities: EntityManager;
  completed: boolean;
  completedSteps: Set<string>;
  spatialMap: LevelSpatialMap | null;
  levelStyle: RoomStyle | null;
  levelTileSet: TileSet | null;
  roomLayouts: Map<string, RoomLayout>;
  // Background generation: promises that resolve when a room's layout is ready
  pendingRooms: Map<string, Promise<void>>;
}

export function createGameState(
  sessionId: string,
  level: LevelDefinition
): GameState {
  const rooms = new Map<string, RoomState>();
  for (const room of level.rooms) {
    rooms.set(room.id, {
      roomId: room.id,
      scene: "",
      chainIndex: 0,
      visited: room.id === level.start_room,
    });
  }

  return {
    sessionId,
    levelId: level.id,
    level,
    currentRoomId: level.start_room,
    rooms,
    entities: new EntityManager(),
    completed: false,
    completedSteps: new Set(),
    spatialMap: null,
    levelStyle: null,
    levelTileSet: null,
    roomLayouts: new Map(),
    pendingRooms: new Map(),
  };
}

// Populate entities from room generator output + grid positions from room layouts
export function populateEntities(
  state: GameState,
  roomEntities: Record<
    string,
    Array<{ id: string; name: string; description: string; portable: boolean }>
  >
): void {
  // Collect all hidden object IDs
  const hiddenObjects = new Set<string>();
  for (const room of state.level.rooms) {
    for (const step of room.chain) {
      if (step.reveals) {
        for (const r of step.reveals) {
          hiddenObjects.add(r);
        }
      }
    }
  }

  for (const [roomId, entities] of Object.entries(roomEntities)) {
    const layout = state.roomLayouts.get(roomId);
    for (const entity of entities) {
      // Find grid position from layout, or default to 0,0
      const gridPos = layout?.entities.find((e) => e.id === entity.id);
      const x = gridPos?.x ?? 0;
      const y = gridPos?.y ?? 0;

      state.entities.addEntity({
        ...entity,
        location: hiddenObjects.has(entity.id)
          ? { type: "hidden", roomId, x, y }
          : { type: "room", roomId, x, y },
      });
    }
  }
}

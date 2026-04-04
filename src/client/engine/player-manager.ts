import type {
  ClientRoomData,
  RoomLayout,
  TileSet,
  RoomStyle,
  LevelSpatialMap,
} from "../../shared/types.js";
import type { Direction } from "./input.js";
import { directionDelta } from "./input.js";
import { LevelGrid } from "./level-grid.js";

export type MoveResult =
  | { type: "moved"; x: number; y: number }
  | { type: "blocked"; message: string; cached: boolean }
  | { type: "entered_room"; roomId: string; x: number; y: number } // walked into a new room
  | { type: "descend_stairs"; x: number; y: number }
  | { type: "ascend_stairs"; x: number; y: number }
  | { type: "layer_up"; x: number; y: number; layer: number }
  | { type: "layer_down"; x: number; y: number; layer: number }
  | { type: "noop" };

const DIRECTION_LABELS: Record<string, string> = {
  north: "to the north",
  south: "to the south",
  east: "to the east",
  west: "to the west",
};

export class PlayerManager {
  // Level-wide
  private levelTileSet: TileSet | null = null;
  private levelStyle: RoomStyle | null = null;
  readonly levelGrid = new LevelGrid();
  private roomDataCache = new Map<string, ClientRoomData>();

  // Player position in level-wide coordinates
  playerX = 0;
  playerY = 0;
  private _currentRoomId = "";

  // Entities per room
  private roomEntities = new Map<string, Array<{ id: string; name: string; x: number; y: number; portable: boolean }>>();

  // Bump message cache
  private bumpCache = new Map<string, string>();

  // --- Level setup ---

  initLevel(tileSet: TileSet, style: RoomStyle, spatialMap: LevelSpatialMap): void {
    this.levelTileSet = tileSet;
    this.levelStyle = style;
    this.levelGrid.init(spatialMap);
    this.roomDataCache.clear();
    this.roomEntities.clear();
    this.bumpCache.clear();
  }

  // Load a room into the unified grid and entity cache
  loadRoom(roomData: ClientRoomData, setAsCurrentRoom = true): void {
    this.roomDataCache.set(roomData.roomId, roomData);
    this.levelGrid.loadRoom(roomData.roomId, roomData.layout);
    this.levelGrid.finalizeConnectivity(); // ensure corridors punch through room walls
    this.roomEntities.set(roomData.roomId, [...roomData.entities]);

    if (setAsCurrentRoom) {
      this._currentRoomId = roomData.roomId;
      const levelPos = this.levelGrid.toLevel(roomData.roomId, roomData.playerStart.x, roomData.playerStart.y);
      if (levelPos) {
        this.playerX = levelPos.x;
        this.playerY = levelPos.y;
      }
    }
  }

  get currentRoom(): ClientRoomData | null {
    return this.roomDataCache.get(this._currentRoomId) ?? null;
  }

  get currentRoomId(): string {
    return this._currentRoomId;
  }

  get tileSet(): TileSet | null {
    return this.levelTileSet;
  }

  get style(): RoomStyle | null {
    return this.levelStyle;
  }

  isRoomLoaded(roomId: string): boolean {
    return this.roomDataCache.has(roomId);
  }

  // Get all entities in the current room
  get entities(): Array<{ id: string; name: string; x: number; y: number; portable: boolean }> {
    return this.roomEntities.get(this._currentRoomId) ?? [];
  }

  // Get entities in level-wide coords for a room
  getEntitiesLevelCoords(roomId: string): Array<{ id: string; name: string; x: number; y: number; portable: boolean }> {
    const ents = this.roomEntities.get(roomId) ?? [];
    const off = this.levelGrid.roomOffsets.get(roomId);
    if (!off) return ents;
    return ents.map((e) => ({ ...e, x: off.cellX + e.x, y: off.cellY + e.y }));
  }

  // --- Movement on the unified level grid ---

  tryMove(direction: Direction): MoveResult {
    const delta = directionDelta[direction];
    const newX = this.playerX + delta.dx;
    const newY = this.playerY + delta.dy;

    // Out of bounds
    if (newX < 0 || newX >= this.levelGrid.width || newY < 0 || newY >= this.levelGrid.height) {
      return this.getBumpResult(newX, newY, direction, "edge of the world");
    }

    const cell = this.levelGrid.getCell(newX, newY);


    // Stairs (level transitions)
    if (cell === "stairs_down") {
      return { type: "descend_stairs", x: newX, y: newY };
    }
    if (cell === "stairs_up") {
      return { type: "ascend_stairs", x: newX, y: newY };
    }

    // Ladders (layer transitions within a level)
    if (cell === "ladder_up") {
      const newLayer = this.levelGrid.currentLayer + 1;
      this.levelGrid.ensureLayer(newLayer);
      this.levelGrid.switchLayer(newLayer);
      this.playerX = newX;
      this.playerY = newY;
      return { type: "layer_up", x: newX, y: newY, layer: newLayer };
    }
    if (cell === "ladder_down") {
      const newLayer = Math.max(0, this.levelGrid.currentLayer - 1);
      this.levelGrid.switchLayer(newLayer);
      this.playerX = newX;
      this.playerY = newY;
      return { type: "layer_down", x: newX, y: newY, layer: newLayer };
    }

    // Wall or any non-walkable cell
    if (!this.levelGrid.isWalkable(newX, newY)) {
      const desc = cell === "wall" ? "solid stone wall" : cell.replace(/_/g, " ");
      return this.getBumpResult(newX, newY, direction, desc);
    }

    // Walkable — move player
    this.playerX = newX;
    this.playerY = newY;

    // Check if we've entered a different room
    const newRoom = this.levelGrid.getRoomAt(newX, newY);
    if (newRoom && newRoom !== this._currentRoomId) {
      this._currentRoomId = newRoom;
      return { type: "entered_room", roomId: newRoom, x: newX, y: newY };
    }

    return { type: "moved", x: newX, y: newY };
  }

  // --- Entity management ---

  removeEntity(roomId: string, entityId: string): void {
    const ents = this.roomEntities.get(roomId);
    if (ents) {
      this.roomEntities.set(roomId, ents.filter((e) => e.id !== entityId));
    }
  }

  // Find entity adjacent to player (in level-wide coords)
  getAdjacentEntity(): { id: string; name: string; x: number; y: number; portable: boolean; roomId: string } | null {
    const offsets = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
    // Check entities in the current room and adjacent rooms
    for (const [roomId, ents] of this.roomEntities) {
      const off = this.levelGrid.roomOffsets.get(roomId);
      if (!off) continue;
      for (const [dx, dy] of offsets) {
        const checkX = this.playerX + dx;
        const checkY = this.playerY + dy;
        for (const e of ents) {
          if (off.cellX + e.x === checkX && off.cellY + e.y === checkY) {
            return { ...e, x: checkX, y: checkY, roomId };
          }
        }
      }
    }
    return null;
  }

  // --- Bump cache ---

  private getBumpResult(x: number, y: number, direction: Direction, description: string): MoveResult & { type: "blocked" } {
    const bumpKey = `${x}:${y}:${direction}`;
    const cached = this.bumpCache.has(bumpKey);
    const message = this.getOrCreateBumpMessage(bumpKey, direction, description);
    return { type: "blocked", message, cached };
  }

  private getOrCreateBumpMessage(bumpKey: string, direction: string, description: string): string {
    const existing = this.bumpCache.get(bumpKey);
    if (existing) return existing;
    const dirLabel = DIRECTION_LABELS[direction] ?? direction;
    const message = `There's a ${description} ${dirLabel}. You can't go that way.`;
    this.bumpCache.set(bumpKey, message);
    return message;
  }

  private clearBumpCache(x: number, y: number): void {
    for (const bk of this.bumpCache.keys()) {
      if (bk.startsWith(`${x}:${y}:`)) {
        this.bumpCache.delete(bk);
      }
    }
  }
}

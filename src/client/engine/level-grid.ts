import type {
  RoomLayout,
  LevelSpatialMap,
  CellType,
} from "../../shared/types.js";

const CORRIDOR_WIDTH = 2;

interface RoomOffset {
  roomId: string;
  cellX: number;
  cellY: number;
  width: number;
  height: number;
}

// Room sizes are stored here after level definition is parsed
const roomSizes = new Map<string, { width: number; height: number }>();

export function setRoomSize(roomId: string, width: number, height: number): void {
  roomSizes.set(roomId, { width, height });
}

// Unified level grid — rooms + corridors as one seamless grid.
export class LevelGrid {
  width = 0;
  height = 0;
  cells: (CellType | "corridor")[][] = [];
  roomOffsets = new Map<string, RoomOffset>();
  cellOwner: (string | null)[][] = [];

  private minGX = 0;
  private minGY = 0;

  init(spatialMap: LevelSpatialMap): void {
    const realRooms = spatialMap.rooms.filter((r) => r.roomId !== "exit");

    // Find the extent — gridX/gridY are absolute cell positions from BSP
    let maxRight = 0, maxBottom = 0;
    for (const r of realRooms) {
      const size = roomSizes.get(r.roomId) ?? { width: 5, height: 5 };
      maxRight = Math.max(maxRight, r.gridX + size.width + 2);
      maxBottom = Math.max(maxBottom, r.gridY + size.height + 2);
    }

    this.width = maxRight;
    this.height = maxBottom;

    // Initialize with walls
    this.cells = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => "wall" as CellType)
    );
    this.cellOwner = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => null)
    );

    // Room offsets come directly from BSP positions
    this.roomOffsets.clear();
    for (const r of realRooms) {
      const size = roomSizes.get(r.roomId) ?? { width: 5, height: 5 };
      this.roomOffsets.set(r.roomId, {
        roomId: r.roomId,
        cellX: r.gridX,
        cellY: r.gridY,
        width: size.width,
        height: size.height,
      });
    }

    // Carve corridors from pre-computed segments if available
    if (spatialMap.corridorSegments && spatialMap.corridorSegments.length > 0) {
      for (const seg of spatialMap.corridorSegments) {
        if (seg.type === "horizontal") {
          this.carveLineH(seg.x1, seg.x2, seg.y1);
        } else {
          this.carveLineV(seg.y1, seg.y2, seg.x1);
        }
      }
    } else {
      // Fallback: L-shaped corridors from connection endpoints
      for (const conn of spatialMap.connections) {
        if (conn.fromX != null && conn.fromY != null && conn.toX != null && conn.toY != null) {
          this.carveCorridorDirect(conn.fromX, conn.fromY, conn.toX, conn.toY);
        } else {
          this.carveCorridor(conn.fromRoomId, conn.toRoomId, conn.direction);
        }
      }
    }
  }

  loadRoom(roomId: string, layout: RoomLayout): void {
    const off = this.roomOffsets.get(roomId);
    if (!off) return;

    for (let row = 0; row < layout.height; row++) {
      for (let col = 0; col < layout.width; col++) {
        const gy = off.cellY + row;
        const gx = off.cellX + col;
        if (gy >= 0 && gy < this.height && gx >= 0 && gx < this.width) {
          this.cells[gy][gx] = layout.cells[row][col];
          this.cellOwner[gy][gx] = roomId;
        }
      }
    }
  }

  toRoomLocal(levelX: number, levelY: number): { roomId: string; localX: number; localY: number } | null {
    for (const [roomId, off] of this.roomOffsets) {
      if (
        levelX >= off.cellX && levelX < off.cellX + off.width &&
        levelY >= off.cellY && levelY < off.cellY + off.height
      ) {
        return { roomId, localX: levelX - off.cellX, localY: levelY - off.cellY };
      }
    }
    return null;
  }

  toLevel(roomId: string, localX: number, localY: number): { x: number; y: number } | null {
    const off = this.roomOffsets.get(roomId);
    if (!off) return null;
    return { x: off.cellX + localX, y: off.cellY + localY };
  }

  getRoomAt(levelX: number, levelY: number): string | null {
    if (levelY < 0 || levelY >= this.height || levelX < 0 || levelX >= this.width) return null;
    return this.cellOwner[levelY][levelX];
  }

  getCell(x: number, y: number): CellType | "corridor" {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return "wall";
    return this.cells[y][x];
  }

  isWalkable(x: number, y: number): boolean {
    const cell = this.getCell(x, y);
    return cell === "floor" || cell === "object" || cell === "exit" || cell === "corridor" || cell === "stairs_down" || cell === "stairs_up";
  }

  private carveCorridor(fromId: string, toId: string, direction: string): void {
    const from = this.roomOffsets.get(fromId);
    const to = this.roomOffsets.get(toId);
    if (!from || !to) return;

    // Find the exit edge midpoints for each room
    let startX: number, startY: number, endX: number, endY: number;

    switch (direction) {
      case "east":
        startX = from.cellX + from.width; // right edge of from
        startY = from.cellY + Math.floor(from.height / 2);
        endX = to.cellX; // left edge of to
        endY = to.cellY + Math.floor(to.height / 2);
        break;
      case "west":
        startX = from.cellX - 1;
        startY = from.cellY + Math.floor(from.height / 2);
        endX = to.cellX + to.width;
        endY = to.cellY + Math.floor(to.height / 2);
        break;
      case "south":
        startX = from.cellX + Math.floor(from.width / 2);
        startY = from.cellY + from.height;
        endX = to.cellX + Math.floor(to.width / 2);
        endY = to.cellY;
        break;
      case "north":
        startX = from.cellX + Math.floor(from.width / 2);
        startY = from.cellY - 1;
        endX = to.cellX + Math.floor(to.width / 2);
        endY = to.cellY + to.height;
        break;
      default:
        return;
    }

    // Carve L-shaped corridor: go horizontal first, then vertical
    this.carveLineH(startX, endX, startY);
    this.carveLineV(startY, endY, endX);
  }

  // Carve an L-shaped corridor between two absolute cell positions
  private carveCorridorDirect(x1: number, y1: number, x2: number, y2: number): void {
    // Go horizontal first, then vertical
    this.carveLineH(x1, x2, y1);
    this.carveLineV(y1, y2, x2);
  }

  private carveLineH(x1: number, x2: number, y: number): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let x = minX; x <= maxX; x++) {
      this.setCorridorCell(x, y);
      this.setCorridorCell(x, y + 1); // 2-wide
    }
  }

  private carveLineV(y1: number, y2: number, x: number): void {
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
      this.setCorridorCell(x, y);
      this.setCorridorCell(x + 1, y); // 2-wide
    }
  }

  private setCorridorCell(x: number, y: number): void {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
      if (this.cellOwner[y][x] === null) { // don't overwrite room cells
        this.cells[y][x] = "corridor";
      }
    }
  }
}

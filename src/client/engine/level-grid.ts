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

const roomSizes = new Map<string, { width: number; height: number }>();

export function setRoomSize(roomId: string, width: number, height: number): void {
  roomSizes.set(roomId, { width, height });
}

export class LevelGrid {
  width = 0;
  height = 0;
  cells: (CellType | "corridor")[][] = [];
  roomOffsets = new Map<string, RoomOffset>();
  cellOwner: (string | null)[][] = [];

  // Multi-layer system
  layers = new Map<number, (CellType | "corridor")[][]>(); // layer -> cell grid
  layerOwner = new Map<number, (string | null)[][]>();
  currentLayer = 0;

  init(spatialMap: LevelSpatialMap): void {
    const realRooms = spatialMap.rooms.filter((r) => r.roomId !== "exit");

    let maxRight = 0, maxBottom = 0;
    for (const r of realRooms) {
      const size = roomSizes.get(r.roomId) ?? { width: 5, height: 5 };
      maxRight = Math.max(maxRight, r.gridX + size.width + 2);
      maxBottom = Math.max(maxBottom, r.gridY + size.height + 2);
    }

    this.width = maxRight;
    this.height = maxBottom;

    this.cells = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => "wall" as CellType)
    );
    this.cellOwner = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => null)
    );

    // Initialize layer 0 (ground floor)
    this.layers.clear();
    this.layerOwner.clear();
    this.layers.set(0, this.cells);
    this.layerOwner.set(0, this.cellOwner);
    this.currentLayer = 0;

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

    // Carve corridors
    if (spatialMap.corridorSegments && spatialMap.corridorSegments.length > 0) {
      for (const seg of spatialMap.corridorSegments) {
        if (seg.type === "horizontal") {
          this.carveLineH(seg.x1, seg.x2, seg.y1);
        } else {
          this.carveLineV(seg.y1, seg.y2, seg.x1);
        }
      }
    } else {
      for (const conn of spatialMap.connections) {
        this.carveCorridor(conn.fromRoomId, conn.toRoomId, conn.direction);
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
          // Don't overwrite corridor cells with room walls — corridor wins
          if (this.cells[gy][gx] === "corridor" && layout.cells[row][col] === "wall") {
            // Keep corridor, but mark room ownership
            this.cellOwner[gy][gx] = roomId;
            continue;
          }
          this.cells[gy][gx] = layout.cells[row][col];
          this.cellOwner[gy][gx] = roomId;
        }
      }
    }

    // After loading, open room walls where corridors are adjacent
    this.openRoomWalls(roomId);
  }

  // Punch openings in room walls where corridors touch them
  private openRoomWalls(roomId: string): void {
    const off = this.roomOffsets.get(roomId);
    if (!off) return;

    for (let row = 0; row < off.height; row++) {
      for (let col = 0; col < off.width; col++) {
        const gy = off.cellY + row;
        const gx = off.cellX + col;
        if (gy < 0 || gy >= this.height || gx < 0 || gx >= this.width) continue;

        // Only process wall cells on the room perimeter
        if (this.cells[gy][gx] !== "wall") continue;
        if (row > 0 && row < off.height - 1 && col > 0 && col < off.width - 1) continue; // interior wall, skip

        // Check if any cardinal neighbor is a corridor
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            if (this.cells[ny][nx] === "corridor") {
              // Open this wall — make it floor so the room connects to the corridor
              this.cells[gy][gx] = "floor";
              break;
            }
          }
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
    return cell === "floor" || cell === "object" || cell === "corridor"
      || cell === "stairs_down" || cell === "stairs_up"
      || cell === "ladder_up" || cell === "ladder_down";
  }

  // --- Layer management ---

  ensureLayer(layer: number): void {
    if (this.layers.has(layer)) return;
    // Create a new layer as all walls (empty)
    this.layers.set(layer, Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => "wall" as CellType)
    ));
    this.layerOwner.set(layer, Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => null)
    ));
  }

  switchLayer(layer: number): void {
    this.ensureLayer(layer);
    this.currentLayer = layer;
    this.cells = this.layers.get(layer)!;
    this.cellOwner = this.layerOwner.get(layer)!;
  }

  getLayerCells(layer: number): (CellType | "corridor")[][] | undefined {
    return this.layers.get(layer);
  }

  getLayerCount(): number {
    return this.layers.size;
  }

  // Run after all rooms are loaded. Ensures every corridor actually connects
  // into adjacent rooms by opening any wall cells between corridor and room floor.
  finalizeConnectivity(): void {
    let opened = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y][x] !== "wall") continue;

        // Check if this wall sits between a corridor and a room floor/corridor
        let hasCorridor = false;
        let hasFloor = false;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
          const neighbor = this.cells[ny][nx];
          if (neighbor === "corridor") hasCorridor = true;
          if (neighbor === "floor" || neighbor === "object" || neighbor === "stairs_down" || neighbor === "stairs_up") hasFloor = true;
        }

        // Wall is between corridor and walkable space → open it
        if (hasCorridor && hasFloor) {
          this.cells[y][x] = "floor";
          opened++;
        }
      }
    }

    // Also ensure corridors that end at room edges connect through.
    // Check every corridor cell — if it's adjacent to a room wall, open that wall.
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y][x] !== "corridor") continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
          if (this.cells[ny][nx] === "wall" && this.cellOwner[ny][nx] !== null) {
            // This is a room wall adjacent to a corridor — check if opening it
            // would connect to room interior (check the cell beyond)
            const bx = nx + dx, by = ny + dy;
            if (bx >= 0 && bx < this.width && by >= 0 && by < this.height) {
              const beyond = this.cells[by][bx];
              if (beyond === "floor" || beyond === "object" || beyond === "corridor") {
                this.cells[ny][nx] = "floor";
                opened++;
              }
            }
          }
        }
      }
    }

    if (opened > 0) {
      console.log(`[level-grid] finalizeConnectivity: opened ${opened} wall cells for corridor access`);
    }

    // BFS walkability validation: ensure every room has at least one walkable
    // cell reachable from the start room's walkable cells
    this.validateWalkability();
  }

  // BFS from the first room's walkable cell. If any room's walkable cells
  // can't be reached, force-carve a corridor from the nearest reachable cell.
  private validateWalkability(): void {
    // Find a walkable cell in the first room
    const firstRoom = [...this.roomOffsets.values()][0];
    if (!firstRoom) return;

    let startX = -1, startY = -1;
    outer: for (let y = firstRoom.cellY; y < firstRoom.cellY + firstRoom.height; y++) {
      for (let x = firstRoom.cellX; x < firstRoom.cellX + firstRoom.width; x++) {
        if (this.isWalkable(x, y)) { startX = x; startY = y; break outer; }
      }
    }
    if (startX < 0) return;

    // BFS to find all reachable walkable cells
    const visited = new Set<number>();
    const queue: Array<[number, number]> = [[startX, startY]];
    visited.add(startY * this.width + startX);
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        const key = ny * this.width + nx;
        if (visited.has(key)) continue;
        if (!this.isWalkable(nx, ny)) continue;
        visited.add(key);
        queue.push([nx, ny]);
      }
    }

    // Check each room has at least one reachable cell
    let fixCount = 0;
    for (const [roomId, off] of this.roomOffsets) {
      let roomReachable = false;
      for (let y = off.cellY; y < off.cellY + off.height && !roomReachable; y++) {
        for (let x = off.cellX; x < off.cellX + off.width && !roomReachable; x++) {
          if (this.isWalkable(x, y) && visited.has(y * this.width + x)) {
            roomReachable = true;
          }
        }
      }

      if (!roomReachable) {
        console.warn(`[level-grid] Room "${roomId}" is UNREACHABLE! Force-carving corridor.`);
        // Find a walkable cell in this room
        let roomX = off.cellX + Math.floor(off.width / 2);
        let roomY = off.cellY + Math.floor(off.height / 2);
        for (let y = off.cellY; y < off.cellY + off.height; y++) {
          for (let x = off.cellX; x < off.cellX + off.width; x++) {
            if (this.isWalkable(x, y)) { roomX = x; roomY = y; break; }
          }
        }

        // Find the nearest reachable cell
        let nearX = startX, nearY = startY, nearDist = Infinity;
        for (const key of visited) {
          const vy = Math.floor(key / this.width);
          const vx = key % this.width;
          const d = Math.abs(vx - roomX) + Math.abs(vy - roomY);
          if (d < nearDist) { nearDist = d; nearX = vx; nearY = vy; }
        }

        // Force-carve L-shaped corridor between them
        this.carveLineH(roomX, nearX, roomY);
        this.carveLineV(roomY, nearY, nearX);

        // Also open any walls at the endpoints
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const wx = roomX + dx, wy = roomY + dy;
          if (wx >= 0 && wx < this.width && wy >= 0 && wy < this.height) {
            if (this.cells[wy][wx] === "wall") this.cells[wy][wx] = "floor";
          }
        }

        fixCount++;
        // Re-run BFS to include newly connected cells
        const newQueue: Array<[number, number]> = [[roomX, roomY]];
        visited.add(roomY * this.width + roomX);
        while (newQueue.length > 0) {
          const [cx, cy] = newQueue.shift()!;
          for (const [ddx, ddy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = cx + ddx, ny = cy + ddy;
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
            const nk = ny * this.width + nx;
            if (visited.has(nk) || !this.isWalkable(nx, ny)) continue;
            visited.add(nk);
            newQueue.push([nx, ny]);
          }
        }
      }
    }

    if (fixCount > 0) {
      console.log(`[level-grid] validateWalkability: force-connected ${fixCount} unreachable room(s)`);
    } else {
      console.log(`[level-grid] validateWalkability: all ${this.roomOffsets.size} rooms reachable ✓`);
    }
  }

  private carveCorridor(fromId: string, toId: string, _direction: string): void {
    const from = this.roomOffsets.get(fromId);
    const to = this.roomOffsets.get(toId);
    if (!from || !to) return;

    // Connect room edge midpoints via L-shaped corridor
    const fromCX = from.cellX + Math.floor(from.width / 2);
    const fromCY = from.cellY + Math.floor(from.height / 2);
    const toCX = to.cellX + Math.floor(to.width / 2);
    const toCY = to.cellY + Math.floor(to.height / 2);

    // Horizontal first, then vertical
    this.carveLineH(fromCX, toCX, fromCY);
    this.carveLineV(fromCY, toCY, toCX);
  }

  private carveLineH(x1: number, x2: number, y: number): void {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let x = minX; x <= maxX; x++) {
      this.setCorridorCell(x, y);
      this.setCorridorCell(x, y + 1);
    }
  }

  private carveLineV(y1: number, y2: number, x: number): void {
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
      this.setCorridorCell(x, y);
      this.setCorridorCell(x + 1, y);
    }
  }

  private setCorridorCell(x: number, y: number): void {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
      // Corridors overwrite walls. Room floors stay as room floors.
      const current = this.cells[y][x];
      if (current === "wall") {
        this.cells[y][x] = "corridor";
      }
      // If it's already floor/corridor/object, leave it — seamless transition
    }
  }
}

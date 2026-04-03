// Corridor builder: takes rooms placed within BSP partitions and connects
// sibling rooms with corridors. Handles bends, crossroads (overlapping corridors),
// and ensures all rooms are reachable.

export interface PlacedRoom {
  id: string;
  x: number;       // room top-left in level coords
  y: number;
  width: number;
  height: number;
}

export interface CorridorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: "horizontal" | "vertical";
}

export interface CorridorResult {
  segments: CorridorSegment[];
  crossroads: Array<{ x: number; y: number }>; // where corridors intersect
}

export function buildCorridors(
  rooms: PlacedRoom[],
  siblings: Array<{ leftId: string; rightId: string }>
): CorridorResult {
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const allSegments: CorridorSegment[] = [];
  // Track all corridor cells for crossroad detection
  const corridorCells = new Map<string, number>(); // "x,y" → count of corridors passing through

  for (const { leftId, rightId } of siblings) {
    const a = roomMap.get(leftId);
    const b = roomMap.get(rightId);
    if (!a || !b) continue;

    const segments = connectRooms(a, b);
    for (const seg of segments) {
      allSegments.push(seg);
      markSegmentCells(seg, corridorCells);
    }
  }

  // Ensure all rooms are connected (BFS)
  const adj = new Map<string, Set<string>>();
  for (const r of rooms) adj.set(r.id, new Set());
  for (const { leftId, rightId } of siblings) {
    adj.get(leftId)?.add(rightId);
    adj.get(rightId)?.add(leftId);
  }

  const visited = new Set<string>();
  const queue = [rooms[0].id];
  visited.add(rooms[0].id);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!visited.has(n)) { visited.add(n); queue.push(n); }
    }
  }

  // Connect unreachable rooms to nearest reachable
  for (const room of rooms) {
    if (visited.has(room.id)) continue;
    let nearest: PlacedRoom | null = null;
    let nearestDist = Infinity;
    for (const other of rooms) {
      if (!visited.has(other.id)) continue;
      const d = Math.abs(roomCenterX(room) - roomCenterX(other)) + Math.abs(roomCenterY(room) - roomCenterY(other));
      if (d < nearestDist) { nearestDist = d; nearest = other; }
    }
    if (nearest) {
      const segments = connectRooms(room, nearest);
      for (const seg of segments) {
        allSegments.push(seg);
        markSegmentCells(seg, corridorCells);
      }
      visited.add(room.id);
    }
  }

  // Find crossroads: cells where 2+ corridors overlap
  const crossroads: Array<{ x: number; y: number }> = [];
  for (const [key, count] of corridorCells) {
    if (count >= 2) {
      const [x, y] = key.split(",").map(Number);
      crossroads.push({ x, y });
    }
  }

  return { segments: allSegments, crossroads };
}

// Connect two rooms with an L-shaped corridor (horizontal then vertical)
function connectRooms(a: PlacedRoom, b: PlacedRoom): CorridorSegment[] {
  const ax = roomCenterX(a);
  const ay = roomCenterY(a);
  const bx = roomCenterX(b);
  const by = roomCenterY(b);

  // Exit from room edge toward the other room
  const fromX = clamp(bx, a.x, a.x + a.width - 1);
  const fromY = clamp(by, a.y, a.y + a.height - 1);
  const toX = clamp(ax, b.x, b.x + b.width - 1);
  const toY = clamp(ay, b.y, b.y + b.height - 1);

  // L-shaped: horizontal from fromX to toX at fromY, then vertical from fromY to toY at toX
  const segments: CorridorSegment[] = [];

  if (fromX !== toX) {
    segments.push({
      x1: Math.min(fromX, toX), y1: fromY,
      x2: Math.max(fromX, toX), y2: fromY,
      type: "horizontal",
    });
  }

  if (fromY !== toY) {
    segments.push({
      x1: toX, y1: Math.min(fromY, toY),
      x2: toX, y2: Math.max(fromY, toY),
      type: "vertical",
    });
  }

  return segments;
}

function markSegmentCells(seg: CorridorSegment, cells: Map<string, number>): void {
  if (seg.type === "horizontal") {
    for (let x = seg.x1; x <= seg.x2; x++) {
      for (let w = 0; w < 2; w++) { // 2-wide corridor
        const key = `${x},${seg.y1 + w}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
    }
  } else {
    for (let y = seg.y1; y <= seg.y2; y++) {
      for (let w = 0; w < 2; w++) {
        const key = `${seg.x1 + w},${y}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
    }
  }
}

function roomCenterX(r: PlacedRoom): number { return r.x + Math.floor(r.width / 2); }
function roomCenterY(r: PlacedRoom): number { return r.y + Math.floor(r.height / 2); }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

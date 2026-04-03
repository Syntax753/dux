// Dungeon graph: rooms are nodes, corridors are edges.
// Guarantees all rooms are connected via a minimum spanning tree,
// then adds extra edges for loops and interesting topology.
// Validates connectivity before returning.

export interface DungeonRoom {
  id: string;
  x: number;       // room top-left in level coords
  y: number;
  width: number;
  height: number;
}

export interface DungeonEdge {
  fromId: string;
  toId: string;
  // Corridor waypoints: the actual cells the corridor passes through
  waypoints: Array<{ x: number; y: number }>;
}

export interface DungeonGraph {
  rooms: DungeonRoom[];
  edges: DungeonEdge[];
  width: number;
  height: number;
}

// Build the full dungeon graph from BSP partitions.
// 1. Place rooms within partitions
// 2. Build MST (minimum spanning tree) to guarantee all rooms connected
// 3. Add extra edges for loops
// 4. Compute corridor waypoints for each edge
// 5. Validate connectivity
export function buildDungeonGraph(
  partitions: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  totalWidth: number,
  totalHeight: number
): DungeonGraph {
  // 1. Place rooms in partitions
  const rooms: DungeonRoom[] = partitions.map((p) => placeRoom(p));

  // 2. Build MST using Prim's algorithm on room center distances
  const mstEdges = buildMST(rooms);

  // 3. Add ~30% extra random edges for loops (avoid duplicates)
  const extraCount = Math.max(1, Math.floor(rooms.length * 0.3));
  const allEdges = [...mstEdges];
  const edgeSet = new Set(mstEdges.map((e) => edgeKey(e.fromId, e.toId)));

  for (let attempt = 0; attempt < extraCount * 3 && allEdges.length < mstEdges.length + extraCount; attempt++) {
    const a = rooms[Math.floor(Math.random() * rooms.length)];
    const b = rooms[Math.floor(Math.random() * rooms.length)];
    if (a.id === b.id) continue;
    const key = edgeKey(a.id, b.id);
    if (edgeSet.has(key)) continue;
    // Only add if rooms are reasonably close
    const dist = manhattanDist(a, b);
    if (dist > totalWidth * 0.6) continue;
    edgeSet.add(key);
    allEdges.push({ fromId: a.id, toId: b.id, waypoints: [] });
  }

  // 4. Compute corridor waypoints for each edge
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  for (const edge of allEdges) {
    edge.waypoints = computeCorridorPath(roomMap.get(edge.fromId)!, roomMap.get(edge.toId)!);
  }

  // 5. Validate — BFS from first room
  const adj = new Map<string, Set<string>>();
  for (const r of rooms) adj.set(r.id, new Set());
  for (const e of allEdges) {
    adj.get(e.fromId)?.add(e.toId);
    adj.get(e.toId)?.add(e.fromId);
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

  if (visited.size !== rooms.length) {
    console.error(`[dungeon-graph] CONNECTIVITY BUG: only ${visited.size}/${rooms.length} rooms reachable! Forcing connections.`);
    // Force-connect unreachable rooms to nearest reachable
    for (const room of rooms) {
      if (visited.has(room.id)) continue;
      let nearest: DungeonRoom | null = null;
      let nearestDist = Infinity;
      for (const other of rooms) {
        if (!visited.has(other.id)) continue;
        const d = manhattanDist(room, other);
        if (d < nearestDist) { nearestDist = d; nearest = other; }
      }
      if (nearest) {
        allEdges.push({
          fromId: room.id,
          toId: nearest.id,
          waypoints: computeCorridorPath(room, nearest),
        });
        visited.add(room.id);
      }
    }
  }

  // Log vertex degrees — every room must have degree >= 1 (no isolated vertices)
  const degrees = new Map<string, number>();
  for (const r of rooms) degrees.set(r.id, 0);
  for (const e of allEdges) {
    degrees.set(e.fromId, (degrees.get(e.fromId) ?? 0) + 1);
    degrees.set(e.toId, (degrees.get(e.toId) ?? 0) + 1);
  }
  const isolated = [...degrees.entries()].filter(([, d]) => d === 0);
  if (isolated.length > 0) {
    console.error(`[dungeon-graph] ISOLATED VERTICES: ${isolated.map(([id]) => id).join(", ")}! Forcing connections.`);
    for (const [isoId] of isolated) {
      const isoRoom = rooms.find((r) => r.id === isoId)!;
      let nearest: DungeonRoom | null = null;
      let nearestDist = Infinity;
      for (const other of rooms) {
        if (other.id === isoId) continue;
        const d = manhattanDist(isoRoom, other);
        if (d < nearestDist) { nearestDist = d; nearest = other; }
      }
      if (nearest) {
        allEdges.push({ fromId: isoId, toId: nearest.id, waypoints: computeCorridorPath(isoRoom, nearest) });
      }
    }
  }

  const degreeStr = [...degrees.entries()].map(([id, d]) => `${id}:${d}`).join(" ");
  console.log(`[dungeon-graph] ✓ ${rooms.length} rooms, ${allEdges.length} corridors, all connected. Degrees: ${degreeStr}`);

  return { rooms, edges: allEdges, width: totalWidth, height: totalHeight };
}

// Place a room within a BSP partition — with random sizing and position
function placeRoom(p: { id: string; x: number; y: number; w: number; h: number }): DungeonRoom {
  const pad = 1;
  const maxW = p.w - pad * 2;
  const maxH = p.h - pad * 2;
  const shrinkW = Math.floor(Math.random() * maxW * 0.3);
  const shrinkH = Math.floor(Math.random() * maxH * 0.3);
  const w = Math.max(3, maxW - shrinkW);
  const h = Math.max(3, maxH - shrinkH);
  const offsetX = Math.floor(Math.random() * Math.max(1, maxW - w + 1));
  const offsetY = Math.floor(Math.random() * Math.max(1, maxH - h + 1));

  return {
    id: p.id,
    x: p.x + pad + offsetX,
    y: p.y + pad + offsetY,
    width: w,
    height: h,
  };
}

// Prim's MST — guarantees a spanning tree (all rooms connected)
function buildMST(rooms: DungeonRoom[]): DungeonEdge[] {
  if (rooms.length <= 1) return [];

  const inTree = new Set<string>([rooms[0].id]);
  const edges: DungeonEdge[] = [];

  while (inTree.size < rooms.length) {
    let bestFrom: DungeonRoom | null = null;
    let bestTo: DungeonRoom | null = null;
    let bestDist = Infinity;

    for (const r of rooms) {
      if (!inTree.has(r.id)) continue;
      for (const s of rooms) {
        if (inTree.has(s.id)) continue;
        const d = manhattanDist(r, s);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = r;
          bestTo = s;
        }
      }
    }

    if (bestFrom && bestTo) {
      edges.push({ fromId: bestFrom.id, toId: bestTo.id, waypoints: [] });
      inTree.add(bestTo.id);
    } else {
      break; // shouldn't happen
    }
  }

  return edges;
}

// Compute L-shaped corridor path from room edge to room edge
function computeCorridorPath(from: DungeonRoom, to: DungeonRoom): Array<{ x: number; y: number }> {
  // Exit from the nearest edge of each room toward the other
  const fromCX = from.x + Math.floor(from.width / 2);
  const fromCY = from.y + Math.floor(from.height / 2);
  const toCX = to.x + Math.floor(to.width / 2);
  const toCY = to.y + Math.floor(to.height / 2);

  // Determine which edge of 'from' to exit
  const dx = toCX - fromCX;
  const dy = toCY - fromCY;

  let startX: number, startY: number, endX: number, endY: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Primarily horizontal
    startX = dx > 0 ? from.x + from.width : from.x - 1;
    startY = fromCY;
    endX = dx > 0 ? to.x - 1 : to.x + to.width;
    endY = toCY;
  } else {
    // Primarily vertical
    startX = fromCX;
    startY = dy > 0 ? from.y + from.height : from.y - 1;
    endX = toCX;
    endY = dy > 0 ? to.y - 1 : to.y + to.height;
  }

  // L-shaped path: start → bend → end
  return [
    { x: startX, y: startY },
    { x: endX, y: startY },   // horizontal to endX
    { x: endX, y: endY },     // vertical to endY
  ];
}

function manhattanDist(a: DungeonRoom, b: DungeonRoom): number {
  return Math.abs((a.x + a.width / 2) - (b.x + b.width / 2)) +
         Math.abs((a.y + a.height / 2) - (b.y + b.height / 2));
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

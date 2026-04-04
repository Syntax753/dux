// Room furnisher: places items in rooms based on probability tables per room category.
// Each room category has a list of items with:
// - probability: chance (0-1) that this item appears at all
// - countDistribution: weighted distribution of how many to place

import { getItemDef, type ItemDef, type PlacedItem } from "./item-registry.js";
import type { LevelGrid } from "./level-grid.js";

interface CountWeight {
  count: number;
  weight: number; // relative weight, not percentage — will be normalized
}

interface RoomItemRule {
  itemId: string;
  probability: number;          // 0-1: chance this item type appears in the room
  countDistribution: CountWeight[];
}

// --- ROOM CATEGORY ITEM TABLES ---

const ROOM_ITEM_TABLES: Record<string, RoomItemRule[]> = {
  cell: [
    {
      itemId: "torch",
      probability: 1.0,
      countDistribution: [
        { count: 0, weight: 1 },
        { count: 1, weight: 10 },
        { count: 2, weight: 80 },
        { count: 3, weight: 9 },
      ],
    },
    {
      itemId: "barrel",
      probability: 0.4,
      countDistribution: [
        { count: 1, weight: 70 },
        { count: 2, weight: 25 },
        { count: 3, weight: 5 },
      ],
    },
    {
      itemId: "crate",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 80 },
        { count: 2, weight: 20 },
      ],
    },
    {
      itemId: "cobweb",
      probability: 0.5,
      countDistribution: [
        { count: 1, weight: 50 },
        { count: 2, weight: 35 },
        { count: 3, weight: 15 },
      ],
    },
    {
      itemId: "bones",
      probability: 0.25,
      countDistribution: [
        { count: 1, weight: 70 },
        { count: 2, weight: 30 },
      ],
    },
    {
      itemId: "puddle",
      probability: 0.15,
      countDistribution: [
        { count: 1, weight: 90 },
        { count: 2, weight: 10 },
      ],
    },
    {
      itemId: "chest",
      probability: 0.15,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
    {
      itemId: "rubble",
      probability: 0.2,
      countDistribution: [
        { count: 1, weight: 80 },
        { count: 2, weight: 20 },
      ],
    },
    {
      itemId: "table",
      probability: 0.15,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
  ],

  "open-air": [
    {
      itemId: "torch",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 80 },
        { count: 2, weight: 20 },
      ],
    },
    {
      itemId: "campfire",
      probability: 0.4,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
    {
      itemId: "tree",
      probability: 0.6,
      countDistribution: [
        { count: 1, weight: 50 },
        { count: 2, weight: 35 },
        { count: 3, weight: 15 },
      ],
    },
    {
      itemId: "bush",
      probability: 0.5,
      countDistribution: [
        { count: 1, weight: 40 },
        { count: 2, weight: 40 },
        { count: 3, weight: 20 },
      ],
    },
    {
      itemId: "mushroom_cluster",
      probability: 0.35,
      countDistribution: [
        { count: 1, weight: 50 },
        { count: 2, weight: 35 },
        { count: 3, weight: 15 },
      ],
    },
    {
      itemId: "puddle",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 70 },
        { count: 2, weight: 30 },
      ],
    },
    {
      itemId: "fountain",
      probability: 0.1,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
  ],

  shrine: [
    {
      itemId: "candle",
      probability: 0.9,
      countDistribution: [
        { count: 2, weight: 30 },
        { count: 3, weight: 40 },
        { count: 4, weight: 20 },
        { count: 5, weight: 10 },
      ],
    },
    {
      itemId: "altar",
      probability: 0.7,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
    {
      itemId: "statue",
      probability: 0.5,
      countDistribution: [
        { count: 1, weight: 60 },
        { count: 2, weight: 40 },
      ],
    },
    {
      itemId: "coffin",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 70 },
        { count: 2, weight: 30 },
      ],
    },
    {
      itemId: "bookshelf",
      probability: 0.25,
      countDistribution: [
        { count: 1, weight: 70 },
        { count: 2, weight: 30 },
      ],
    },
    {
      itemId: "bones",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 60 },
        { count: 2, weight: 30 },
        { count: 3, weight: 10 },
      ],
    },
    {
      itemId: "torch",
      probability: 0.6,
      countDistribution: [
        { count: 1, weight: 40 },
        { count: 2, weight: 50 },
        { count: 3, weight: 10 },
      ],
    },
    {
      itemId: "pillar",
      probability: 0.4,
      countDistribution: [
        { count: 2, weight: 60 },
        { count: 4, weight: 40 },
      ],
    },
    {
      itemId: "scroll",
      probability: 0.2,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
  ],

  flooded: [
    {
      itemId: "puddle",
      probability: 1.0,
      countDistribution: [
        { count: 3, weight: 30 },
        { count: 4, weight: 40 },
        { count: 5, weight: 30 },
      ],
    },
    {
      itemId: "mushroom_cluster",
      probability: 0.5,
      countDistribution: [
        { count: 2, weight: 50 },
        { count: 3, weight: 50 },
      ],
    },
    {
      itemId: "cobweb",
      probability: 0.3,
      countDistribution: [
        { count: 1, weight: 60 },
        { count: 2, weight: 40 },
      ],
    },
    {
      itemId: "rubble",
      probability: 0.4,
      countDistribution: [
        { count: 1, weight: 60 },
        { count: 2, weight: 40 },
      ],
    },
    {
      itemId: "torch",
      probability: 0.2,
      countDistribution: [
        { count: 1, weight: 100 },
      ],
    },
  ],
};

// --- Furnish a room using its category's item table ---

export function furnishRoom(
  roomId: string,
  roomCategory: string,
  grid: LevelGrid,
  addItem: (item: PlacedItem) => void
): { placed: Array<{ itemId: string; count: number }> } {
  const table = ROOM_ITEM_TABLES[roomCategory] ?? ROOM_ITEM_TABLES["cell"];
  const off = grid.roomOffsets.get(roomId);
  if (!off) return { placed: [] };

  // Collect placement positions by attach type
  // "wall" positions: actual wall tiles that have at least one adjacent floor/corridor
  // "floor" positions: floor/corridor tiles inside the room
  const wallPositions: Array<{ x: number; y: number }> = [];
  const floorPositions: Array<{ x: number; y: number }> = [];
  const corridorPositions: Array<{ x: number; y: number }> = [];

  for (let ly = 0; ly < off.height; ly++) {
    for (let lx = 0; lx < off.width; lx++) {
      const gx = off.cellX + lx;
      const gy = off.cellY + ly;
      const cell = grid.getCell(gx, gy);

      if (cell === "wall") {
        // Wall tile — check if it borders a walkable cell (so the item is visible)
        let adjacentFloor = false;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nc = grid.getCell(gx + dx, gy + dy);
          if (nc === "floor" || nc === "corridor") { adjacentFloor = true; break; }
        }
        if (adjacentFloor) wallPositions.push({ x: gx, y: gy });
      } else if (cell === "floor") {
        floorPositions.push({ x: gx, y: gy });
      } else if (cell === "corridor") {
        corridorPositions.push({ x: gx, y: gy });
      }
    }
  }

  // Shuffle positions for random placement
  shuffle(wallPositions);
  shuffle(floorPositions);
  shuffle(corridorPositions);

  const usedPositions = new Set<string>();
  const placedSummary: Array<{ itemId: string; count: number }> = [];

  // Position pools indexed for each attach type
  const pools: Record<string, { positions: Array<{ x: number; y: number }>; idx: number }> = {
    wall: { positions: wallPositions, idx: 0 },
    floor: { positions: floorPositions, idx: 0 },
    corridor: { positions: corridorPositions, idx: 0 },
  };

  for (const rule of table) {
    // Roll probability
    if (Math.random() > rule.probability) continue;

    // Roll count from distribution
    const count = rollCount(rule.countDistribution);
    if (count === 0) continue;

    const def = getItemDef(rule.itemId);
    if (!def) continue;

    let placed = 0;
    for (let i = 0; i < count; i++) {
      let pos: { x: number; y: number } | null = null;

      // Try each attach type the item supports, in order
      for (const attachType of def.attach) {
        if (attachType === "any") {
          // Try floor first, then corridor, then wall
          for (const poolName of ["floor", "corridor", "wall"]) {
            pos = takePosition(pools[poolName], usedPositions);
            if (pos) break;
          }
        } else {
          const pool = pools[attachType];
          if (pool) pos = takePosition(pool, usedPositions);
        }
        if (pos) break;
      }

      if (!pos) break; // no more valid positions for this item
      addItem({ typeId: rule.itemId, x: pos.x, y: pos.y });
      placed++;
    }

    if (placed > 0) placedSummary.push({ itemId: rule.itemId, count: placed });
  }

  return { placed: placedSummary };
}

function takePosition(
  pool: { positions: Array<{ x: number; y: number }>; idx: number },
  used: Set<string>
): { x: number; y: number } | null {
  while (pool.idx < pool.positions.length) {
    const p = pool.positions[pool.idx++];
    const key = `${p.x},${p.y}`;
    if (!used.has(key)) {
      used.add(key);
      return p;
    }
  }
  return null;
}

// Roll a count from a weighted distribution
function rollCount(dist: CountWeight[]): number {
  const totalWeight = dist.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const d of dist) {
    roll -= d.weight;
    if (roll <= 0) return d.count;
  }
  return dist[dist.length - 1].count;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

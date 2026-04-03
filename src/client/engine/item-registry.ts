// Repository of items that can appear on tiles.
// Each item type has properties including whether it emits light.

export interface ItemType {
  id: string;
  name: string;
  brightness: number; // 0-1 — percentage of light emitted (0 = no light)
  lightRadius: number; // how far the light reaches in tiles
  walkable: boolean;   // can the player walk on this tile?
  description: string;
}

// Item catalog — add new item types here
const ITEM_CATALOG: ItemType[] = [
  {
    id: "torch",
    name: "Wall Torch",
    brightness: 0.7,
    lightRadius: 6,
    walkable: false,
    description: "A flickering torch mounted on the wall, casting warm light",
  },
  {
    id: "brazier",
    name: "Brazier",
    brightness: 0.9,
    lightRadius: 8,
    walkable: false,
    description: "A large iron brazier with crackling flames",
  },
  {
    id: "candle",
    name: "Candle",
    brightness: 0.3,
    lightRadius: 3,
    walkable: false,
    description: "A small flickering candle",
  },
  {
    id: "glowing_crystal",
    name: "Glowing Crystal",
    brightness: 0.5,
    lightRadius: 5,
    walkable: false,
    description: "A faintly glowing crystal embedded in the stone",
  },
  {
    id: "lantern",
    name: "Lantern",
    brightness: 0.6,
    lightRadius: 5,
    walkable: false,
    description: "An old lantern hanging from a chain",
  },
];

const catalogMap = new Map<string, ItemType>();
for (const item of ITEM_CATALOG) {
  catalogMap.set(item.id, item);
}

export function getItemType(id: string): ItemType | undefined {
  return catalogMap.get(id);
}

export function getAllItemTypes(): ItemType[] {
  return [...ITEM_CATALOG];
}

// Placed item instance on the grid
export interface PlacedItem {
  typeId: string;
  x: number; // level-wide coords
  y: number;
}

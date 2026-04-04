// Item registry: every item is defined as minimal JSON.
// Only required fields are mandatory — everything else is optional with sensible defaults.

export type ItemCategory = "fixture" | "player"; // fixture=world object, player=can be picked up
export type AttachTile = "wall" | "floor" | "corridor" | "any";

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  attach: AttachTile[];           // mandatory: which tiles this item can appear on

  // Optional fields — only define what's needed
  description?: string;           // look description. Default: "You see a {name}."
  weight?: number;                // only for category=player items (kg)
  brightness?: number;            // 0-1, light emission
  lightRadius?: number;           // tiles light reaches
  passable?: boolean;             // can walk through? Default: false for fixture, true for player
  verbs?: Array<{
    verb: string;
    label: string;
    description: string;
  }>;
  themes?: string[];              // level themes: dungeon, forest, crypt, etc.
  roomCategories?: string[];      // room categories: cell, open-air, shrine, flooded, etc.
}

// ---- ITEM DATABASE ----
// Each item only defines required fields + what makes it unique.

const ITEMS: ItemDef[] = [
  // ---- LIGHT SOURCES (fixtures, attach to walls) ----
  {
    id: "torch",
    name: "Wall Torch",
    category: "fixture",
    attach: ["wall"],
    brightness: 0.25,
    lightRadius: 6,
    description: "A flickering torch mounted on the wall, casting warm dancing shadows.",
    verbs: [{ verb: "take", label: "Take Torch", description: "You pull the torch from its sconce. The shadows close in." }],
    themes: ["dungeon", "crypt", "castle", "cavern"],
  },
  {
    id: "brazier",
    name: "Brazier",
    category: "fixture",
    attach: ["floor"],
    brightness: 0.5,
    lightRadius: 8,
    description: "A large iron brazier crackling with orange flames.",
    verbs: [{ verb: "warm", label: "Warm Hands", description: "The fire's warmth seeps into your cold fingers." }],
    themes: ["dungeon", "castle"],
    roomCategories: ["shrine", "open-air"],
  },
  {
    id: "candle",
    name: "Candle",
    category: "fixture",
    attach: ["floor", "wall"],
    brightness: 0.15,
    lightRadius: 3,
    description: "A small candle gutters in an unseen draft.",
    themes: ["dungeon", "crypt", "castle"],
    roomCategories: ["cell", "shrine"],
  },
  {
    id: "glowing_crystal",
    name: "Glowing Crystal",
    category: "fixture",
    attach: ["wall", "floor"],
    brightness: 0.3,
    lightRadius: 5,
    description: "A faintly pulsing crystal embedded in stone, casting eerie blue-green light.",
    verbs: [{ verb: "touch", label: "Touch Crystal", description: "The crystal hums warmly against your palm." }],
    themes: ["cavern", "crypt"],
  },
  {
    id: "campfire",
    name: "Campfire",
    category: "fixture",
    attach: ["floor"],
    brightness: 0.45,
    lightRadius: 7,
    description: "Embers of a recent campfire still glow. Someone was here not long ago.",
    verbs: [{ verb: "search", label: "Search Ashes", description: "You sift through warm ashes." }],
    themes: ["cavern", "forest"],
    roomCategories: ["open-air"],
  },

  // ---- CONTAINERS (fixtures, attach to floor) ----
  {
    id: "chest",
    name: "Stone Chest",
    category: "fixture",
    attach: ["floor"],
    description: "A heavy stone chest. Iron bands hold it shut.",
    verbs: [{ verb: "open", label: "Open Chest", description: "You strain against the lid. It grinds open slowly." }],
    themes: ["dungeon", "crypt", "castle"],
    roomCategories: ["cell", "shrine"],
  },
  {
    id: "barrel",
    name: "Wooden Barrel",
    category: "fixture",
    attach: ["floor"],
    description: "A rotting wooden barrel. Liquid seeps from warped planks.",
    verbs: [
      { verb: "open", label: "Open Barrel", description: "You pry off the lid. A foul smell rises." },
      { verb: "push", label: "Push", description: "The barrel scrapes across the stone floor." },
    ],
    themes: ["dungeon", "castle"],
    roomCategories: ["cell"],
  },
  {
    id: "crate",
    name: "Wooden Crate",
    category: "fixture",
    attach: ["floor"],
    description: "A splintered wooden crate, its contents long since plundered.",
    verbs: [{ verb: "search", label: "Search Inside", description: "You reach into the crate through a gap." }],
    themes: ["dungeon", "castle"],
    roomCategories: ["cell"],
  },

  // ---- FURNITURE (fixtures) ----
  {
    id: "table",
    name: "Wooden Table",
    category: "fixture",
    attach: ["floor"],
    description: "A scarred wooden table. Scratch marks cover its surface.",
    verbs: [{ verb: "search", label: "Search Table", description: "You check for hidden compartments." }],
    themes: ["dungeon", "castle"],
    roomCategories: ["cell"],
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    category: "fixture",
    attach: ["wall"],
    description: "A tall bookshelf sags under mouldering tomes.",
    verbs: [
      { verb: "search", label: "Browse Books", description: "You scan faded spines. Most are illegible." },
      { verb: "pull", label: "Pull Book", description: "Something clicks behind the shelf." },
    ],
    themes: ["castle", "crypt"],
    roomCategories: ["cell", "shrine"],
  },

  // ---- STONE / ARCHITECTURAL (fixtures) ----
  {
    id: "statue",
    name: "Stone Statue",
    category: "fixture",
    attach: ["floor"],
    description: "A weathered statue of a forgotten figure. Its eyes seem to follow you.",
    verbs: [{ verb: "examine", label: "Examine Base", description: "An inscription is carved into the pedestal." }],
    themes: ["dungeon", "crypt", "castle"],
    roomCategories: ["shrine"],
  },
  {
    id: "fountain",
    name: "Dry Fountain",
    category: "fixture",
    attach: ["floor"],
    description: "A cracked fountain, long dry. Green stains trace where water once flowed.",
    verbs: [{ verb: "search", label: "Search Basin", description: "Your fingers find something wedged in a crack." }],
    themes: ["castle", "dungeon"],
    roomCategories: ["shrine", "open-air"],
  },
  {
    id: "pillar",
    name: "Stone Pillar",
    category: "fixture",
    attach: ["floor"],
    description: "A thick stone pillar supporting the ceiling. Carvings spiral up its surface.",
    verbs: [{ verb: "examine", label: "Read Carvings", description: "The spiralling symbols are ancient." }],
    themes: ["dungeon", "crypt", "castle", "cavern"],
  },
  {
    id: "altar",
    name: "Dark Altar",
    category: "fixture",
    attach: ["floor"],
    brightness: 0.1,
    lightRadius: 2,
    description: "A black stone altar. Dark stains mark its surface. A faint glow emanates from within.",
    verbs: [
      { verb: "pray", label: "Pray", description: "You kneel. The silence deepens. Something is listening." },
      { verb: "search", label: "Search Altar", description: "A hidden compartment clicks open." },
    ],
    themes: ["crypt"],
    roomCategories: ["shrine"],
  },

  // ---- NATURE (fixtures, open-air rooms) ----
  {
    id: "tree",
    name: "Gnarled Tree",
    category: "fixture",
    attach: ["floor"],
    description: "A twisted tree grows through a crack in the stone, roots gripping rock like skeletal fingers.",
    verbs: [
      { verb: "climb", label: "Climb", description: "The sky looks brighter up there." },
      { verb: "search", label: "Search Roots", description: "You dig around the base of the tree." },
    ],
    themes: ["forest", "cavern"],
    roomCategories: ["open-air"],
  },
  {
    id: "bush",
    name: "Thorny Bush",
    category: "fixture",
    attach: ["floor"],
    passable: true,
    description: "A dense thorny bush. Something might be hidden inside.",
    verbs: [{ verb: "search", label: "Search Bush", description: "You push aside prickly branches." }],
    themes: ["forest", "cavern"],
    roomCategories: ["open-air"],
  },
  {
    id: "mushroom_cluster",
    name: "Glowing Mushrooms",
    category: "fixture",
    attach: ["floor"],
    passable: true,
    brightness: 0.12,
    lightRadius: 2,
    description: "Bioluminescent mushrooms pulse with faint violet light.",
    verbs: [{ verb: "pick", label: "Pick Mushroom", description: "You pluck a soft, glowing cap. It dims in your hand." }],
    themes: ["cavern", "crypt"],
    roomCategories: ["cell", "open-air"],
  },

  // ---- DEBRIS (fixtures, passable) ----
  {
    id: "cobweb",
    name: "Thick Cobwebs",
    category: "fixture",
    attach: ["wall", "floor"],
    passable: true,
    description: "Dense cobwebs stretch between the walls. Whatever spun them is long gone. Probably.",
    verbs: [{ verb: "clear", label: "Clear Webs", description: "You tear through sticky strands. Something scuttles away." }],
    themes: ["dungeon", "crypt", "cavern"],
    roomCategories: ["cell"],
  },
  {
    id: "rubble",
    name: "Collapsed Rubble",
    category: "fixture",
    attach: ["floor"],
    description: "A heap of collapsed stone blocks. The ceiling has partially caved in.",
    verbs: [{ verb: "search", label: "Dig Through", description: "You shift stones aside. Dust fills the air." }],
    themes: ["dungeon", "crypt", "cavern"],
    roomCategories: ["cell"],
  },
  {
    id: "bones",
    name: "Scattered Bones",
    category: "fixture",
    attach: ["floor"],
    passable: true,
    description: "Bones scattered across the floor. They crunch underfoot.",
    verbs: [{ verb: "examine", label: "Examine Bones", description: "Old — centuries. Something gnawed on them." }],
    themes: ["crypt", "dungeon", "cavern"],
    roomCategories: ["cell", "shrine"],
  },
  {
    id: "puddle",
    name: "Dark Puddle",
    category: "fixture",
    attach: ["floor"],
    passable: true,
    description: "A still puddle of dark water reflects your torchlight.",
    verbs: [{ verb: "examine", label: "Look Into", description: "Your reflection stares back. For a moment, it moves on its own." }],
    themes: ["dungeon", "cavern", "crypt"],
    roomCategories: ["cell", "open-air"],
  },
  {
    id: "coffin",
    name: "Stone Coffin",
    category: "fixture",
    attach: ["floor"],
    description: "A sealed stone coffin. Cold radiates from it.",
    verbs: [{ verb: "open", label: "Open Coffin", description: "The lid scrapes open with a hollow grinding sound." }],
    themes: ["crypt"],
    roomCategories: ["cell", "shrine"],
  },

  // ---- PLAYER ITEMS (category=player, can be picked up) ----
  {
    id: "gold_coins",
    name: "Gold Coins",
    category: "player",
    attach: ["floor"],
    weight: 0.3,
    description: "A small pile of tarnished gold coins.",
    themes: ["dungeon", "crypt", "castle"],
  },
  {
    id: "health_potion",
    name: "Health Potion",
    category: "player",
    attach: ["floor"],
    weight: 0.5,
    description: "A small vial of glowing red liquid.",
    themes: ["dungeon", "castle", "cavern"],
  },
  {
    id: "rusty_key",
    name: "Rusty Key",
    category: "player",
    attach: ["floor"],
    weight: 0.1,
    description: "An old iron key, rusted but still functional.",
    themes: ["dungeon", "crypt", "castle"],
  },
  {
    id: "scroll",
    name: "Ancient Scroll",
    category: "player",
    attach: ["floor"],
    weight: 0.2,
    description: "A rolled parchment covered in faded ink.",
    verbs: [{ verb: "read", label: "Read Scroll", description: "The words shimmer as you unroll the parchment." }],
    themes: ["crypt", "castle"],
    roomCategories: ["shrine"],
  },
  {
    id: "gem",
    name: "Rough Gemstone",
    category: "player",
    attach: ["floor"],
    weight: 0.15,
    brightness: 0.05,
    lightRadius: 1,
    description: "An uncut gemstone that catches the light with an inner fire.",
    themes: ["cavern", "dungeon"],
  },
  {
    id: "torch_item",
    name: "Loose Torch",
    category: "player",
    attach: ["floor"],
    weight: 0.8,
    brightness: 0.25,
    lightRadius: 5,
    description: "A torch that could be carried. Its flame still burns.",
    themes: ["dungeon", "crypt", "castle", "cavern"],
  },
];

// ---- Catalog access ----

const catalogMap = new Map<string, ItemDef>();
for (const item of ITEMS) {
  catalogMap.set(item.id, item);
}

export function getItemDef(id: string): ItemDef | undefined {
  return catalogMap.get(id);
}

export function getAllItems(): ItemDef[] {
  return [...ITEMS];
}

export function getItemsByTheme(theme: string): ItemDef[] {
  return ITEMS.filter((item) => !item.themes || item.themes.includes(theme));
}

export function getItemsForRoom(theme: string, roomCategory: string, attachType: AttachTile): ItemDef[] {
  return ITEMS.filter((item) => {
    if (item.themes && !item.themes.includes(theme)) return false;
    if (item.roomCategories && !item.roomCategories.includes(roomCategory)) return false;
    if (!item.attach.includes(attachType) && !item.attach.includes("any")) return false;
    return true;
  });
}

export function getFixtures(theme: string, roomCategory: string): ItemDef[] {
  return getItemsForRoom(theme, roomCategory, "floor").filter((i) => i.category === "fixture");
}

export function getWallFixtures(theme: string, roomCategory: string): ItemDef[] {
  return getItemsForRoom(theme, roomCategory, "wall").filter((i) => i.category === "fixture");
}

export function getPlayerItems(theme: string): ItemDef[] {
  return ITEMS.filter((i) => i.category === "player" && (!i.themes || i.themes.includes(theme)));
}

// Build action list for an item (look is always first)
export function getItemActions(item: ItemDef): Array<{ action: string; label: string; description: string; enabled: boolean }> {
  const actions: Array<{ action: string; label: string; description: string; enabled: boolean }> = [
    {
      action: "look",
      label: "Examine",
      description: item.description || `You see a ${item.name.toLowerCase()}.`,
      enabled: true,
    },
  ];

  if (item.verbs) {
    for (const v of item.verbs) {
      actions.push({ action: v.verb, label: v.label, description: v.description, enabled: true });
    }
  }

  if (item.category === "player") {
    actions.push({ action: "get", label: "Pick Up", description: `You pick up the ${item.name.toLowerCase()}.`, enabled: true });
  }

  return actions;
}

// Placed item instance on the grid
export interface PlacedItem {
  typeId: string;
  x: number;
  y: number;
}

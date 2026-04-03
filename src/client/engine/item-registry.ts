// Comprehensive item registry for dungeon objects.
// Every item implements a common interface with:
// - Default "look" action with overridable description
// - Custom verbs with descriptions
// - Boolean attributes: passable, brightness
// - Items are placed by the decoration agent based on room theme

export interface ItemVerb {
  verb: string;         // e.g., "climb", "open", "light", "search"
  label: string;        // display label: "Climb", "Open", "Light"
  description: string;  // "The sky looks brighter up there"
  enabled: boolean;     // can always be true for decoration items
}

export interface ItemType {
  id: string;
  name: string;
  // Boolean attributes
  passable: boolean;      // can the player walk across this tile?
  brightness: number;     // 0-1 — light emission (0 = no light)
  lightRadius: number;    // how far light reaches (only if brightness > 0)
  // Descriptions
  lookDescription: string; // overrides default "You see a {name}". If empty, uses default.
  // Verbs (beyond the default "look")
  verbs: ItemVerb[];
  // Categorization for theme-based placement
  themes: string[];       // which level themes this item appears in: "dungeon", "forest", "crypt", etc.
}

// Default look description generator
export function getDefaultLookDescription(item: ItemType): string {
  return item.lookDescription || `You see a ${item.name.toLowerCase()}.`;
}

// Build the full action list for an item (look is always first)
export function getItemActions(item: ItemType): Array<{ action: string; label: string; description: string; enabled: boolean }> {
  const actions: Array<{ action: string; label: string; description: string; enabled: boolean }> = [
    {
      action: "look",
      label: "Examine",
      description: getDefaultLookDescription(item),
      enabled: true,
    },
  ];

  for (const verb of item.verbs) {
    actions.push({
      action: verb.verb,
      label: verb.label,
      description: verb.description,
      enabled: verb.enabled,
    });
  }

  return actions;
}

// ---- ITEM CATALOG ----

const ITEM_CATALOG: ItemType[] = [
  // --- Light sources ---
  {
    id: "torch",
    name: "Wall Torch",
    passable: false,
    brightness: 0.7,
    lightRadius: 6,
    lookDescription: "A flickering torch mounted on the wall, casting warm dancing shadows.",
    verbs: [
      { verb: "take", label: "Take Torch", description: "You pull the torch from its sconce. The shadows close in around you.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "castle", "cavern"],
  },
  {
    id: "brazier",
    name: "Brazier",
    passable: false,
    brightness: 0.9,
    lightRadius: 8,
    lookDescription: "A large iron brazier crackling with orange flames. The heat radiates outward.",
    verbs: [
      { verb: "warm", label: "Warm Hands", description: "The fire's warmth seeps into your cold fingers.", enabled: true },
    ],
    themes: ["dungeon", "castle", "crypt"],
  },
  {
    id: "candle",
    name: "Candle",
    passable: false,
    brightness: 0.3,
    lightRadius: 3,
    lookDescription: "A small candle gutters in an unseen draft, its flame barely clinging to the wick.",
    verbs: [
      { verb: "blow", label: "Blow Out", description: "The flame dies. Darkness rushes in.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "castle"],
  },
  {
    id: "glowing_crystal",
    name: "Glowing Crystal",
    passable: false,
    brightness: 0.5,
    lightRadius: 5,
    lookDescription: "A faintly pulsing crystal embedded in the stone, casting an eerie blue-green glow.",
    verbs: [
      { verb: "touch", label: "Touch Crystal", description: "The crystal hums warmly against your palm.", enabled: true },
    ],
    themes: ["cavern", "crypt", "mystical"],
  },
  {
    id: "lantern",
    name: "Hanging Lantern",
    passable: false,
    brightness: 0.6,
    lightRadius: 5,
    lookDescription: "An old lantern swings gently from a rusted chain, its oil nearly spent.",
    verbs: [
      { verb: "take", label: "Take Lantern", description: "You unhook the lantern. It creaks in protest.", enabled: true },
    ],
    themes: ["dungeon", "castle", "cavern"],
  },
  {
    id: "campfire",
    name: "Campfire",
    passable: false,
    brightness: 0.8,
    lightRadius: 7,
    lookDescription: "The embers of a recent campfire still glow. Someone was here not long ago.",
    verbs: [
      { verb: "search", label: "Search Ashes", description: "You sift through the warm ashes with your fingers.", enabled: true },
    ],
    themes: ["cavern", "forest"],
  },

  // --- Nature / Forest items ---
  {
    id: "tree",
    name: "Gnarled Tree",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A twisted tree grows through a crack in the stone, its roots gripping the rock like skeletal fingers.",
    verbs: [
      { verb: "climb", label: "Climb", description: "The sky looks brighter up there.", enabled: true },
      { verb: "search", label: "Search Roots", description: "You dig around the base of the tree.", enabled: true },
    ],
    themes: ["forest", "cavern"],
  },
  {
    id: "bush",
    name: "Thorny Bush",
    passable: true,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A dense thorny bush. Something might be hidden inside.",
    verbs: [
      { verb: "search", label: "Search Bush", description: "You push aside the prickly branches carefully.", enabled: true },
    ],
    themes: ["forest", "cavern"],
  },
  {
    id: "mushroom_cluster",
    name: "Glowing Mushrooms",
    passable: true,
    brightness: 0.2,
    lightRadius: 2,
    lookDescription: "A cluster of bioluminescent mushrooms pulses with a faint violet light.",
    verbs: [
      { verb: "pick", label: "Pick Mushroom", description: "You pluck a soft, glowing cap. It dims in your hand.", enabled: true },
    ],
    themes: ["cavern", "forest", "crypt"],
  },
  {
    id: "vine_wall",
    name: "Vine-Covered Wall",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "Thick vines cling to the stonework, ancient and unyielding.",
    verbs: [
      { verb: "pull", label: "Pull Vines", description: "You tug at the vines. Something shifts behind them.", enabled: true },
    ],
    themes: ["forest", "dungeon"],
  },

  // --- Dungeon furniture ---
  {
    id: "barrel",
    name: "Wooden Barrel",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A rotting wooden barrel. Liquid seeps from the warped planks.",
    verbs: [
      { verb: "open", label: "Open Barrel", description: "You pry off the lid. A foul smell rises.", enabled: true },
      { verb: "push", label: "Push", description: "The barrel scrapes across the stone floor.", enabled: true },
    ],
    themes: ["dungeon", "castle", "crypt"],
  },
  {
    id: "crate",
    name: "Wooden Crate",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A splintered wooden crate, its contents long since plundered.",
    verbs: [
      { verb: "search", label: "Search Inside", description: "You reach into the crate through a gap in the wood.", enabled: true },
    ],
    themes: ["dungeon", "castle"],
  },
  {
    id: "dustbin",
    name: "Dustbin",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A battered metal dustbin. Something rattles inside when you get close.",
    verbs: [
      { verb: "search", label: "Rummage", description: "You dig through the refuse. Unpleasant but thorough.", enabled: true },
      { verb: "kick", label: "Kick Over", description: "The bin clatters loudly. The echo carries far.", enabled: true },
    ],
    themes: ["dungeon", "castle"],
  },
  {
    id: "chest",
    name: "Stone Chest",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A heavy stone chest sits against the wall. Iron bands hold it shut.",
    verbs: [
      { verb: "open", label: "Open Chest", description: "You strain against the lid. It grinds open slowly.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "castle"],
  },
  {
    id: "table",
    name: "Wooden Table",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A scarred wooden table. Scratch marks cover its surface.",
    verbs: [
      { verb: "search", label: "Search Table", description: "You run your hands across the surface, checking for hidden compartments.", enabled: true },
    ],
    themes: ["dungeon", "castle"],
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A tall bookshelf sags under the weight of mouldering tomes.",
    verbs: [
      { verb: "search", label: "Browse Books", description: "You scan the faded spines. Most are illegible.", enabled: true },
      { verb: "pull", label: "Pull Book", description: "You tug a protruding book. Something clicks behind the shelf.", enabled: true },
    ],
    themes: ["castle", "crypt"],
  },

  // --- Stone / Architectural ---
  {
    id: "statue",
    name: "Stone Statue",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A weathered statue of a forgotten figure. Its eyes seem to follow you.",
    verbs: [
      { verb: "examine", label: "Examine Base", description: "An inscription is carved into the pedestal, worn nearly smooth.", enabled: true },
      { verb: "push", label: "Push Statue", description: "It won't budge. It's part of the floor.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "castle"],
  },
  {
    id: "fountain",
    name: "Dry Fountain",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A cracked fountain, long dry. Green stains trace where water once flowed.",
    verbs: [
      { verb: "search", label: "Search Basin", description: "You reach into the dry basin. Your fingers find something wedged in a crack.", enabled: true },
    ],
    themes: ["castle", "dungeon"],
  },
  {
    id: "pillar",
    name: "Stone Pillar",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A thick stone pillar supports the ceiling above. Carvings spiral up its surface.",
    verbs: [
      { verb: "examine", label: "Read Carvings", description: "The spiralling symbols are ancient — a warning, perhaps.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "castle", "cavern"],
  },
  {
    id: "cobweb",
    name: "Thick Cobwebs",
    passable: true,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "Dense cobwebs stretch between the walls. Whatever spun them is long gone. Probably.",
    verbs: [
      { verb: "clear", label: "Clear Webs", description: "You tear through the sticky strands. Something small scuttles away.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "cavern"],
  },
  {
    id: "rubble",
    name: "Collapsed Rubble",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A heap of collapsed stone blocks. The ceiling here has partially caved in.",
    verbs: [
      { verb: "search", label: "Dig Through", description: "You shift stones aside carefully. Dust fills the air.", enabled: true },
    ],
    themes: ["dungeon", "crypt", "cavern"],
  },

  // --- Crypt / Horror ---
  {
    id: "coffin",
    name: "Stone Coffin",
    passable: false,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A sealed stone coffin rests on a raised platform. Cold radiates from it.",
    verbs: [
      { verb: "open", label: "Open Coffin", description: "The lid scrapes open with a hollow grinding sound.", enabled: true },
    ],
    themes: ["crypt"],
  },
  {
    id: "bones",
    name: "Scattered Bones",
    passable: true,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "Bones are scattered across the floor. They crunch underfoot.",
    verbs: [
      { verb: "examine", label: "Examine Bones", description: "These are old — centuries, perhaps. Something gnawed on them.", enabled: true },
    ],
    themes: ["crypt", "dungeon", "cavern"],
  },
  {
    id: "altar",
    name: "Dark Altar",
    passable: false,
    brightness: 0.15,
    lightRadius: 2,
    lookDescription: "A black stone altar. Dark stains mark its surface. A faint, unwholesome glow emanates from within.",
    verbs: [
      { verb: "pray", label: "Pray", description: "You kneel. The silence deepens. Something is listening.", enabled: true },
      { verb: "search", label: "Search Altar", description: "You run your hands along the cold stone. A hidden compartment clicks open.", enabled: true },
    ],
    themes: ["crypt"],
  },

  // --- Water ---
  {
    id: "puddle",
    name: "Dark Puddle",
    passable: true,
    brightness: 0,
    lightRadius: 0,
    lookDescription: "A still puddle of dark water reflects your torchlight.",
    verbs: [
      { verb: "examine", label: "Look Into", description: "Your reflection stares back. For a moment, it seems to move on its own.", enabled: true },
    ],
    themes: ["dungeon", "cavern", "crypt"],
  },
];

// ---- Catalog access ----

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

export function getItemsByTheme(theme: string): ItemType[] {
  return ITEM_CATALOG.filter((item) => item.themes.includes(theme));
}

// Placed item instance on the grid
export interface PlacedItem {
  typeId: string;
  x: number; // level-wide coords
  y: number;
}

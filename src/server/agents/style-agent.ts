import type { RoomStyle } from "../../shared/types.js";
import type { LevelDefinition } from "../models/level.js";

// Hardcoded theme → palette table. No LLM call.
// Themes come from level-generator (dungeon/crypt/cavern/forest/castle/etc.).
// Lookup is forgiving: substring match, lowercase.

type Palette = RoomStyle["palette"];
type Ambience = RoomStyle["ambience"];

interface ThemeStyle {
  match: string[];
  palette: Palette;
  ambience: Ambience;
}

const THEMES: ThemeStyle[] = [
  {
    match: ["crypt", "tomb", "sepulchre", "ossuary", "necropolis"],
    palette: { wall: "#2a2438", floor: "#1a1424", accent: "#a374d4", highlight: "#5b3c7a", shadow: "#0a0814" },
    ambience: "ominous",
  },
  {
    match: ["cavern", "cave", "grotto", "underdark"],
    palette: { wall: "#3a2e2a", floor: "#1f1a17", accent: "#d49a5c", highlight: "#7a5a30", shadow: "#0d0a08" },
    ambience: "dark",
  },
  {
    match: ["forest", "grove", "wood", "thicket"],
    palette: { wall: "#1f3a2a", floor: "#142418", accent: "#7ad48a", highlight: "#3a7a4a", shadow: "#070d0a" },
    ambience: "mystical",
  },
  {
    match: ["castle", "keep", "fortress", "citadel"],
    palette: { wall: "#3a3a44", floor: "#22222a", accent: "#d4c474", highlight: "#7a6f3a", shadow: "#0d0d12" },
    ambience: "warm",
  },
  {
    match: ["temple", "shrine", "sanctum", "cathedral"],
    palette: { wall: "#3a342a", floor: "#22201a", accent: "#f0d480", highlight: "#a08440", shadow: "#10100c" },
    ambience: "lit",
  },
  {
    match: ["ice", "frozen", "frost", "glacier"],
    palette: { wall: "#2a3a48", floor: "#1a2430", accent: "#9ed4f0", highlight: "#4a7aa0", shadow: "#08101a" },
    ambience: "mystical",
  },
  {
    match: ["fire", "lava", "magma", "infernal"],
    palette: { wall: "#3a1a1a", floor: "#241010", accent: "#f08040", highlight: "#a04020", shadow: "#1a0808" },
    ambience: "ominous",
  },
];

const DEFAULT_STYLE: ThemeStyle = {
  match: [],
  palette: { wall: "#2a2a3a", floor: "#1a1a2e", accent: "#d4a574", highlight: "#8b6914", shadow: "#0a0a14" },
  ambience: "dark",
};

export async function generateLevelStyle(level: LevelDefinition): Promise<RoomStyle> {
  const theme = level.theme.toLowerCase();
  const mood = level.mood.toLowerCase();

  let chosen: ThemeStyle = DEFAULT_STYLE;
  for (const t of THEMES) {
    if (t.match.some((m) => theme.includes(m) || mood.includes(m))) {
      chosen = t;
      break;
    }
  }

  console.log(`[style-agent] theme="${level.theme}" mood="${level.mood}" → palette ambience=${chosen.ambience} (deterministic, no LLM)`);

  return { palette: chosen.palette, ambience: chosen.ambience };
}

import type { TileSet, RoomStyle, TilePattern } from "../../shared/types.js";

// Generate tiles programmatically from the AI-generated palette — instant, no LLM call.

export function generateLevelTiles(style: RoomStyle): TileSet {
  const p = style.palette;

  // Helper: lighten/darken a hex color
  function adjust(hex: string, amount: number): string {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  const wallDark = adjust(p.wall, -15);
  const wallLight = adjust(p.wall, 10);
  const floorDark = adjust(p.floor, -12);
  const floorLight = adjust(p.floor, 8);
  const accentDark = adjust(p.accent, -20);

  // Wall: brick/stone pattern with mortar lines
  const wall: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      if (r % 4 === 0) return p.shadow; // horizontal mortar
      if (r < 4 && c % 4 === 0) return p.shadow; // vertical mortar (top half)
      if (r >= 4 && (c + 2) % 4 === 0) return p.shadow; // offset mortar (bottom half)
      return (r + c) % 7 === 0 ? wallLight : (r * c) % 5 === 0 ? wallDark : p.wall;
    })
  );

  // Floor: stone slab pattern with subtle grid lines
  const floor: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      if (r === 0 || c === 0) return floorDark; // slab edges
      if (r === 4 && c > 0) return floorDark; // mid divider
      if (c === 4 && r > 0) return floorDark;
      return (r + c) % 5 === 0 ? floorLight : p.floor;
    })
  );

  // Object: floor tile with glowing accent marker
  const object: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      const dx = c - 3.5, dy = r - 3.5;
      const dist = dx * dx + dy * dy;
      if (dist < 2.5) return p.accent; // bright center
      if (dist < 5) return accentDark; // glow ring
      // Floor underneath
      if (r === 0 || c === 0) return floorDark;
      return p.floor;
    })
  );

  // Player: character shape on floor
  const player: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      // Head (rows 0-1)
      if (r <= 1 && c >= 3 && c <= 4) return p.highlight;
      // Body (rows 2-4)
      if (r >= 2 && r <= 4 && c >= 2 && c <= 5) return p.highlight;
      // Arms (row 3)
      if (r === 3 && (c === 1 || c === 6)) return adjust(p.highlight, -30);
      // Legs (rows 5-7)
      if (r >= 5 && r <= 7 && (c === 2 || c === 3)) return adjust(p.highlight, -15);
      if (r >= 5 && r <= 7 && (c === 4 || c === 5)) return adjust(p.highlight, -15);
      // Gap between legs
      if (r >= 6 && (c === 3 || c === 4)) return p.floor;
      return p.floor;
    })
  );

  // Stairs down: descending steps pattern
  const stairs_down: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      // Each row is a step going deeper — gets darker
      const depth = Math.floor(r / 2);
      const stepColor = adjust(p.floor, -depth * 20);
      // Step edges
      if (r % 2 === 0 && c >= 1 && c <= 6) return adjust(p.shadow, depth * 5);
      if (c === 0 || c === 7) return p.wall; // side walls
      return stepColor;
    })
  );

  // Stairs up: ascending steps pattern — gets lighter
  const stairs_up: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      const depth = Math.floor((7 - r) / 2);
      const stepColor = adjust(p.floor, depth * 15);
      if (r % 2 === 0 && c >= 1 && c <= 6) return adjust(p.highlight, -depth * 10);
      if (c === 0 || c === 7) return p.wall;
      return stepColor;
    })
  );

  // Ladder up: vertical rungs going up
  const ladder_up: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      if (c === 1 || c === 6) return p.accent; // side rails
      if (r % 2 === 0 && c >= 2 && c <= 5) return adjust(p.accent, -15); // rungs
      return adjust(p.floor, 10); // lighter floor (going up)
    })
  );

  // Ladder down: vertical rungs going down
  const ladder_down: TilePattern = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      if (c === 1 || c === 6) return p.accent; // side rails
      if (r % 2 === 0 && c >= 2 && c <= 5) return adjust(p.accent, -15); // rungs
      return adjust(p.floor, -15); // darker floor (going down)
    })
  );

  return { wall, floor, object, player, stairs_down, stairs_up, ladder_up, ladder_down };
}

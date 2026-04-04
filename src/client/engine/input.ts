export type Direction = "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

const keyMap: Record<string, Direction> = {
  // Arrow keys
  ArrowUp: "north",
  ArrowDown: "south",
  ArrowLeft: "west",
  ArrowRight: "east",
  // WASD
  w: "north", W: "north",
  s: "south", S: "south",
  a: "west",  A: "west",
  d: "east",  D: "east",
  // Numpad cardinal
  "8": "north",
  "2": "south",
  "4": "west",
  "6": "east",
  // Numpad diagonals
  "7": "northwest",
  "9": "northeast",
  "1": "southwest",
  "3": "southeast",
};

const directionDelta: Record<Direction, { dx: number; dy: number }> = {
  north:     { dx:  0, dy: -1 },
  south:     { dx:  0, dy:  1 },
  west:      { dx: -1, dy:  0 },
  east:      { dx:  1, dy:  0 },
  northwest: { dx: -1, dy: -1 },
  northeast: { dx:  1, dy: -1 },
  southwest: { dx: -1, dy:  1 },
  southeast: { dx:  1, dy:  1 },
};

export { directionDelta };

export class InputHandler {
  private heldKeys = new Set<string>();
  private interactPressed = false;
  private escapePressed = false;
  private waitPressed = false;
  private lastMoveTime = 0;
  private moveDelay = 150;

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.heldKeys.add(e.key);
      if (e.key === "e" || e.key === "E") this.interactPressed = true;
      if (e.key === "Escape") this.escapePressed = true;
      if (e.key === "5") this.waitPressed = true; // numpad 5 = wait
    });
    window.addEventListener("keyup", (e) => {
      this.heldKeys.delete(e.key);
    });
  }

  getMovementDirection(): Direction | null {
    const now = Date.now();
    if (now - this.lastMoveTime < this.moveDelay) return null;

    for (const [key, dir] of Object.entries(keyMap)) {
      if (this.heldKeys.has(key)) {
        this.lastMoveTime = now;
        return dir;
      }
    }
    return null;
  }

  consumeInteract(): boolean {
    if (this.interactPressed) { this.interactPressed = false; return true; }
    return false;
  }

  consumeEscape(): boolean {
    if (this.escapePressed) { this.escapePressed = false; return true; }
    return false;
  }

  consumeWait(): boolean {
    if (this.waitPressed) { this.waitPressed = false; return true; }
    return false;
  }
}

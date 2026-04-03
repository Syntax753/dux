export type Direction = "north" | "south" | "east" | "west";

const keyMap: Record<string, Direction> = {
  ArrowUp: "north",
  ArrowDown: "south",
  ArrowLeft: "west",
  ArrowRight: "east",
  w: "north",
  W: "north",
  s: "south",
  S: "south",
  a: "west",
  A: "west",
  d: "east",
  D: "east",
};

const directionDelta: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
  east: { dx: 1, dy: 0 },
};

export { directionDelta };

export class InputHandler {
  private heldKeys = new Set<string>();
  private interactPressed = false;
  private escapePressed = false;
  private lastMoveTime = 0;
  private moveDelay = 150; // ms between repeated moves

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.heldKeys.add(e.key);
      if (e.key === "e" || e.key === "E") this.interactPressed = true;
      if (e.key === "Escape") this.escapePressed = true;
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
    if (this.interactPressed) {
      this.interactPressed = false;
      return true;
    }
    return false;
  }

  consumeEscape(): boolean {
    if (this.escapePressed) {
      this.escapePressed = false;
      return true;
    }
    return false;
  }
}

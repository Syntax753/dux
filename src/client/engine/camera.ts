// Camera with dead zone and critically damped movement (no overshoot/bounce).

const DEAD_ZONE = 0.30;
const SMOOTHING = 0.12; // lerp factor per frame — 0.1=smooth, 0.2=snappy, no overshoot

export class Camera {
  x = 0;
  y = 0;

  private targetX = 0;
  private targetY = 0;

  viewW = 20;
  viewH = 20;

  snapTo(cellX: number, cellY: number): void {
    this.x = cellX + 0.5;
    this.y = cellY + 0.5;
    this.targetX = this.x;
    this.targetY = this.y;
  }

  setViewport(canvasW: number, canvasH: number, cellPx: number): void {
    this.viewW = canvasW / cellPx;
    this.viewH = canvasH / cellPx;
  }

  follow(playerX: number, playerY: number): void {
    const px = playerX + 0.5;
    const py = playerY + 0.5;

    const halfW = this.viewW * DEAD_ZONE / 2;
    const halfH = this.viewH * DEAD_ZONE / 2;

    if (px < this.targetX - halfW || px > this.targetX + halfW) {
      this.targetX = px;
    }
    if (py < this.targetY - halfH || py > this.targetY + halfH) {
      this.targetY = py;
    }
  }

  update(): void {
    // Simple lerp — critically damped, no overshoot
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;

    if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) {
      this.x = this.targetX;
      this.y = this.targetY;
      return;
    }

    this.x += dx * SMOOTHING;
    this.y += dy * SMOOTHING;
  }
}

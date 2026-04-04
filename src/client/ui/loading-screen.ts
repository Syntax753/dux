// Galaxy loading screen: blurred starfield with planets slowly coming into focus.

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface Planet {
  x: number;
  y: number;
  radius: number;
  color: string;
  ringColor: string | null;
  orbitSpeed: number;
  orbitRadius: number;
  orbitAngle: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let textEl: HTMLElement | null = null;
let stars: Star[] = [];
let planets: Planet[] = [];
let animFrame = 0;
let startTime = 0;
let running = false;

const COLORS = [
  "#ff6b4a", "#4a9eff", "#ffd84a", "#4aff8b",
  "#ff4adb", "#4afff0", "#ffaa4a", "#b84aff",
];

const RING_COLORS = [
  null, null, null, "#d4a57444", "#8888aa44", null, "#ffcc6644", null,
];

export function initLoadingScreen(): void {
  canvas = document.getElementById("loading-canvas") as HTMLCanvasElement;
  textEl = document.getElementById("loading-text");
  if (!canvas) return;

  canvas.width = 640;
  canvas.height = 480;
  ctx = canvas.getContext("2d")!;
}

export function startLoadingAnimation(): void {
  if (!canvas || !ctx) initLoadingScreen();
  if (!canvas || !ctx) return;

  running = true;
  startTime = Date.now();
  animFrame = 0;

  // Generate stars
  stars = [];
  for (let i = 0; i < 300; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      brightness: Math.random() * 0.7 + 0.3,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
    });
  }

  // Generate planets
  planets = [];
  const numPlanets = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < numPlanets; i++) {
    planets.push({
      x: 100 + Math.random() * (canvas.width - 200),
      y: 80 + Math.random() * (canvas.height - 160),
      radius: 8 + Math.random() * 25,
      color: COLORS[i % COLORS.length],
      ringColor: RING_COLORS[i % RING_COLORS.length],
      orbitSpeed: (Math.random() - 0.5) * 0.003,
      orbitRadius: Math.random() * 15,
      orbitAngle: Math.random() * Math.PI * 2,
    });
  }

  requestAnimationFrame(tick);
}

export function stopLoadingAnimation(): void {
  running = false;
}

export function updateLoadingText(text: string): void {
  if (textEl) textEl.textContent = text;
}

function tick(): void {
  if (!running || !ctx || !canvas) return;
  animFrame++;

  const elapsed = (Date.now() - startTime) / 1000;
  // Blur starts at 15px and gradually clears to 0 over ~40 seconds
  const blur = Math.max(0, 15 - elapsed * 0.4);

  // Clear
  ctx.fillStyle = "#030308";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Nebula glow (subtle background color)
  const nebulaAlpha = 0.03 + Math.sin(elapsed * 0.1) * 0.01;
  const grad = ctx.createRadialGradient(
    canvas.width * 0.4, canvas.height * 0.5, 50,
    canvas.width * 0.4, canvas.height * 0.5, 300
  );
  grad.addColorStop(0, `rgba(80, 40, 120, ${nebulaAlpha})`);
  grad.addColorStop(0.5, `rgba(20, 50, 100, ${nebulaAlpha * 0.5})`);
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Apply blur via filter
  ctx.filter = blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : "none";

  // Draw stars
  for (const star of stars) {
    const twinkle = Math.sin(elapsed * star.twinkleSpeed * 60 + star.twinkleOffset);
    const alpha = star.brightness * (0.6 + twinkle * 0.4);
    ctx.fillStyle = `rgba(255, 255, 240, ${alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw planets
  for (const planet of planets) {
    planet.orbitAngle += planet.orbitSpeed;
    const px = planet.x + Math.cos(planet.orbitAngle) * planet.orbitRadius;
    const py = planet.y + Math.sin(planet.orbitAngle) * planet.orbitRadius * 0.4;

    // Planet glow
    const glowGrad = ctx.createRadialGradient(px, py, planet.radius * 0.5, px, py, planet.radius * 2);
    glowGrad.addColorStop(0, planet.color + "33");
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(px, py, planet.radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Planet body
    const bodyGrad = ctx.createRadialGradient(
      px - planet.radius * 0.3, py - planet.radius * 0.3, 1,
      px, py, planet.radius
    );
    bodyGrad.addColorStop(0, lighten(planet.color, 40));
    bodyGrad.addColorStop(0.7, planet.color);
    bodyGrad.addColorStop(1, darken(planet.color, 60));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(px, py, planet.radius, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    if (planet.ringColor) {
      ctx.strokeStyle = planet.ringColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, py, planet.radius * 1.6, planet.radius * 0.3, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Reset filter
  ctx.filter = "none";

  requestAnimationFrame(tick);
}

function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

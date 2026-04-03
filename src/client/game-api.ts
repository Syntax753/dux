import type {
  GameStartResponse,
  MoveResponse,
  InteractResponse,
  ActionResponse,
} from "../shared/types.js";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchLevels() {
  return api<{
    levels: Array<{
      id: string;
      title: string;
      theme: string;
      mood: string;
      rooms: number;
      steps: number;
    }>;
  }>("/levels");
}

export function startGame(levelId?: string, roomCount?: number) {
  return api<GameStartResponse>("/game/start", levelId ? { levelId } : { roomCount });
}

export function moveDirection(sessionId: string, direction: string) {
  return api<MoveResponse>("/game/move", { sessionId, direction });
}

export function interact(sessionId: string, entityId: string) {
  return api<InteractResponse>("/game/interact", { sessionId, entityId });
}

export function performAction(
  sessionId: string,
  entityId: string,
  action: string,
  instrument?: string
) {
  return api<ActionResponse>("/game/action", { sessionId, entityId, action, instrument });
}

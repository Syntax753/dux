import type { GameState } from "../models/game-state.js";

const sessions = new Map<string, GameState>();

export function getSession(sessionId: string): GameState | undefined {
  return sessions.get(sessionId);
}

export function setSession(state: GameState): void {
  sessions.set(state.sessionId, state);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

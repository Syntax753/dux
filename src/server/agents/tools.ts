import type { GameState, RoomState } from "../models/game-state.js";
import type { RoomDefinition } from "../models/level.js";

// --- Helpers ---

function getCurrentRoom(state: GameState): RoomDefinition {
  return state.level.rooms.find(
    (r) => r.id === state.currentRoomId
  ) as RoomDefinition;
}

function getCurrentRoomState(state: GameState): RoomState {
  return state.rooms.get(state.currentRoomId) as RoomState;
}

// --- Action checking ---

export interface ActionCheckResult {
  matches: boolean;
  reason: "chain_advance" | "valid_non_chain" | "blocked" | "not_revealed" | "room_complete";
  currentStep: { verb: string; target: string; on?: string } | null;
  message: string;
}

export function checkAction(
  state: GameState,
  verb: string,
  target: string,
  instrument?: string
): ActionCheckResult {
  const room = getCurrentRoom(state);
  const roomState = getCurrentRoomState(state);

  if (roomState.chainIndex >= room.chain.length) {
    return { matches: false, reason: "room_complete", currentStep: null, message: "This room's puzzle is already solved." };
  }

  const currentStep = room.chain[roomState.chainIndex];

  if (!state.entities.isRevealed(target)) {
    return {
      matches: false,
      reason: "not_revealed",
      currentStep: { verb: currentStep.verb, target: currentStep.target, on: currentStep.on },
      message: `The object "${target}" is not visible or doesn't exist here.`,
    };
  }

  const verbMatch = verb.toUpperCase() === currentStep.verb.toUpperCase();
  const targetMatch = target.toLowerCase() === currentStep.target.toLowerCase();
  const instrumentMatch = currentStep.on
    ? instrument?.toLowerCase() === currentStep.on.toLowerCase() ||
      target.toLowerCase() === currentStep.on.toLowerCase()
    : true;

  if (verbMatch && targetMatch && instrumentMatch) {
    return {
      matches: true,
      reason: "chain_advance",
      currentStep: { verb: currentStep.verb, target: currentStep.target, on: currentStep.on },
      message: `Action matches! ${currentStep.hint}`,
    };
  }

  return {
    matches: false,
    reason: "valid_non_chain",
    currentStep: { verb: currentStep.verb, target: currentStep.target, on: currentStep.on },
    message: `The player interacts with "${target}" but this doesn't advance the puzzle.`,
  };
}

// --- Chain advancement ---

export function advanceChain(state: GameState): {
  advanced: boolean;
  completed: boolean;
  newlyRevealed: string[];
  addedToInventory: string | null;
  progress: string;
} {
  const room = getCurrentRoom(state);
  const roomState = getCurrentRoomState(state);
  const currentStep = room.chain[roomState.chainIndex];

  state.completedSteps.add(currentStep.id);

  const newlyRevealed: string[] = [];
  if (currentStep.reveals) {
    for (const entityId of currentStep.reveals) {
      state.entities.revealEntity(entityId);
      newlyRevealed.push(entityId);
    }
  }

  let addedToInventory: string | null = null;
  if (currentStep.verb.toUpperCase() === "GET") {
    state.entities.moveToInventory(currentStep.target);
    addedToInventory = currentStep.target;
  }

  if (currentStep.verb.toUpperCase() === "USE" && currentStep.on) {
    state.entities.removeFromInventory(currentStep.target);
  }

  roomState.chainIndex++;

  let totalSteps = 0;
  let completedSteps = 0;
  for (const r of state.level.rooms) {
    totalSteps += r.chain.length;
    const rs = state.rooms.get(r.id)!;
    completedSteps += rs.chainIndex;
  }

  return {
    advanced: true,
    completed: completedSteps >= totalSteps,
    newlyRevealed,
    addedToInventory,
    progress: `${completedSteps}/${totalSteps}`,
  };
}

// --- Room movement ---

export function moveRoom(
  state: GameState,
  direction: string
): { moved: boolean; message: string; newRoom?: string; completed?: boolean } {
  const room = getCurrentRoom(state);
  const exit = room.exits.find(
    (e) => e.direction.toLowerCase() === direction.toLowerCase()
  );

  if (!exit) {
    return { moved: false, message: `There is no exit to the ${direction}.` };
  }

  if (exit.requires && !state.completedSteps.has(exit.requires)) {
    return { moved: false, message: `The way ${direction} is blocked.` };
  }

  if (exit.to === "exit") {
    state.completed = true;
    return { moved: true, message: "Level complete!", completed: true };
  }

  state.currentRoomId = exit.to;
  const newRoomState = state.rooms.get(exit.to)!;
  const wasVisited = newRoomState.visited;
  newRoomState.visited = true;

  const newRoom = state.level.rooms.find((r) => r.id === exit.to)!;
  return {
    moved: true,
    message: wasVisited ? `You return to ${newRoom.name}.` : `You enter ${newRoom.name}.`,
    newRoom: newRoom.name,
  };
}

// --- Hints ---

export function getHint(state: GameState): { hint: string; currentStepHint?: string } {
  const room = getCurrentRoom(state);
  const roomState = getCurrentRoomState(state);

  if (roomState.chainIndex >= room.chain.length) {
    return { hint: "This room's puzzle is solved. Try exploring through one of the exits." };
  }

  const currentStep = room.chain[roomState.chainIndex];
  return {
    hint: `Try to ${currentStep.verb.toLowerCase()} the ${currentStep.target.replace(/_/g, " ")}.`,
    currentStepHint: currentStep.hint,
  };
}

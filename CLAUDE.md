# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — runs the whole app via `tsx watch src/server/index.ts`. There is **one process on port 3000**; Vite is mounted as middleware inside the Node http server. There is no separate frontend dev server.
- `npm run build` — `tsc` + `vite build` (output under `dist/`).
- `npm run preview` — runs the built server (`dist/server/index.js`).
- `npx tsc --noEmit` — type-check only. Use this for fast verification; no separate lint or test runner is configured.

There is no test framework wired up. If you add tests, surface the runner here.

## LLM mode (`VITE_AI_MODE`)

All LLM calls flow through `callAgent` in `src/server/services/llm-client.ts`, which dispatches on the env var:

- `live` (default) — shells out to the `claude` CLI (`--print --output-format json --tools "" --strict-mcp-config --disable-slash-commands`). Uses the user's local Claude account; **no API key needed**. The `--system-prompt` flag fully replaces the CLI's default prompt; tools/MCP/skills are explicitly disabled so the CLI behaves as a pure LLM endpoint.
- `mock` — deterministic stubs for tests. Returns `{}` when the system prompt mentions JSON, picks the first/`finalize` tool when tools are present so `runAgentLoop` terminates immediately.
- `api` — direct fetch to `api.anthropic.com` (requires `ANTHROPIC_API_KEY`).

For local development, `live` is the default and the right choice. Tool-use in `live` mode rides on a JSON-envelope protocol appended to the system prompt (`{"text": "...", "tool_calls": [...]}`); the adapter parses this back into the API tool-use shape so callers don't notice the difference.

## Architecture

**Multi-agent storyteller.** The DM is split across ~9 specialized agents in `src/server/agents/`. Each agent is a thin function that builds a prompt, calls `callAgent`, and parses JSON. System prompts live in `src/server/prompts/`. The agents are independent — composition happens in two places:

1. **YAML-level path** (`POST /api/game/start` with `levelId`): `src/server/routes.ts` directly orchestrates the agents in three explicit phases (parallel scenes+layout+style → start room layout + entrance narrative → background room generation). Use this for hand-authored levels in `levels/*.yaml`.
2. **Procedural path** (`POST /api/game/start` with `roomCount`): `runGameAgent` in `src/server/agents/game-agent.ts` uses Claude **tool-use** to let the model decide call order. The tool list (`generate_level`, `generate_room_scenes`, `generate_style`, `generate_quests`, `design_start_room`, `narrate_entrance`, `finalize`) is the orchestration surface — the agent kicks off independent work in parallel under the hood (e.g. scenes/style/quests start as soon as the level skeleton exists). `runAgentLoop` in `llm-client.ts` runs the tool loop with a 10-iteration cap.

**Level shape (`src/server/models/level.ts`).** A `LevelDefinition` is rooms + a `start_room`. Each room has `exits` and a `chain` of `{ id, verb, target, on?, reveals?, hint }` steps. Exits can carry `requires: <stepId>` — `moveRoom` in `agents/tools.ts` blocks movement until that step is in `state.completedSteps`. `chain` advancement is strict: `checkAction` only matches if the step at `chainIndex` matches verb+target+instrument exactly, otherwise the action is "valid non-chain" and triggers flavor narration (cached). `advanceChain` reveals hidden entities, moves GET targets to inventory, and consumes USE instruments.

**Procedural level generation (`agents/level-generator.ts`).** Spatial layout is **deterministic**, not LLM-generated: `bsp-generator` partitions space, `dungeon-graph` builds the MST + corridors, and only then the LLM fills in creative content (title/theme/mood and per-room name/hint/chain). `generatedLevel.graph` carries the room placements + corridor waypoints that `game-agent` later turns into `LevelSpatialMap` for the client.

**State and sessions.** `GameState` (`src/server/models/game-state.ts`) holds everything for one play session. Sessions live **in memory only** in `services/session-store.ts` (a `Map`) — restarting `npm run dev` loses all state. `EntityManager` tracks entities across `room | inventory | hidden` locations; `isRevealed` controls visibility for both the action checker and the client.

**Background room generation.** Only the start room layout is built synchronously before responding to `/api/game/start`. The rest become promises in `state.pendingRooms`; on `/api/game/move` the server `await`s the destination room's promise via `ensureRoomReady` if it's still pending. Adjacent rooms are prioritized over distant ones. This is why `setSession` is called repeatedly inside background `.then()` handlers — to commit incremental progress.

**Response cache (`services/response-cache.ts`).** Keyed by `(sessionId, action, entityId, roomId, chainIndex, sortedInventory)`. Same action in the same world state replays the cached narrative with a "you've tried this N times" wrapper. **Only non-state-changing actions are cached** (`look`, non-matching interactions); successful chain advances are deliberately uncached because the world state changes after.

**Tracing.** `Tracer` in `services/tracer.ts` is OTel-shaped (traceId/spanId/parentId, kind, attributes, status). Every API handler creates a tracer; agents call `startSpan`/`endSpan` and the tree is returned in the response under `trace`. Spans also broadcast over SSE on `/api/trace/stream` so the client `trace-logger` can stream them live. Background work uses `new Tracer(..., parentTraceId: tracer.traceId)` to stay attached to the parent transaction.

**Tile rendering.** Tilesets are NOT LLM-generated — `tile-artist.ts` programmatically builds 8x8 hex-color patterns from the `RoomStyle` palette produced by `style-agent`. The client receives `TileSet` (a record of `TilePattern`s keyed by cell type like `wall`, `floor`, `object`, `stairs_down`, …) and renders to canvas. `RoomLayout.cells` is a `CellType[][]` grid that indexes into the tileset.

**Client journey.** `src/client/journey.ts` caches each generated level by `levelId`; descending stairs generates a new level (room count + 1), ascending pulls the parent from cache instantly with no AI calls. The client engine (`src/client/engine/`) is a canvas game loop with a unified level grid, camera, lighting, and a player manager — `main.ts` is the entry point and wires everything together.

## Conventions worth knowing

- ESM throughout — imports use `.js` extensions even though the source is `.ts` (required by Node's NodeNext-style ESM resolution). Don't drop the extensions.
- Strict TypeScript, `moduleResolution: bundler`, `target: ES2022`. The server is bundled by `tsc`, the client by Vite (`root: src/client`).
- `js-yaml` loads `levels/*.yaml` at server startup via `loadLevels`.
- `npm run dev` reloads on server changes only. The Vite middleware HMRs client changes.

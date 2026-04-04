import type { TraceSpan, SpanKind } from "../../shared/types.js";

const KIND_COLORS: Record<SpanKind, string> = {
  server: "color: #4fc3f7",
  client: "color: #81c784",
  internal: "color: #b0bec5",
};

const AGENT_COLORS: Record<string, string> = {
  "game/start": "color: #4fc3f7; font-weight: bold",
  "game/move": "color: #81c784; font-weight: bold",
  "game/interact": "color: #ffb74d; font-weight: bold",
  "game/action": "color: #e57373; font-weight: bold",
  "room-generator": "color: #ba68c8",
  "level-architect": "color: #4dd0e1",
  "level-generator": "color: #aed581",
  "style-agent": "color: #f06292",
  "room-designer": "color: #aed581",
  "tile-artist": "color: #ff8a65",
  "narrator": "color: #dce775",
  "item-agent": "color: #9575cd",
  "quest-agent": "color: #80deea",
  "puzzle-system": "color: #a1887f",
  "dungeon-graph": "color: #4dd0e1",
  "spatial-map": "color: #90a4ae",
  "cache": "color: #00e676; font-weight: bold",
  "background-room": "color: #616161; font-style: italic",
  "background": "color: #616161; font-style: italic",
  "phase-1": "color: #ffab40",
  "phase-2": "color: #ffab40",
};

// --- Real-time SSE trace logging ---

export function initTraceStream(): void {
  const evtSource = new EventSource("/api/trace/stream");

  evtSource.addEventListener("span-start", (e) => {
    const d = JSON.parse(e.data);
    const style = AGENT_COLORS[d.agent] ?? KIND_COLORS[d.kind as SpanKind] ?? "color: #b0bec5";
    const kindTag = d.kind === "server" ? "[SRV]" : d.kind === "client" ? "[CLI]" : "[INT]";
    console.log(
      `%c${d.timestamp} ${kindTag} ▶ ${d.agent}.${d.method} [trace:${d.traceId?.slice(0, 8)}|span:${d.id?.slice(0, 8)}]`,
      style
    );
    if (d.reasoning) {
      console.log(`%c  → Why: ${d.reasoning}`, "color: #78909c; font-style: italic");
    }
    if (d.attributes && Object.keys(d.attributes).length > 3) {
      console.log("%c  → Attributes:", "color: #78909c", d.attributes);
    }
  });

  evtSource.addEventListener("span-end", (e) => {
    const d = JSON.parse(e.data);
    const style = AGENT_COLORS[d.agent] ?? KIND_COLORS[d.kind as SpanKind] ?? "color: #b0bec5";
    const kindTag = d.kind === "server" ? "[SRV]" : d.kind === "client" ? "[CLI]" : "[INT]";
    console.log(
      `%c${d.timestamp} ${kindTag} ✓ ${d.agent}.${d.method} (${d.duration}ms) [trace:${d.traceId?.slice(0, 8)}]`,
      style
    );
    if (d.output) {
      console.log("%c  ← Result:", "color: #78909c", d.output);
    }
  });

  evtSource.addEventListener("span-error", (e) => {
    const d = JSON.parse(e.data);
    console.log(
      `%c${d.timestamp} ✗ ${d.agent}.${d.method} — ${d.error} [trace:${d.traceId?.slice(0, 8)}]`,
      "color: #ef5350; font-weight: bold"
    );
  });

  evtSource.addEventListener("trace-complete", (e) => {
    const d = JSON.parse(e.data);
    console.log(
      `%c${d.timestamp} ━━ TRANSACTION ${d.agent}.${d.method} COMPLETE — ${d.totalDuration}ms, ${d.spanCount} spans [trace:${d.traceId?.slice(0, 8)}] ━━`,
      "color: #d4a574; font-weight: bold; font-size: 11px"
    );
  });

  evtSource.addEventListener("llm-call", (e) => {
    const d = JSON.parse(e.data);
    console.log(
      `%c⚡ [llm #${d.callId}] → ${d.model} | max_tokens=${d.maxTokens} | system=${d.systemChars}ch | msgs=${d.messageChars}ch | ${d.toolDesc || "mode=prompt-only"}`,
      "color: #80cbc4"
    );
  });

  evtSource.addEventListener("llm-result", (e) => {
    const d = JSON.parse(e.data);
    const secs = (d.elapsed / 1000).toFixed(1);
    console.log(
      `%c⚡ [llm #${d.callId}] ← ${secs}s | ${d.inputTokens} in / ${d.outputTokens} out | stop=${d.stopReason} | text=${d.textLength}ch${d.toolCalls.length > 0 ? ` | tools=[${d.toolCalls.join(", ")}]` : ""}`,
      "color: #80cbc4"
    );
  });

  evtSource.addEventListener("level-rooms", (e) => {
    const d = JSON.parse(e.data);
    console.group(`%c🏰 [level-generator] ${d.rooms.length} rooms | Theme: ${d.theme} | Mood: ${d.mood}`, "color: #aed581; font-weight: bold");
    console.log("%cCategory breakdown:", "color: #78909c", d.categories);
    for (const r of d.rooms) {
      const catStyle = r.category === "shrine" ? "color: #f06292" : r.category === "open-air" ? "color: #81c784" : "color: #90a4ae";
      console.log(`%c  ${r.id} "${r.name}" — ${r.category} (${r.size})`, catStyle);
    }
    console.groupEnd();
  });

  evtSource.onerror = () => {};
}

// --- Post-hoc full trace tree logging ---

export function logTrace(span: TraceSpan): void {
  console.log(
    "%c--- DUX Trace Tree [trace:%s] ---",
    "color: #d4a574; font-weight: bold; font-size: 12px",
    span.traceId?.slice(0, 8) ?? "?"
  );
  renderSpan(span, 0, true);
}

function renderSpan(span: TraceSpan, depth: number, isRoot = false): void {
  const dur = span.duration != null ? `${span.duration}ms` : span.endTime ? `${span.endTime - span.startTime}ms` : "running...";
  const style = AGENT_COLORS[span.agent] ?? "color: #b0bec5";
  const statusIcon = span.status === "completed" ? "✓" : span.status === "error" ? "✗" : "▶";
  const kindTag = span.kind === "server" ? "[SRV]" : span.kind === "client" ? "[CLI]" : "[INT]";
  const ts = new Date(span.startTime).toISOString().slice(11, 23);
  const hasChildren = span.children.length > 0;
  const label = `%c${ts} ${kindTag} ${statusIcon} ${span.agent}.${span.purpose} (${dur}) [span:${span.id?.slice(0, 8)}]`;

  if (hasChildren) {
    if (isRoot) console.group(label, style);
    else console.groupCollapsed(label, style);
  } else {
    console.log(label, style);
  }

  if (span.reasoning) console.log("%c  → Why: %s", "color: #78909c; font-style: italic", span.reasoning);
  if (span.input) console.log("%c  → Input:", "color: #78909c", span.input);
  if (span.output) console.log("%c  ← Result:", "color: #78909c", span.output);
  if (span.error) console.log("%c  ✗ Error: %s", "color: #ef5350; font-weight: bold", span.error);

  for (const child of span.children) renderSpan(child, depth + 1);
  if (hasChildren) console.groupEnd();
}

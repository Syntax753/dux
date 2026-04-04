import type { TraceSpan } from "../../shared/types.js";

const AGENT_COLORS: Record<string, string> = {
  "game/start": "color: #4fc3f7; font-weight: bold",
  "game/move": "color: #81c784; font-weight: bold",
  "game/interact": "color: #ffb74d; font-weight: bold",
  "game/action": "color: #e57373; font-weight: bold",
  "room-generator": "color: #ba68c8",
  "level-architect": "color: #4dd0e1",
  "style-agent": "color: #f06292",
  "room-designer": "color: #aed581",
  "tile-artist": "color: #ff8a65",
  "narrator": "color: #dce775",
  "item-agent": "color: #9575cd",
  "puzzle-system": "color: #a1887f",
  "room-art": "color: #90a4ae",
  "room-layout": "color: #90a4ae",
  "background": "color: #616161; font-style: italic",
  "background-wait": "color: #ffab00",
  "background-room": "color: #616161; font-style: italic",
  "cache": "color: #00e676; font-weight: bold",
};

// --- Real-time SSE trace logging ---

export function initTraceStream(): void {
  const evtSource = new EventSource("/api/trace/stream");

  evtSource.addEventListener("span-start", (e) => {
    const data = JSON.parse(e.data);
    const style = AGENT_COLORS[data.agent] ?? "color: #b0bec5";
    console.log(
      `%c▶ [${data.agent}] ${data.purpose}`,
      style
    );
    if (data.reasoning) {
      console.log(`%c  → Why: ${data.reasoning}`, "color: #78909c; font-style: italic");
    }
  });

  evtSource.addEventListener("span-end", (e) => {
    const data = JSON.parse(e.data);
    const style = AGENT_COLORS[data.agent] ?? "color: #b0bec5";
    console.log(
      `%c✓ [${data.agent}] ${data.purpose} (${(data.duration / 1000).toFixed(1)}s)`,
      style
    );
    if (data.output) {
      console.log("%c  ← Result:", "color: #78909c", data.output);
    }
  });

  evtSource.addEventListener("span-error", (e) => {
    const data = JSON.parse(e.data);
    console.log(
      `%c✗ [${data.agent}] ${data.purpose} — ${data.error}`,
      "color: #ef5350; font-weight: bold"
    );
  });

  evtSource.addEventListener("trace-complete", (e) => {
    const data = JSON.parse(e.data);
    const style = AGENT_COLORS[data.agent] ?? "color: #b0bec5";
    console.log(
      `%c━━ [${data.agent}] complete (${(data.duration / 1000).toFixed(1)}s total) ━━`,
      style
    );
  });

  evtSource.addEventListener("llm-call", (e) => {
    const d = JSON.parse(e.data);
    console.log(
      `%c⚡ [llm #${d.callId}] → ${d.model} | max_tokens=${d.maxTokens} | system=${d.systemChars}ch | msgs=${d.messageChars}ch | ${d.toolDesc || (d.tools.length > 0 ? `tools=[${d.tools.join(", ")}]` : "mode=prompt-only")}`,
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

  evtSource.onerror = () => {
    // SSE reconnects automatically — suppress noise
  };
}

// --- Post-hoc full trace tree logging (from API response) ---

export function logTrace(span: TraceSpan): void {
  console.log(
    "%c--- DUX Agent Trace (full) ---",
    "color: #d4a574; font-weight: bold; font-size: 12px"
  );
  renderSpan(span, 0, true);
}

function renderSpan(span: TraceSpan, depth: number, isRoot = false): void {
  const duration = span.endTime
    ? `${((span.endTime - span.startTime) / 1000).toFixed(1)}s`
    : "running...";

  const style = AGENT_COLORS[span.agent] ?? "color: #b0bec5";
  const statusIcon =
    span.status === "completed" ? "\u2713" :
    span.status === "error" ? "\u2717" : "\u25b6";

  const hasChildren = span.children.length > 0;
  const label = `%c${statusIcon} [${span.agent}] ${span.purpose} (${duration})`;

  if (hasChildren) {
    if (isRoot) {
      console.group(label, style);
    } else {
      console.groupCollapsed(label, style);
    }
  } else {
    console.log(label, style);
  }

  if (span.reasoning) {
    console.log("%c  → Why: %s", "color: #78909c; font-style: italic", span.reasoning);
  }
  if (span.input) {
    console.log("%c  → Input:", "color: #78909c", span.input);
  }
  if (span.output) {
    console.log("%c  ← Result:", "color: #78909c", span.output);
  }
  if (span.error) {
    console.log("%c  ✗ Error: %s", "color: #ef5350; font-weight: bold", span.error);
  }

  for (const child of span.children) {
    renderSpan(child, depth + 1);
  }

  if (hasChildren) {
    console.groupEnd();
  }
}

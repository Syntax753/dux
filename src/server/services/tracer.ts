import type { TraceSpan } from "../../shared/types.js";
import { v4 as uuid } from "uuid";
import http from "http";

// Global SSE connections per session (or global for now)
const sseClients = new Set<http.ServerResponse>();

export function addSSEClient(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

export function broadcastSSE(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

export class Tracer {
  private spans = new Map<string, TraceSpan>();
  private root: TraceSpan;

  constructor(agent: string, purpose: string) {
    this.root = {
      id: uuid(),
      agent,
      purpose,
      startTime: Date.now(),
      children: [],
      status: "running",
    };
    this.spans.set(this.root.id, this.root);
    broadcastSSE("span-start", { id: this.root.id, agent, purpose });
    console.log(`[trace] ▶ ${agent}: ${purpose}`);
  }

  startSpan(
    agent: string,
    purpose: string,
    parentId?: string,
    reasoning?: string,
    input?: unknown
  ): TraceSpan {
    const span: TraceSpan = {
      id: uuid(),
      parentId: parentId ?? this.root.id,
      agent,
      purpose,
      reasoning,
      startTime: Date.now(),
      children: [],
      status: "running",
      input: summarize(input),
    };

    this.spans.set(span.id, span);

    const parent = this.spans.get(span.parentId!);
    if (parent) {
      parent.children.push(span);
    }

    broadcastSSE("span-start", {
      id: span.id,
      parentId: span.parentId,
      agent,
      purpose,
      reasoning,
    });

    console.log(`[trace] ▶ ${agent}: ${purpose}${reasoning ? ` — ${reasoning}` : ""}`);
    return span;
  }

  endSpan(spanId: string, output?: unknown): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.endTime = Date.now();
    span.status = "completed";
    span.output = summarize(output);
    const duration = span.endTime - span.startTime;

    broadcastSSE("span-end", {
      id: spanId,
      agent: span.agent,
      purpose: span.purpose,
      duration,
      output: span.output,
    });

    console.log(`[trace] ✓ ${span.agent}: ${span.purpose} (${duration}ms)`);
  }

  errorSpan(spanId: string, error: string): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.endTime = Date.now();
    span.status = "error";
    span.error = error;

    broadcastSSE("span-error", {
      id: spanId,
      agent: span.agent,
      purpose: span.purpose,
      error,
    });

    console.log(`[trace] ✗ ${span.agent}: ${span.purpose} — ${error}`);
  }

  finish(): TraceSpan {
    this.root.endTime = Date.now();
    this.root.status = this.root.children.some((c) => c.status === "error")
      ? "error"
      : "completed";

    broadcastSSE("trace-complete", {
      id: this.root.id,
      agent: this.root.agent,
      duration: this.root.endTime - this.root.startTime,
    });

    return this.root;
  }

  get rootId(): string {
    return this.root.id;
  }
}

function summarize(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const str = JSON.stringify(value);
  if (str.length <= 500) return value;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    return { _summary: `Object with ${keys.length} keys: ${keys.join(", ")}`, _truncated: true };
  }
  if (typeof value === "string") {
    return value.slice(0, 200) + "...";
  }
  return { _summary: "Large payload", _truncated: true };
}

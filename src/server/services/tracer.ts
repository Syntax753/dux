import type { TraceSpan, SpanKind, SpanAttributes } from "../../shared/types.js";
import { v4 as uuid } from "uuid";
import http from "http";

// --- SSE ---

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

// --- Tracer ---
// OpenTelemetry-style distributed tracing.
// traceId = transaction ID (same for all spans in one request)
// id = span ID (unique per span)
// kind = server | client | internal

export class Tracer {
  private spans = new Map<string, TraceSpan>();
  private root: TraceSpan;
  readonly traceId: string;

  constructor(service: string, method: string, kind: SpanKind = "server") {
    this.traceId = uuid();
    const now = Date.now();

    this.root = {
      traceId: this.traceId,
      id: uuid(),
      agent: service,
      purpose: method,
      kind,
      attributes: { "otel.service": service, "otel.method": method, "span.kind": kind },
      startTime: now,
      children: [],
      status: "running",
    };

    this.spans.set(this.root.id, this.root);

    const ts = new Date(now).toISOString().slice(11, 23);
    broadcastSSE("span-start", {
      traceId: this.traceId,
      id: this.root.id,
      agent: service,
      method,
      kind,
      timestamp: ts,
    });
    console.log(`[${ts}] [trace:${this.traceId.slice(0, 8)}] ▶ ${service}.${method} (${kind})`);
  }

  startSpan(
    service: string,
    method: string,
    parentId?: string,
    reasoning?: string,
    attrs?: SpanAttributes,
    kind: SpanKind = "internal"
  ): TraceSpan {
    const now = Date.now();
    const span: TraceSpan = {
      traceId: this.traceId,
      id: uuid(),
      parentId: parentId ?? this.root.id,
      agent: service,
      purpose: method,
      reasoning,
      kind,
      attributes: {
        "otel.service": service,
        "otel.method": method,
        "span.kind": kind,
        ...attrs,
      },
      startTime: now,
      children: [],
      status: "running",
      input: undefined,
    };

    this.spans.set(span.id, span);

    const parent = this.spans.get(span.parentId!);
    if (parent) parent.children.push(span);

    const ts = new Date(now).toISOString().slice(11, 23);
    broadcastSSE("span-start", {
      traceId: this.traceId,
      id: span.id,
      parentId: span.parentId,
      agent: service,
      method,
      kind,
      reasoning,
      timestamp: ts,
      attributes: span.attributes,
    });

    const indent = this.getDepth(span.id);
    const pad = "  ".repeat(indent);
    console.log(`[${ts}] [trace:${this.traceId.slice(0, 8)}] ${pad}▶ ${service}.${method} (${kind})${reasoning ? ` — ${reasoning}` : ""}`);
    return span;
  }

  endSpan(spanId: string, output?: unknown): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    const now = Date.now();
    span.endTime = now;
    span.duration = now - span.startTime;
    span.status = "completed";
    span.output = summarize(output);

    const ts = new Date(now).toISOString().slice(11, 23);
    broadcastSSE("span-end", {
      traceId: this.traceId,
      id: spanId,
      agent: span.agent,
      method: span.purpose,
      kind: span.kind,
      duration: span.duration,
      output: span.output,
      timestamp: ts,
    });

    const indent = this.getDepth(spanId);
    const pad = "  ".repeat(indent);
    console.log(`[${ts}] [trace:${this.traceId.slice(0, 8)}] ${pad}✓ ${span.agent}.${span.purpose} (${span.duration}ms)`);
  }

  errorSpan(spanId: string, error: string): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    const now = Date.now();
    span.endTime = now;
    span.duration = now - span.startTime;
    span.status = "error";
    span.error = error;

    const ts = new Date(now).toISOString().slice(11, 23);
    broadcastSSE("span-error", {
      traceId: this.traceId,
      id: spanId,
      agent: span.agent,
      method: span.purpose,
      error,
      timestamp: ts,
    });

    const indent = this.getDepth(spanId);
    const pad = "  ".repeat(indent);
    console.log(`[${ts}] [trace:${this.traceId.slice(0, 8)}] ${pad}✗ ${span.agent}.${span.purpose} — ${error}`);
  }

  finish(): TraceSpan {
    const now = Date.now();
    this.root.endTime = now;
    this.root.duration = now - this.root.startTime;
    this.root.status = this.root.children.some((c) => c.status === "error") ? "error" : "completed";

    const ts = new Date(now).toISOString().slice(11, 23);
    broadcastSSE("trace-complete", {
      traceId: this.traceId,
      id: this.root.id,
      agent: this.root.agent,
      method: this.root.purpose,
      totalDuration: this.root.duration,
      spanCount: this.spans.size,
      timestamp: ts,
    });

    console.log(`[${ts}] [trace:${this.traceId.slice(0, 8)}] ━━ ${this.root.agent}.${this.root.purpose} COMPLETE (${this.root.duration}ms, ${this.spans.size} spans) ━━`);
    return this.root;
  }

  get rootId(): string {
    return this.root.id;
  }

  private getDepth(spanId: string): number {
    let depth = 0;
    let current = this.spans.get(spanId);
    while (current?.parentId) {
      depth++;
      current = this.spans.get(current.parentId);
    }
    return depth;
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

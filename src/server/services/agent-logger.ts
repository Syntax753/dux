// Standard agent logging interface.
// Every agent call logs: [timestamp] [trace:xxxx|span:xxxx] [SERVICE.METHOD] (kind) message
// Tools[] shows which sub-agents/services are being invoked.

import { broadcastSSE } from "./tracer.js";

export interface AgentContext {
  traceId: string;
  spanId: string;
  service: string;
  method: string;
  kind: "server" | "client" | "internal";
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function prefix(ctx: AgentContext): string {
  return `[${ts()}] [trace:${ctx.traceId.slice(0, 8)}|span:${ctx.spanId.slice(0, 8)}] [${ctx.service}.${ctx.method}]`;
}

export const agentLog = {
  // Agent starting — log what tools/sub-agents it will use
  start(ctx: AgentContext, tools: string[], reasoning?: string): void {
    const toolStr = tools.length > 0 ? `tools=[${tools.join(", ")}]` : "tools=[none]";
    const msg = `${prefix(ctx)} (${ctx.kind}) START ${toolStr}${reasoning ? ` — ${reasoning}` : ""}`;
    console.log(msg);
    broadcastSSE("agent-log", {
      type: "start",
      timestamp: ts(),
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      service: ctx.service,
      method: ctx.method,
      kind: ctx.kind,
      tools,
      reasoning,
    });
  },

  // Agent calling a sub-agent or tool
  call(ctx: AgentContext, target: string, reason: string): void {
    const msg = `${prefix(ctx)} (${ctx.kind}) CALL → ${target} — ${reason}`;
    console.log(msg);
    broadcastSSE("agent-log", {
      type: "call",
      timestamp: ts(),
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      service: ctx.service,
      method: ctx.method,
      kind: ctx.kind,
      target,
      reason,
    });
  },

  // Agent received a result from a sub-agent
  result(ctx: AgentContext, source: string, summary: string): void {
    const msg = `${prefix(ctx)} (${ctx.kind}) RESULT ← ${source} — ${summary}`;
    console.log(msg);
    broadcastSSE("agent-log", {
      type: "result",
      timestamp: ts(),
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      service: ctx.service,
      method: ctx.method,
      kind: ctx.kind,
      source,
      summary,
    });
  },

  // Agent completed
  done(ctx: AgentContext, summary: string, durationMs: number): void {
    const msg = `${prefix(ctx)} (${ctx.kind}) DONE (${durationMs}ms) — ${summary}`;
    console.log(msg);
    broadcastSSE("agent-log", {
      type: "done",
      timestamp: ts(),
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      service: ctx.service,
      method: ctx.method,
      kind: ctx.kind,
      summary,
      durationMs,
    });
  },

  // Agent error
  error(ctx: AgentContext, error: string): void {
    const msg = `${prefix(ctx)} (${ctx.kind}) ERROR — ${error}`;
    console.error(msg);
    broadcastSSE("agent-log", {
      type: "error",
      timestamp: ts(),
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      service: ctx.service,
      method: ctx.method,
      kind: ctx.kind,
      error,
    });
  },

  // Create a context from a Tracer span
  fromSpan(traceId: string, spanId: string, service: string, method: string, kind: "server" | "client" | "internal" = "server"): AgentContext {
    return { traceId, spanId, service, method, kind };
  },
};

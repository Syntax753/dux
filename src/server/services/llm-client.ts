import { spawn } from "child_process";
import { broadcastSSE } from "./tracer.js";

// --- Types matching the Anthropic Messages API ---

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlockParam[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

interface ApiResponse {
  content: ContentBlock[];
  stop_reason: string | null;
}

export interface AgentResponse {
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  stopReason: string | null;
}

// --- Mode dispatch ---
// VITE_AI_MODE selects how LLM calls are routed:
//   live (default) — shells out to the `claude` CLI, uses local Claude account, no API key needed
//   mock           — deterministic stub responses for tests (no LLM calls)
//   api            — direct fetch to api.anthropic.com using ANTHROPIC_API_KEY

const AI_MODE = (process.env.VITE_AI_MODE ?? "live").toLowerCase();

const API_URL = "https://api.anthropic.com/v1/messages";

function getApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

let callCount = 0;

function preview(s: string, n: number = 220): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

function lastUserMessage(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const text = m.content
      .map((b) => ("type" in b && b.type === "text" ? b.text : ""))
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

export async function callAgent(
  caller: string,
  systemPrompt: string,
  messages: MessageParam[],
  tools?: Tool[],
  model: string = "claude-sonnet-4-20250514",
  maxTokens: number = 1024
): Promise<AgentResponse> {
  callCount++;
  const callId = callCount;

  const systemChars = systemPrompt.length;
  const msgChars = JSON.stringify(messages).length;
  const toolNames = tools?.map((t) => t.name) ?? [];
  const toolDesc = toolNames.length > 0 ? `tools=[${toolNames.join(", ")}]` : "tools=none";

  const sysPrev = preview(systemPrompt);
  const userPrev = preview(lastUserMessage(messages));

  console.log(
    `[llm #${callId} ▶ ${caller}] mode=${AI_MODE} model=${model} max_tokens=${maxTokens} ` +
    `system=${systemChars}ch messages=${msgChars}ch ${toolDesc}\n` +
    `    system › "${sysPrev}"\n` +
    `    user   › "${userPrev}"`
  );
  broadcastSSE("llm-call", {
    callId, caller, model, maxTokens,
    systemChars, messageChars: msgChars,
    tools: toolNames, mode: AI_MODE,
    systemPreview: sysPrev, userPreview: userPrev,
  });

  const startTime = Date.now();
  let response: AgentResponse;
  try {
    if (AI_MODE === "mock") {
      response = callMock(systemPrompt, messages, tools);
    } else if (AI_MODE === "api") {
      response = await callApi(systemPrompt, messages, tools, model, maxTokens);
    } else {
      response = await callCli(systemPrompt, messages, tools, model, maxTokens);
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errMsg = (err as Error).message.slice(0, 200);
    console.log(`[llm #${callId} ✗ ${caller}] ${elapsed}ms: ${errMsg}`);
    broadcastSSE("llm-error", { callId, caller, elapsed, error: errMsg });
    throw err;
  }

  const elapsed = Date.now() - startTime;
  const toolCallNames = response.toolCalls.map((t) => t.name);
  const respPrev = preview(response.text);
  const tcSummary = toolCallNames.length > 0 ? ` tool_calls=[${toolCallNames.join(", ")}]` : "";
  console.log(
    `[llm #${callId} ◀ ${caller}] ${elapsed}ms stop=${response.stopReason} text=${response.text.length}ch${tcSummary}\n` +
    `    response › "${respPrev}"`
  );
  broadcastSSE("llm-result", {
    callId, caller, elapsed, stopReason: response.stopReason,
    textLength: response.text.length, toolCalls: toolCallNames,
    responsePreview: respPrev,
  });

  return response;
}

// --- API mode (direct fetch) ---

async function callApi(
  systemPrompt: string,
  messages: MessageParam[],
  tools: Tool[] | undefined,
  model: string,
  maxTokens: number
): Promise<AgentResponse> {
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, system: systemPrompt, messages };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(API_URL, { method: "POST", headers: getApiHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as ApiResponse;

  const text = data.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls = data.content
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

  return { text, toolCalls, stopReason: data.stop_reason };
}

// --- Live mode (claude CLI) ---

function modelToCliAlias(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  return "sonnet";
}

const TOOL_PROTOCOL_HEADER = `# CRITICAL: Tool Invocation Protocol

You are running inside an automated harness. The ONLY way for tools to actually execute is for you to emit them in the \`tool_calls\` array of your JSON response. The harness will then execute each tool and feed the results back to you in the next turn as \`<tool_result>\` blocks.

**You cannot run tools yourself. You cannot pretend you ran them.** Listing them in \`text\` does nothing. Only entries in \`tool_calls\` are executed.

Each turn you respond with this exact JSON shape:
{"text": "<your reasoning, optional>", "tool_calls": [{"name": "<tool>", "input": {...}}, ...]}

- To run one or more tools this turn: put them in \`tool_calls\`.
- When you are completely finished and want to stop: emit \`{"text": "<final answer>", "tool_calls": []}\`. Empty \`tool_calls\` ends the loop.
- Never describe in \`text\` what tools you "would" call. If you want it run, put it in \`tool_calls\`.

Available tools:
{TOOLS_JSON}

`;

function serializeMessages(messages: MessageParam[]): string {
  return messages
    .map((m) => {
      if (typeof m.content === "string") {
        return `[${m.role}]\n${m.content}`;
      }
      const parts = m.content.map((block) => {
        if ("type" in block && block.type === "tool_use") {
          return `<tool_use name="${block.name}" id="${block.id}">${JSON.stringify(block.input)}</tool_use>`;
        }
        if ("type" in block && block.type === "tool_result") {
          return `<tool_result for="${block.tool_use_id}">${block.content}</tool_result>`;
        }
        if ("type" in block && block.type === "text") {
          return block.text;
        }
        return JSON.stringify(block);
      });
      return `[${m.role}]\n${parts.join("\n")}`;
    })
    .join("\n\n");
}

function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "");
  return t.trim();
}

async function callCli(
  systemPrompt: string,
  messages: MessageParam[],
  tools: Tool[] | undefined,
  model: string,
  _maxTokens: number
): Promise<AgentResponse> {
  const hasTools = !!(tools && tools.length > 0);
  // Put the protocol FIRST so it dominates the system prompt and isn't lost at the tail of long agent prompts.
  const fullSystem = hasTools
    ? TOOL_PROTOCOL_HEADER.replace("{TOOLS_JSON}", JSON.stringify(tools, null, 2)) + systemPrompt
    : systemPrompt;

  const userPrompt = serializeMessages(messages);

  const args = [
    "--print",
    "--model", modelToCliAlias(model),
    "--system-prompt", fullSystem,
    "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];

  // When tools are in play, constrain the response to the envelope schema so
  // the model can't drift back into prose. Without this, larger system prompts
  // (e.g. game-agent) cause it to narrate a plan instead of emitting tool calls.
  if (hasTools) {
    const envelopeSchema = {
      type: "object",
      properties: {
        text: { type: "string" },
        tool_calls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              input: { type: "object" },
            },
            required: ["name", "input"],
          },
        },
      },
      required: ["text", "tool_calls"],
    };
    args.push("--json-schema", JSON.stringify(envelopeSchema));
  }

  const stdout = await runClaudeCli(args, userPrompt);

  let parsed: { result?: string; is_error?: boolean; stop_reason?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI returned non-JSON: ${stdout.slice(0, 200)}`);
  }

  if (parsed.is_error) {
    throw new Error(`claude CLI error: ${parsed.result ?? "unknown"}`);
  }

  const rawText = parsed.result ?? "";

  if (!hasTools) {
    return { text: rawText, toolCalls: [], stopReason: parsed.stop_reason ?? "end_turn" };
  }

  // Parse the tool-use protocol envelope
  let envelope: { text?: string; tool_calls?: Array<{ name: string; input: Record<string, unknown> }> };
  try {
    envelope = JSON.parse(stripJsonFences(rawText));
  } catch {
    // Model didn't follow protocol — treat as final text
    return { text: rawText, toolCalls: [], stopReason: "end_turn" };
  }

  const toolCalls = (envelope.tool_calls ?? []).map((tc, i) => ({
    id: `cli_tool_${Date.now()}_${i}`,
    name: tc.name,
    input: tc.input ?? {},
  }));

  return {
    text: envelope.text ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
  };
}

function runClaudeCli(args: string[], stdinData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Strip ANTHROPIC_API_KEY so the CLI falls back to the user's local Claude account
    // (OAuth / keychain). Otherwise an invalid or stale key in .env would cause 401.
    const { ANTHROPIC_API_KEY: _omit, ...env } = process.env;
    void _omit;
    const proc = spawn("claude", args, { shell: false, windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

// --- Mock mode ---

function callMock(
  systemPrompt: string,
  _messages: MessageParam[],
  tools: Tool[] | undefined
): AgentResponse {
  // Tool agents: call `finalize` if available so loops terminate, else first tool with empty input
  if (tools && tools.length > 0) {
    const terminator = tools.find((t) => /finalize|done|complete/i.test(t.name)) ?? tools[0];
    return {
      text: "",
      toolCalls: [
        {
          id: `mock_${Date.now()}`,
          name: terminator.name,
          input: { reasoning: "mock", summary: "mock", roomCount: 1 },
        },
      ],
      stopReason: "tool_use",
    };
  }

  // Heuristic: if the system prompt asks for JSON, return an empty object so callers fall through to their fallback paths
  if (/json/i.test(systemPrompt)) {
    return { text: "{}", toolCalls: [], stopReason: "end_turn" };
  }
  return { text: "[mock response]", toolCalls: [], stopReason: "end_turn" };
}

// Run a full agent loop: call -> tool use -> tool result -> call again until done
export async function runAgentLoop(
  caller: string,
  systemPrompt: string,
  messages: MessageParam[],
  tools: Tool[],
  executeToolFn: (
    name: string,
    input: Record<string, unknown>
  ) => unknown | Promise<unknown>,
  model?: string,
  maxTokens?: number
): Promise<string> {
  const conversationMessages = [...messages];
  let finalText = "";

  for (let i = 0; i < 10; i++) {
    const response = await callAgent(
      `${caller}#${i + 1}`,
      systemPrompt,
      conversationMessages,
      tools,
      model,
      maxTokens
    );

    if (response.toolCalls.length === 0) {
      finalText = response.text;
      break;
    }

    const assistantContent: ContentBlock[] = [];
    if (response.text) {
      assistantContent.push({ type: "text", text: response.text });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    conversationMessages.push({ role: "assistant", content: assistantContent });

    const toolResults: ToolResultBlockParam[] = [];
    for (const tc of response.toolCalls) {
      const result = await Promise.resolve(executeToolFn(tc.name, tc.input));
      toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: JSON.stringify(result) });
    }
    conversationMessages.push({ role: "user", content: toolResults });

    if (response.stopReason === "end_turn" && response.text) {
      finalText = response.text;
      break;
    }
  }

  return finalText;
}

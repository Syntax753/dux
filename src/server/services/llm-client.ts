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

// --- API call via fetch (works server-side with key, artifact-side without) ---

const API_URL = "https://api.anthropic.com/v1/messages";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  // Server mode: include API key. Artifact mode: proxy handles auth.
  const apiKey = typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

// Track call count for debug
let callCount = 0;

export async function callAgent(
  systemPrompt: string,
  messages: MessageParam[],
  tools?: Tool[],
  model: string = "claude-sonnet-4-20250514",
  maxTokens: number = 1024
): Promise<AgentResponse> {
  callCount++;
  const callId = callCount;

  // Debug: log tool selection and config
  const promptChars = systemPrompt.length;
  const msgChars = JSON.stringify(messages).length;
  const toolNames = tools?.map((t) => t.name) ?? [];

  const callInfo = {
    callId,
    model,
    maxTokens,
    systemChars: promptChars,
    messageChars: msgChars,
    tools: toolNames,
  };
  console.log(
    `[llm #${callId}] → model=${model} max_tokens=${maxTokens} ` +
    `system=${promptChars}ch messages=${msgChars}ch ` +
    `tools=[${toolNames.length > 0 ? toolNames.join(", ") : "none"}]`
  );
  broadcastSSE("llm-call", callInfo);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const startTime = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const elapsed = Date.now() - startTime;

  if (!res.ok) {
    const err = await res.text();
    console.log(`[llm #${callId}] ✗ ${res.status} after ${elapsed}ms: ${err.slice(0, 200)}`);
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as ApiResponse & { usage?: { input_tokens?: number; output_tokens?: number } };

  const text = data.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");

  const toolCalls = data.content
    .filter(
      (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
        block.type === "tool_use"
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const toolCallNames = toolCalls.map((t) => t.name);

  const resultInfo = {
    callId,
    elapsed,
    inputTokens,
    outputTokens,
    stopReason: data.stop_reason,
    textLength: text.length,
    toolCalls: toolCallNames,
  };
  console.log(
    `[llm #${callId}] ← ${elapsed}ms | ${inputTokens} in / ${outputTokens} out | ` +
    `stop=${data.stop_reason} | text=${text.length}ch` +
    (toolCallNames.length > 0 ? ` | tool_calls=[${toolCallNames.join(", ")}]` : "")
  );
  broadcastSSE("llm-result", resultInfo);

  return { text, toolCalls, stopReason: data.stop_reason };
}

// Run a full agent loop: call -> tool use -> tool result -> call again until done
export async function runAgentLoop(
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
    // max 10 iterations
    const response = await callAgent(
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

    // Build the assistant message with all content blocks
    const assistantContent: ContentBlock[] = [];

    if (response.text) {
      assistantContent.push({ type: "text", text: response.text });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    conversationMessages.push({ role: "assistant", content: assistantContent });

    // Execute tools and build results
    const toolResults: ToolResultBlockParam[] = [];
    for (const tc of response.toolCalls) {
      const result = await Promise.resolve(executeToolFn(tc.name, tc.input));
      toolResults.push({
        type: "tool_result" as const,
        tool_use_id: tc.id,
        content: JSON.stringify(result),
      });
    }

    conversationMessages.push({ role: "user", content: toolResults });

    // If stop reason was end_turn with text, we're done
    if (response.stopReason === "end_turn" && response.text) {
      finalText = response.text;
      break;
    }
  }

  return finalText;
}

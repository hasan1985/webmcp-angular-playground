import type Anthropic from '@anthropic-ai/sdk';

/**
 * The bridge between WebMCP and the LLM.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS FILE ENFORCES
 *
 * The chat may only learn about tools through `document.modelContext.getTools()`,
 * and may only run them through `executeTool()`. It must never import GameStore,
 * NotesStore, or any other feature service.
 *
 * If the chat called the app's services directly, the demo would work exactly the
 * same with WebMCP deleted — and would therefore prove nothing. Keeping discovery
 * and invocation on the browser API is what makes the chat a faithful stand-in for
 * a real agent, which is the *actual* WebMCP consumer. Resist the temptation to
 * "just import the store" when debugging.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The optional Chromium methods, which the polyfill also implements. */
interface ExecuteCapableModelContext {
  getTools(): Promise<readonly RegisteredToolLike[]>;
  executeTool?(tool: RegisteredToolLike, inputArgumentsJson: string): Promise<string | null>;
}

interface RegisteredToolLike {
  name: string;
  title?: string;
  description: string;
  /**
   * Two generations in the wild: a serialized JSON string on Chrome 149–153 (most
   * of the current origin-trial population), an object from Chrome 154.0.8013
   * onwards. Branch on `typeof` and guard the parse — see `normalizeSchema`.
   */
  inputSchema?: unknown;
}

function modelContext(): ExecuteCapableModelContext | null {
  if (typeof document === 'undefined') return null;
  const ctx = document.modelContext ?? navigator.modelContext;
  return (ctx as ExecuteCapableModelContext | undefined) ?? null;
}

export function isWebMcpAvailable(): boolean {
  return modelContext() !== null;
}

/** Handles both schema generations. Returns a permissive schema if it can't parse. */
function normalizeSchema(schema: unknown): Anthropic.Tool.InputSchema {
  let value = schema;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (value && typeof value === 'object') {
    return value as Anthropic.Tool.InputSchema;
  }
  return {type: 'object', properties: {}};
}

/**
 * Discovers whatever tools the page currently exposes and translates them into
 * Anthropic tool definitions. The mapping is nearly one-to-one — WebMCP and the
 * Messages API agree on name, description, and a JSON Schema for the input — which
 * is a large part of why WebMCP is interesting.
 *
 * Called before *every* turn, not once at startup: the tool list is live, so tools
 * appear and disappear as the user navigates.
 */
export async function discoverTools(): Promise<Anthropic.Tool[]> {
  const ctx = modelContext();
  if (!ctx) return [];

  const tools = await ctx.getTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: normalizeSchema(tool.inputSchema),
  }));
}

/**
 * Runs one tool by name and returns a string for the `tool_result` block.
 *
 * Errors are returned as text rather than thrown. An agent that is told *why* a
 * call failed can correct itself; an exception just ends the turn.
 */
export async function runTool(name: string, input: unknown): Promise<{text: string; isError: boolean}> {
  const ctx = modelContext();
  if (!ctx) {
    return {text: 'WebMCP is not available in this browser.', isError: true};
  }

  const tool = (await ctx.getTools()).find((t) => t.name === name);
  if (!tool) {
    return {text: `No tool named "${name}" is currently registered.`, isError: true};
  }

  if (typeof ctx.executeTool !== 'function') {
    // executeTool is a Chromium extension, not part of the W3C surface. The
    // polyfill supplies it; without either, discovery works but invocation cannot.
    return {
      text: 'This browser exposes WebMCP tools but cannot execute them (no executeTool). Install the polyfill.',
      isError: true,
    };
  }

  try {
    const result = await ctx.executeTool(tool, JSON.stringify(input ?? {}));
    return {text: result ?? '(the tool returned nothing)', isError: false};
  } catch (error) {
    return {text: `Tool "${name}" failed: ${(error as Error).message}`, isError: true};
  }
}

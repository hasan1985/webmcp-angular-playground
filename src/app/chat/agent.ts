import Anthropic from '@anthropic-ai/sdk';

import {discoverTools, runTool} from './webmcp-bridge';

export const DEFAULT_MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You are an assistant embedded in a web page. The page exposes its own
capabilities to you as tools via WebMCP; the available tools change as the user navigates, so
rely on the tool list you are given on each turn rather than remembering what existed earlier.

Read state before you change it. If a tool call is rejected, the result explains why — read it
and correct your next call rather than repeating the same one. Keep replies short.`;

/** What the UI renders. Tool activity is surfaced so the demo is legible. */
export type Entry =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  | {kind: 'tool'; name: string; input: unknown; result: string; isError: boolean}
  | {kind: 'error'; text: string};

export interface RunOptions {
  apiKey: string;
  model?: string;
  history: Anthropic.MessageParam[];
  userMessage: string;
  /** Called as the turn progresses, so the UI can stream activity in. */
  onEntry: (entry: Entry) => void;
  signal?: AbortSignal;
}

/**
 * One turn of the agent loop.
 *
 * A **manual** loop rather than the SDK's tool runner, deliberately: the runner
 * wants tools with local `run` functions declared up front, but these tools are
 * discovered at runtime from the page and executed through WebMCP. The manual loop
 * keeps that indirection visible, which is the thing being demonstrated.
 *
 * Returns the updated history so the caller can carry it into the next turn.
 */
export async function runTurn(options: RunOptions): Promise<Anthropic.MessageParam[]> {
  const {apiKey, model = DEFAULT_MODEL, userMessage, onEntry, signal} = options;

  const client = new Anthropic({
    apiKey,
    // Required to call the API from a browser. Acceptable here because the key is
    // the user's own, entered at runtime and never persisted beyond this tab —
    // see the warning in the chat panel. Do NOT do this in a product: ship a
    // backend that holds the key instead.
    dangerouslyAllowBrowser: true,
  });

  const messages: Anthropic.MessageParam[] = [...options.history, {role: 'user', content: userMessage}];

  // Re-discovered every turn: the tool list is live.
  const tools = await discoverTools();

  // Bounded so a confused model cannot loop forever on the user's dime.
  for (let iteration = 0; iteration < 10; iteration++) {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      },
      {signal},
    );

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        onEntry({kind: 'assistant', text: block.text});
      }
    }

    if (response.stop_reason === 'refusal') {
      onEntry({
        kind: 'error',
        text: `The model declined this request (${response.stop_details?.category ?? 'unspecified'}).`,
      });
      return messages;
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      messages.push({role: 'assistant', content: response.content});
      return messages;
    }

    messages.push({role: 'assistant', content: response.content});

    // Run every requested tool, then return ALL results in ONE user message.
    // Splitting them across several messages quietly teaches the model to stop
    // making parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const {text, isError} = await runTool(use.name, use.input);
      onEntry({kind: 'tool', name: use.name, input: use.input, result: text, isError});
      results.push({type: 'tool_result', tool_use_id: use.id, content: text, is_error: isError});
    }
    messages.push({role: 'user', content: results});
  }

  onEntry({kind: 'error', text: 'Stopped after 10 tool rounds without a final answer.'});
  return messages;
}

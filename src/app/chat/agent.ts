import Anthropic from '@anthropic-ai/sdk';

import {discoverTools, runTool} from './webmcp-bridge';

export const DEFAULT_MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You are an assistant embedded in a web page. The page exposes its own
capabilities to you as tools via WebMCP; the available tools change as the user navigates, so
rely on the tool list you are given on each turn rather than remembering what existed earlier.

Read state before you change it. If a tool call is rejected, the result explains why — read it
and correct your next call rather than repeating the same one. Keep replies short.`;

/**
 * Turns an SDK error into something a person can act on.
 *
 * The raw 401 body — `{"type":"error","error":{"type":"authentication_error",
 * "message":"invalid x-api-key"}}` — is accurate and useless. It does not say which
 * key was rejected, by whom, or where to get a working one, and the most common
 * cause here is pasting a credential that was never an Anthropic API key at all.
 */
export function describeError(error: unknown): string {
  const status = (error as {status?: number})?.status;

  if (status === 401) {
    return [
      'api.anthropic.com rejected this key.',
      '',
      'This panel calls Anthropic directly — it does not go through any local proxy,',
      'so a proxy key (like the one you set as PROXY_API_KEY) or a Claude Code login',
      'will always fail here. Those are different credentials entirely.',
      '',
      'You need a key from console.anthropic.com → API keys. It starts with',
      '"sk-ant-api03-" and is billed separately from a Claude subscription.',
      '',
      'Your message was not sent — retype it once the key is working.',
    ].join('\n');
  }

  if (status === 403) {
    return 'That key is valid but not permitted to use this model. Check the key\'s workspace and permissions in the Anthropic console.\n\nYour message was not sent.';
  }
  if (status === 429) {
    return 'Rate limited by Anthropic. Wait a moment and try again.\n\nYour message was not sent.';
  }
  if (typeof status === 'number' && status >= 500) {
    return `Anthropic returned a server error (${status}). This is usually transient.\n\nYour message was not sent.`;
  }
  if (status === 404) {
    return [
      'The endpoint returned 404 for /v1/messages.',
      '',
      'A custom API URL has to speak the Anthropic Messages API. An',
      'OpenAI-compatible endpoint (/v1/chat/completions) is a different shape and',
      'will not work here.',
      '',
      'Your message was not sent.',
    ].join('\n');
  }
  // The SDK reports anything that never completed — DNS, refused connection, and
  // crucially a CORS rejection — as a bare "Connection error." with no status. From
  // a browser that is almost always CORS, and the browser deliberately hides the
  // detail, so the message has to name the likely cause itself.
  const connectionFailed =
    error instanceof TypeError ||
    status === undefined && /connection error/i.test((error as Error)?.message ?? '');

  if (connectionFailed) {
    return [
      'Could not reach the API.',
      '',
      'If you set a custom API URL, the usual cause is CORS: the server has to send',
      'Access-Control-Allow-Origin for this page, and answer the preflight OPTIONS',
      'request. A plain local server will not do that by default, and the browser',
      'hides the real reason.',
      '',
      'Note that the URL must also speak the Anthropic Messages API. An',
      'OpenAI-compatible proxy (/v1/chat/completions) is a different shape and cannot',
      'drive this chat even once CORS is fixed — it cannot emit tool calls, which is',
      'the whole point of this panel.',
      '',
      'Your message was not sent.',
    ].join('\n');
  }

  return `${(error as Error)?.message ?? String(error)}\n\nYour message was not sent.`;
}

/** What the UI renders. Tool activity is surfaced so the demo is legible. */
export type Entry =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  | {kind: 'tool'; name: string; input: unknown; result: string; isError: boolean}
  | {kind: 'error'; text: string};

export interface RunOptions {
  apiKey: string;
  /**
   * Override the API host. Must speak the **Anthropic Messages API** — an
   * OpenAI-compatible endpoint will not work, the shapes are different.
   */
  baseUrl?: string;
  /**
   * Identifies this conversation to a backend that supports threading.
   * Anthropic itself ignores it — the real API is stateless and the client
   * replays history, which this code does regardless. A proxy can use it to
   * relay each turn into one long-lived session instead.
   */
  conversationId?: string;
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
  const {apiKey, baseUrl, conversationId, model = DEFAULT_MODEL, userMessage, onEntry, signal} =
    options;

  const client = new Anthropic({
    apiKey,
    ...(baseUrl ? {baseURL: baseUrl} : {}),
    ...(conversationId ? {defaultHeaders: {'X-Conversation-Id': conversationId}} : {}),
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

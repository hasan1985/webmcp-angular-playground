import Anthropic from '@anthropic-ai/sdk';

import {discoverTools, runTool} from './webmcp-bridge';

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Conventional name for a tool carrying app-level context. Read once per chat
 * session and folded into the system prompt — see `Chat.appContextFor()`.
 */
export const APP_CONTEXT_TOOL = 'about_this_app';

const SYSTEM_PROMPT = `You are an assistant embedded in a web page. The page exposes its own
capabilities to you as tools via WebMCP; the available tools change as the user navigates, so
rely on the tool list you are given on each turn rather than remembering what existed earlier.

Read state before you change it. If a tool call is rejected, the result explains why — read it
and correct your next call rather than repeating the same one. Keep replies short.`;

/**
 * The prompt for a turn with tools switched off. Swapped together with the `tools`
 * key: a tool-aware prompt with no tools makes the model offer to do things it
 * cannot, or narrate calls it never made.
 */
const PLAIN_SYSTEM_PROMPT = `You are an assistant embedded in a web page. You cannot see or
change anything on the page — you have no tools this turn. If the user asks about the page's
state, say plainly that you cannot see it. Keep replies short.`;

/**
 * Turns an SDK error into something a person can act on.
 *
 * The raw 401 body — `{"type":"error","error":{"type":"authentication_error",
 * "message":"invalid x-api-key"}}` — is accurate and useless. It does not say which
 * key was rejected, by whom, or where to get a working one, and the most common
 * cause here is pasting a credential that was never an Anthropic API key at all.
 */
export function describeError(error: unknown, baseUrl?: string): string {
  const status = (error as {status?: number})?.status;
  const host = baseUrl ? new URL(baseUrl).host : 'api.anthropic.com';

  if (status === 401 && baseUrl) {
    // A custom endpoint — a local proxy — rejected the key. Its key is whatever it
    // was started with, not an Anthropic key.
    return [
      `${host} rejected this key.`,
      '',
      'That is your custom API URL, so the key has to be the one that server was',
      'started with (for the local proxy: its PROXY_API_KEY) — not an Anthropic key.',
      '',
      'Click "Forget key" and connect again with the matching key. If the URL was',
      'meant to be blank, clear it and use an Anthropic key instead.',
      '',
      'Your message was not sent — retype it once the key is working.',
    ].join('\n');
  }

  if (status === 401) {
    return [
      'api.anthropic.com rejected this key.',
      '',
      'The API URL field is blank, so this panel called Anthropic directly. A proxy',
      'key (like PROXY_API_KEY) or a Claude Code login will always fail there —',
      'those are different credentials entirely.',
      '',
      'Either set the API URL to your proxy (for the local one: http://127.0.0.1:8080)',
      'and use its key, or use a key from console.anthropic.com → API keys, which',
      'starts with "sk-ant-api03-" and is billed separately from a subscription.',
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

/**
 * Proves a key and endpoint work before the chat is shown, so a wrong key fails at
 * Connect rather than on the first message.
 *
 * `GET /v1/models` is the probe: Anthropic and the local proxy both serve it, it
 * costs no tokens, and it answers 401 to a bad key. Resolves with a one-line
 * summary for the UI; rejects with the same errors `runTurn` would, so
 * `describeError` explains them the same way.
 */
export async function probeConnection(options: {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{host: string; models: number}> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl ? {baseURL: options.baseUrl} : {}),
    ...(options.fetch ? {fetch: options.fetch} : {}),
    dangerouslyAllowBrowser: true,
    maxRetries: 0,          // a wrong key should fail once, not after three retries
  });
  const page = await client.models.list({limit: 20});
  return {
    host: new URL(options.baseUrl ?? 'https://api.anthropic.com').host,
    models: page.data.length,
  };
}

/** The local proxy answers `400 streaming is not implemented` — nothing else does. */
function isStreamingUnsupported(error: unknown): boolean {
  const status = (error as {status?: number})?.status;
  const message = String((error as Error)?.message ?? '');
  return status === 400 && /stream/i.test(message);
}

/** What the UI renders. Tool activity is surfaced so the demo is legible. */
export type Entry =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  | {kind: 'tool'; name: string; input: unknown; result: string; isError: boolean}
  | {kind: 'error'; text: string};

/**
 * Whether the endpoint streams. `null` = not known yet: try streaming, and if the
 * server rejects it (the local proxy answers 400 on `stream: true`), remember that
 * for the rest of the session. Anthropic itself always streams.
 */
export type StreamSupport = boolean | null;

export interface RunOptions {
  apiKey: string;
  /**
   * App-level context, read once when the chat session started. Goes in the system
   * prompt rather than the transcript, so it is not repeated as the conversation
   * grows and the model treats it as standing instruction rather than something the
   * user said.
   */
  appContext?: string;
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
  /**
   * Whether to read the page's tools and send them. `false` sends no `tools` key at
   * all (omitted, not an empty array) and the plain system prompt. Defaults to true.
   */
  useTools?: boolean;
  history: Anthropic.MessageParam[];
  userMessage: string;
  /** Called as the turn progresses, so the UI can stream activity in. */
  onEntry: (entry: Entry) => void;
  /**
   * Called with each text delta while an assistant reply streams, and with `null`
   * when that reply is complete. The UI grows one bubble as tokens arrive, then
   * `onEntry` delivers the finished text. Absent when the endpoint cannot stream.
   */
  onDelta?: (delta: string | null) => void;
  /** Streaming capability, learned once per session. See `StreamSupport`. */
  streamSupport?: {value: StreamSupport};
  signal?: AbortSignal;
  /** Test seam: a `fetch` for the SDK to use instead of the global one. */
  fetch?: typeof globalThis.fetch;
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
  const {
    apiKey,
    baseUrl,
    conversationId,
    appContext,
    model = DEFAULT_MODEL,
    useTools = true,
    userMessage,
    onEntry,
    onDelta,
    streamSupport = {value: null},
    signal,
    fetch: fetchImpl,
  } = options;

  const client = new Anthropic({
    apiKey,
    ...(baseUrl ? {baseURL: baseUrl} : {}),
    ...(conversationId ? {defaultHeaders: {'X-Conversation-Id': conversationId}} : {}),
    ...(fetchImpl ? {fetch: fetchImpl} : {}),
    // Required to call the API from a browser. Acceptable here because the key is
    // the user's own, entered at runtime and never persisted beyond this tab —
    // see the warning in the chat panel. Do NOT do this in a product: ship a
    // backend that holds the key instead.
    dangerouslyAllowBrowser: true,
  });

  const messages: Anthropic.MessageParam[] = [...options.history, {role: 'user', content: userMessage}];

  // Re-discovered every turn: the tool list is live. With tools off there is no
  // read at all — the list is not needed.
  const tools = useTools ? await discoverTools() : undefined;
  const basePrompt = useTools ? SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;

  const params = {
    model,
    max_tokens: 16000,
    system: appContext ? `${basePrompt}\n\n---\n\n${appContext}` : basePrompt,
    ...(tools ? {tools} : {}),
  };

  // Bounded so a confused model cannot loop forever on the user's dime.
  for (let iteration = 0; iteration < 10; iteration++) {
    let response: Anthropic.Message;

    if (streamSupport.value !== false && onDelta) {
      // Text arrives token by token; tool_use blocks arrive whole at the end of the
      // stream, so the loop below is the same either way.
      try {
        const stream = client.messages.stream({...params, messages}, {signal});
        stream.on('text', (delta) => onDelta(delta));
        response = await stream.finalMessage();
        streamSupport.value = true;
      } catch (error) {
        if (streamSupport.value === null && isStreamingUnsupported(error)) {
          // Learned once: this endpoint does not stream. Fall back for the session.
          streamSupport.value = false;
          onDelta(null);
          response = await client.messages.create({...params, messages}, {signal});
        } else {
          onDelta(null);
          throw error;
        }
      }
      onDelta(null);
    } else {
      response = await client.messages.create({...params, messages}, {signal});
    }

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

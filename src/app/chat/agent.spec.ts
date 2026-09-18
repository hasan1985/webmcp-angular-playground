import {runTurn, type Entry, type StreamSupport} from './agent';

/**
 * Drives `runTurn` through the real Anthropic SDK against a fake `fetch`, so the
 * streaming path is exercised end to end: SSE parsing, `onDelta` ordering, and the
 * once-per-session fallback when a server answers `400` to `stream: true`.
 */
describe('runTurn streaming', () => {
  const enc = new TextEncoder();

  function sseResponse(words: string[]): Response {
    const events = [
      {type: 'message_start', message: {id: 'm1', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}},
      {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
      ...words.map((w) => ({type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: w}})),
      {type: 'content_block_stop', index: 0},
      {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 1}},
      {type: 'message_stop'},
    ];
    const body = new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
    return new Response(body, {status: 200, headers: {'content-type': 'text/event-stream'}});
  }

  function jsonResponse(text: string): Response {
    return new Response(
      JSON.stringify({id: 'm2', type: 'message', role: 'assistant', model: 'x', content: [{type: 'text', text}], stop_reason: 'end_turn', stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}),
      {status: 200, headers: {'content-type': 'application/json'}},
    );
  }

  let requests: Array<{stream: boolean}>;
  let fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  beforeEach(() => {
    requests = [];
  });

  const run = (streamSupport: {value: StreamSupport}, onDelta: (d: string | null) => void) => {
    const entries: Entry[] = [];
    return runTurn({
      apiKey: 'k',
      baseUrl: 'http://fake.test',
      useTools: false,
      history: [],
      userMessage: 'hi',
      onEntry: (e) => entries.push(e),
      onDelta,
      streamSupport,
      fetch: (input, init) => {
        requests.push({stream: Boolean(init?.body && JSON.parse(init.body as string).stream)});
        return fetchImpl(input, init);
      },
    }).then((history) => ({entries, history}));
  };

  it('streams text deltas in order, then delivers the finished entry', async () => {
    fetchImpl = async () => sseResponse(['Hel', 'lo ', '**world**']);
    const deltas: Array<string | null> = [];
    const support = {value: null as StreamSupport};

    const {entries} = await run(support, (d) => deltas.push(d));

    expect(deltas).toEqual(['Hel', 'lo ', '**world**', null]);
    expect(entries).toEqual([{kind: 'assistant', text: 'Hello **world**'}]);
    expect(support.value).toBeTrue();
    expect(requests.map((r) => r.stream)).toEqual([true]);
  });

  it('falls back to non-streaming once when the server rejects stream: true', async () => {
    fetchImpl = async (_i, init) =>
      JSON.parse(init!.body as string).stream
        ? new Response(JSON.stringify({type: 'error', error: {type: 'invalid_request_error', message: 'streaming is not implemented on /v1/messages'}}), {status: 400, headers: {'content-type': 'application/json'}})
        : jsonResponse('OK');
    const deltas: Array<string | null> = [];
    const support = {value: null as StreamSupport};

    const first = await run(support, (d) => deltas.push(d));
    expect(first.entries).toEqual([{kind: 'assistant', text: 'OK'}]);
    expect(support.value).toBeFalse();
    expect(deltas).toEqual([null, null]);

    // Second turn in the same session goes straight to non-streaming.
    requests = [];
    await run(support, () => {});
    expect(requests.map((r) => r.stream)).toEqual([false]);
  });
});

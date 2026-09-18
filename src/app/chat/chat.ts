import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {DomSanitizer} from '@angular/platform-browser';
import type Anthropic from '@anthropic-ai/sdk';

import {AgentTurn} from '../agent-turn';
import {APP_CONTEXT_TOOL, DEFAULT_MODEL, describeError, runTurn, type Entry, type StreamSupport} from './agent';
import {renderMarkdown} from './markdown';
import {discoverTools, isWebMcpAvailable, runTool} from './webmcp-bridge';

const KEY_STORAGE = 'anthropic-api-key';
const URL_STORAGE = 'anthropic-base-url';

@Component({
  selector: 'app-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="chat">
      <header>
        <h3>Agent</h3>
        <span class="tools" [title]="toolNames().join(', ')">
          {{ toolNames().length }} tool{{ toolNames().length === 1 ? '' : 's' }}
          {{ webMcpEnabled() ? 'sent to the agent' : 'registered, not sent' }}
        </span>
      </header>

      <div class="modebar">
        <button type="button" class="mode" [class.on]="webMcpEnabled()"
                [disabled]="busy()" (click)="toggleWebMcp()"
                [attr.aria-pressed]="webMcpEnabled()">
          {{ webMcpEnabled() ? 'Disable WebMCP' : 'Enable WebMCP' }}
        </button>
        <span class="modehint">
          @if (webMcpEnabled()) {
            The page's tools go with every request.
          } @else {
            Plain chat — the model gets no tools and cannot see the page.
          }
        </span>
      </div>

      @if (!supported()) {
        <p class="warn">
          WebMCP is not available. The polyfill should provide it — check the console.
        </p>
      }

      @if (!hasKey()) {
        <form class="keyform" (submit)="saveKey($event)">
          <label for="key">Anthropic API key</label>
          <input id="key" type="password" [value]="keyDraft()"
                 (input)="keyDraft.set($any($event.target).value)"
                 placeholder="sk-ant-api03-…" autocomplete="off" />

          <label for="baseurl">API URL <span class="opt">optional</span></label>
          <input id="baseurl" type="text" [value]="urlDraft()"
                 (input)="urlDraft.set($any($event.target).value)"
                 placeholder="https://api.anthropic.com" autocomplete="off" />
          <p class="warn">
            Leave blank for Anthropic. A custom URL must speak the <em>Anthropic
            Messages API</em> — an OpenAI-compatible proxy is a different shape and
            will not work.
          </p>

          <button type="submit" [disabled]="!keyDraft().trim()">Connect</button>
          <p class="warn">
            Demo only. Your key is kept in this tab's <code>sessionStorage</code> and sent
            straight from the browser to Anthropic. A real app keeps the key on a server.
          </p>
        </form>
      } @else {
        <div class="logwrap">
        <div class="log" #log (scroll)="onScroll()">
          @for (entry of entries(); track $index) {
            @switch (entry.kind) {
              @case ('user') { <div class="msg user">{{ entry.text }}</div> }
              @case ('assistant') { <div class="msg bot md" [innerHTML]="markdown(entry.text)"></div> }
              @case ('error') { <div class="msg err">{{ entry.text }}</div> }
              @case ('tool') {
                <details class="tool" [class.failed]="entry.isError">
                  <summary>
                    <code>{{ entry.name }}</code>
                    {{ entry.isError ? 'rejected' : 'ran' }}
                  </summary>
                  <pre>{{ format(entry.input) }}</pre>
                  <pre class="result">{{ entry.result }}</pre>
                </details>
              }
            }
          } @empty {
            <p class="empty">
              @if (webMcpEnabled()) {
                Try: <em>"what's on the board?"</em>, <em>"play X in the middle"</em>,
                or <em>"beat me"</em>.
              } @else {
                Ask <em>"what's on the board?"</em> now, then enable WebMCP and ask
                again.
              }
            </p>
          }
          @if (streaming() !== null) {
            <div class="msg bot md streaming" [innerHTML]="markdown(streaming()!)"></div>
          } @else if (busy()) {
            <div class="msg bot pending">thinking…</div>
          }
        </div>

        @if (!pinned()) {
          <button type="button" class="jump" (click)="scrollToBottom(true)">↓ new messages</button>
        }
        </div>

        <form class="ask" (submit)="send($event)">
          <textarea #box rows="1" [value]="draft()" (input)="onDraft($any($event.target))"
                    (keydown.enter)="onEnter($event)" [disabled]="busy()"
                    placeholder="Ask the agent… (Shift+Enter for a new line)"></textarea>
          @if (busy()) {
            <button type="button" class="stop" (click)="stop()">Stop</button>
          } @else {
            <button type="submit" [disabled]="!draft().trim()">Send</button>
          }
        </form>
        <div class="sessionbar">
          <button class="ghost" [disabled]="busy()" (click)="newChat()">New chat</button>
          <button class="ghost" (click)="forgetKey()">Forget key</button>
        </div>
      }
    </aside>
  `,
  styles: `
    .chat {
      display: flex; flex-direction: column; height: 100%;
      border-left: 1px solid var(--border); background: var(--surface-2);
    }
    header {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: .5rem; padding: 1rem; border-bottom: 1px solid var(--border);
    }
    h3 { margin: 0; font-size: .95rem; }
    .tools { font-size: .75rem; color: var(--muted); cursor: help; text-align: right; }
    .modebar {
      display: flex; align-items: center; gap: .75rem; padding: .625rem 1rem;
      border-bottom: 1px solid var(--border); background: var(--surface);
    }
    .mode { font-size: .8rem; padding: .35rem .75rem; white-space: nowrap; }
    .mode.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    .modehint { font-size: .75rem; color: var(--muted); line-height: 1.4; }
    .logwrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .log { flex: 1; overflow-y: auto; padding: 1rem; display: grid; gap: .625rem; align-content: start; }
    .jump {
      position: absolute; bottom: .75rem; left: 50%; transform: translateX(-50%);
      z-index: 1; font-size: .75rem; padding: .3rem .75rem; white-space: nowrap;
      border-radius: 999px; background: var(--accent); color: var(--surface); border: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }
    .md { white-space: normal; }
    .md p { margin: 0; }
    .md p + p, .md p + ul, .md p + ol, .md ul + p, .md ol + p, .md pre + p, .md p + pre { margin-top: .5rem; }
    .md .h1, .md .h2, .md .h3 { font-weight: 600; }
    .md ul, .md ol { margin: .25rem 0 0; padding-left: 1.25rem; }
    .md li { margin: .15rem 0; }
    .md code { font-size: .85em; background: var(--surface-2); padding: .05em .3em; border-radius: .25rem; color: var(--accent-2); }
    .md pre.code {
      margin: .5rem 0 0; padding: .5rem .625rem; border-radius: .5rem; overflow-x: auto;
      background: var(--surface-2); border: 1px solid var(--border); color: inherit; white-space: pre;
    }
    .md pre.code code { background: none; padding: 0; color: inherit; font-size: .8rem; }
    .md .url { color: var(--muted); font-size: .85em; word-break: break-all; }
    .streaming::after {
      content: ''; display: inline-block; width: .5em; height: 1em; margin-left: .15em;
      vertical-align: text-bottom; background: currentColor; opacity: .6;
      animation: blink 1s steps(2) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .streaming::after { animation: none; } }
    .empty { color: var(--muted); font-size: .85rem; line-height: 1.6; margin: 0; }
    .msg { padding: .5rem .75rem; border-radius: .625rem; font-size: .875rem; line-height: 1.5; white-space: pre-wrap; }
    .user { background: var(--accent-soft); color: var(--accent); justify-self: end; max-width: 85%; }
    .bot { background: var(--surface); border: 1px solid var(--border); }
    .pending { color: var(--muted); font-style: italic; }
    .err { background: var(--danger-soft); color: var(--danger); }
    .tool {
      font-size: .75rem; border: 1px solid var(--border);
      border-radius: .625rem; background: var(--surface); padding: .4rem .625rem;
    }
    .tool.failed { border-color: var(--danger); }
    .tool summary { cursor: pointer; color: var(--muted); }
    .tool code { color: var(--accent-2); }
    pre { margin: .5rem 0 0; white-space: pre-wrap; word-break: break-word; color: var(--muted); }
    .result { color: inherit; }
    form.ask { display: flex; gap: .5rem; padding: 1rem; border-top: 1px solid var(--border); align-items: flex-end; }
    form.ask textarea {
      flex: 1; min-width: 0; resize: none; max-height: 10rem; overflow-y: auto;
      padding: .5rem .75rem; border-radius: .5rem; border: 1px solid var(--border);
      background: var(--surface); color: inherit; font: inherit; line-height: 1.4;
    }
    .stop { border-color: var(--danger); color: var(--danger); }
    .keyform { padding: 1rem; display: grid; gap: .5rem; }
    label { font-size: .8rem; color: var(--muted); }
    .opt { opacity: .6; font-style: italic; }
    input {
      padding: .5rem .75rem; border-radius: .5rem; border: 1px solid var(--border);
      background: var(--surface); color: inherit; font: inherit;
    }
    button {
      padding: .5rem 1rem; border-radius: .5rem; border: 1px solid var(--border);
      background: transparent; color: inherit; cursor: pointer; font: inherit;
    }
    button:disabled { opacity: .5; cursor: default; }
    .warn { font-size: .75rem; color: var(--muted); line-height: 1.5; margin: 0; }
    .sessionbar { display: flex; gap: .5rem; margin: 0 1rem 1rem; }
    .ghost {
      flex: 1; font-size: .75rem; padding: .3rem .625rem;
      color: var(--muted); border-style: dashed;
    }
  `,
})
export class Chat {
  protected readonly supported = signal(isWebMcpAvailable());
  protected readonly entries = signal<Entry[]>([]);
  protected readonly draft = signal('');
  protected readonly keyDraft = signal('');
  protected readonly urlDraft = signal(readUrl() ?? '');
  protected readonly busy = signal(false);
  protected readonly toolNames = signal<string[]>([]);
  protected readonly hasKey = signal(readKey() !== null);
  protected readonly webMcpEnabled = inject(AgentTurn).webMcpEnabled;
  /** The assistant reply currently arriving, or `null` between replies. */
  protected readonly streaming = signal<string | null>(null);
  /** True while the log is scrolled to (near) the bottom, so new content should keep it there. */
  protected readonly pinned = signal(true);

  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  private readonly sanitizer = inject(DomSanitizer);
  private readonly streamSupport: {value: StreamSupport} = {value: null};
  private abort: AbortController | null = null;

  private history: Anthropic.MessageParam[] = [];

  /**
   * One id per chat, minted here rather than returned by the server: the Messages
   * API response has nowhere to carry a session id, so a stock client would drop
   * it. A backend that threads can key a session off this; Anthropic ignores it.
   * Resetting the chat mints a new one, which starts a new session.
   */
  private conversationId = newConversationId();

  /**
   * App-level context, read once per session.
   *
   * `null` means not read yet; `''` means this page publishes none, and we should
   * stop asking — otherwise every turn would spend a lookup discovering the same
   * absence.
   */
  private appContext: string | null = null;
  private readonly agentTurn = inject(AgentTurn);

  constructor() {
    // Keep the visible tool count honest as the user navigates. `toolchange`
    // fires on the document when any tool registers or unregisters.
    void this.refreshTools();
    document.addEventListener('toolchange', () => void this.refreshTools());

    // A feature elsewhere in the app can hand the agent a turn. The chat does not
    // know or care which one — it just receives the context and runs it.
    this.agentTurn.requests$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((context) => void this.runRequestedTurn(context));

    // Follow new content only while the reader is at the bottom. Reading these
    // signals here is what re-runs the effect after every entry or delta renders.
    afterRenderEffect(() => {
      this.entries();
      this.streaming();
      if (this.pinned()) this.scrollToBottom(false);
    });
  }

  /** Assistant text is model output: rendered by our own escaping renderer, then trusted. */
  protected markdown(text: string) {
    return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(text));
  }

  protected onScroll(): void {
    const el = this.log()?.nativeElement;
    if (!el) return;
    this.pinned.set(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  /**
   * Programmatic follows are instant: a smooth scroll fires intermediate `scroll`
   * events that read as "not at bottom" and would un-pin the reader mid-animation.
   * Only the reader's own "↓ new messages" click animates.
   */
  protected scrollToBottom(force: boolean): void {
    const el = this.log()?.nativeElement;
    if (!el) return;
    if (force) this.pinned.set(true);
    el.scrollTo({top: el.scrollHeight, behavior: force ? 'smooth' : 'instant'});
  }

  protected onDraft(box: HTMLTextAreaElement): void {
    this.draft.set(box.value);
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }

  /** Enter sends; Shift+Enter inserts a newline. */
  protected onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing) return;
    event.preventDefault();
    void this.send(event);
  }

  protected stop(): void {
    this.abort?.abort();
  }

  private async refreshTools(): Promise<void> {
    this.toolNames.set((await discoverTools()).map((t) => t.name));
  }

  protected saveKey(event: Event): void {
    event.preventDefault();
    const key = this.keyDraft().trim();
    if (!key) return;
    sessionStorage.setItem(KEY_STORAGE, key);
    const url = this.urlDraft().trim().replace(/\/+$/, '');
    if (url) {
      sessionStorage.setItem(URL_STORAGE, url);
    } else {
      sessionStorage.removeItem(URL_STORAGE);
    }
    this.keyDraft.set('');
    this.hasKey.set(true);
  }

  /**
   * Flipping the switch starts a new session. A transcript that already holds
   * `tool_use` / `tool_result` blocks cannot be replayed without a `tools` key, so
   * the two modes never share a history.
   */
  protected toggleWebMcp(): void {
    if (this.busy()) return;
    this.webMcpEnabled.update((on) => !on);
    this.newChat();
  }

  /** Starts a fresh session: new conversation id, empty history, context re-read. */
  protected newChat(): void {
    this.entries.set([]);
    this.history = [];
    this.conversationId = newConversationId();
    this.appContext = null;
    this.pinned.set(true);
  }

  protected forgetKey(): void {
    sessionStorage.removeItem(KEY_STORAGE);
    sessionStorage.removeItem(URL_STORAGE);
    this.hasKey.set(false);
    this.newChat();
  }

  protected format(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  /**
   * A turn the page asked for rather than the user typing.
   *
   * Silently ignored when there is no key or a turn is already running: a board
   * click should never pop an error at someone who has not set the chat up, and
   * clicking twice quickly should not start two turns against the same history.
   */
  private async runRequestedTurn(context: string): Promise<void> {
    if (!readKey() || this.busy() || !this.webMcpEnabled()) return;
    this.agentTurn.playing.set(true);
    try {
      await this.runTurn(context);
    } finally {
      this.agentTurn.playing.set(false);
    }
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text || !readKey() || this.busy()) return;

    this.draft.set('');
    // Clear the element directly: `[value]` only writes when the bound value
    // changes, and the DOM value was last written by the user, not by us.
    const box = this.box()?.nativeElement;
    if (box) {
      box.value = '';
      box.style.height = 'auto';
    }
    await this.runTurn(text);
    box?.focus();
  }

  /**
   * Reads app context once per chat session.
   *
   * Sessions live here, not in the page: WebMCP has no notion of one, so "the start
   * of a conversation" is a thing only the client can know. Fetched through the
   * normal tool path, so the chat still learns nothing about this app except through
   * WebMCP.
   */
  private async appContextFor(): Promise<string | undefined> {
    // With tools off the model is told it cannot see the page; describing the
    // page to it anyway would contradict that.
    if (!this.webMcpEnabled()) return undefined;
    if (this.appContext !== null) return this.appContext || undefined;

    const names = (await discoverTools()).map((t) => t.name);
    if (!names.includes(APP_CONTEXT_TOOL)) {
      this.appContext = '';
      return undefined;
    }

    const {text, isError} = await runTool(APP_CONTEXT_TOOL, {});
    this.appContext = isError ? '' : text;
    return this.appContext || undefined;
  }

  private async runTurn(text: string): Promise<void> {
    const apiKey = readKey();
    if (!apiKey) return;

    this.append({kind: 'user', text});
    this.pinned.set(true);           // sending always brings the reader to the bottom
    this.busy.set(true);
    // Locks the board for the duration, whichever path started this turn.
    this.agentTurn.running.set(true);
    this.abort = new AbortController();

    try {
      this.history = await runTurn({
        apiKey,
        baseUrl: readUrl() ?? undefined,
        conversationId: this.conversationId,
        appContext: await this.appContextFor(),
        model: DEFAULT_MODEL,
        useTools: this.webMcpEnabled(),
        history: this.history,
        userMessage: text,
        onEntry: (entry) => this.append(entry),
        onDelta: (delta) =>
          this.streaming.update((cur) => (delta === null ? null : (cur ?? '') + delta)),
        streamSupport: this.streamSupport,
        signal: this.abort.signal,
      });
    } catch (error) {
      // `history` is only assigned on success, so a failed turn leaves the model's
      // history untouched — but the user's message is already in the visible log.
      // describeError() says so, otherwise the transcript quietly lies about what
      // the model has seen.
      this.append({
        kind: 'error',
        text: this.abort.signal.aborted
          ? 'Stopped.\n\nYour message was not sent.'
          : describeError(error, readUrl() ?? undefined),
      });
    } finally {
      this.streaming.set(null);
      this.busy.set(false);
      this.agentTurn.running.set(false);
      this.abort = null;
      void this.refreshTools();
    }
  }

  private append(entry: Entry): void {
    this.entries.update((list) => [...list, entry]);
  }
}

function newConversationId(): string {
  return `conv-${crypto.randomUUID()}`;
}

function readUrl(): string | null {
  try {
    return sessionStorage.getItem(URL_STORAGE);
  } catch {
    return null;
  }
}

function readKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

import {ChangeDetectionStrategy, Component, Injectable, inject, signal} from '@angular/core';
import {declareExperimentalWebMcpTool} from 'ng-webmcp-compat';

@Injectable({providedIn: 'root'})
export class NotesStore {
  readonly notes = signal<string[]>(['WebMCP tools are just functions with a schema.']);

  add(text: string): void {
    this.notes.update((n) => [...n, text]);
  }

  clear(): void {
    this.notes.set([]);
  }
}

/**
 * Demonstrates **scoped** tools: `add_note` and `list_notes` exist only while this
 * page is on screen. Navigate away and the agent can no longer see them — watch
 * the tool count in the chat panel change as you move between routes.
 *
 * Why declare them in the component rather than in the route's `providers`?
 *
 * Route-level `providers` create an environment injector, and before Angular 22
 * that injector is not destroyed when you navigate away — so route-scoped tools
 * would linger. Angular 22 fixes this with `withExperimentalAutoCleanupInjectors()`
 * on `provideRouter`. Declaring the tools in the component ties them to the
 * component's own lifetime instead, which cleans up correctly on **every** version.
 *
 * The mechanism underneath: `declareExperimentalWebMcpTool` hangs an
 * `AbortController` off the injector's `DestroyRef` and passes its signal to
 * `registerTool`. The WebMCP spec has no `unregisterTool` — aborting that signal
 * *is* unregistration.
 */
@Component({
  selector: 'app-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>Notes</h2>
      <p class="hint">
        These tools are scoped to this page. Ask the agent to add a note — then go back
        to the game and ask again: the tools are gone, because the component that
        declared them was destroyed.
      </p>

      <form (submit)="add($event)">
        <input name="note" [value]="draft()" (input)="draft.set($any($event.target).value)"
               placeholder="Write a note…" />
        <button type="submit" [disabled]="!draft().trim()">Add</button>
      </form>

      <ul>
        @for (note of store.notes(); track $index) {
          <li>{{ note }}</li>
        } @empty {
          <li class="empty">No notes yet.</li>
        }
      </ul>
    </section>
  `,
  styles: `
    .page { max-width: 32rem; }
    h2 { margin: 0 0 .25rem; }
    .hint { color: var(--muted); margin: 0 0 1.5rem; line-height: 1.5; }
    form { display: flex; gap: .5rem; margin-bottom: 1.25rem; }
    input {
      flex: 1; padding: .5rem .75rem; border-radius: .5rem;
      border: 1px solid var(--border); background: var(--surface); color: inherit;
    }
    button {
      padding: .5rem 1rem; border-radius: .5rem; border: 1px solid var(--border);
      background: transparent; color: inherit; cursor: pointer;
    }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
    li {
      padding: .625rem .875rem; border-radius: .5rem;
      background: var(--surface); border: 1px solid var(--border);
    }
    .empty { color: var(--muted); border-style: dashed; }
  `,
})
export class NotesPage {
  protected readonly store = inject(NotesStore);
  protected readonly draft = signal('');

  constructor() {
    // Registered now, unregistered when this component is destroyed.
    declareExperimentalWebMcpTool({
      name: 'list_notes',
      description: 'List every note currently saved on the notes page.',
      inputSchema: {type: 'object', properties: {}, required: []},
      execute: () => {
        const notes = inject(NotesStore).notes();
        return notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'There are no notes yet.';
      },
    });

    declareExperimentalWebMcpTool({
      name: 'add_note',
      description: 'Add a note to the notes page. Only available while the notes page is open.',
      inputSchema: {
        type: 'object',
        properties: {text: {type: 'string', description: 'The note to add.'}},
        required: ['text'],
      },
      execute: ({text}) => {
        const trimmed = text.trim();
        if (!trimmed) {
          return 'Rejected: the note text was empty.';
        }
        inject(NotesStore).add(trimmed);
        return `Added note: "${trimmed}".`;
      },
    });
  }

  protected add(event: Event): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (text) {
      this.store.add(text);
      this.draft.set('');
    }
  }
}

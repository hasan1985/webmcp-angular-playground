import {ChangeDetectionStrategy, Component} from '@angular/core';
import {RouterLink, RouterLinkActive, RouterOutlet} from '@angular/router';

import {Chat} from './chat/chat';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Chat],
  template: `
    <div class="shell">
      <main>
        <nav>
          <strong>webmcp-angular</strong>
          <a routerLink="/game" routerLinkActive="active">Game</a>
          <a routerLink="/notes" routerLinkActive="active">Notes</a>
        </nav>
        <router-outlet />
      </main>
      <app-chat />
      <!-- The inspector docks here rather than floating: it used to cover the
           chat panel, since both were anchored bottom-right. -->
      <aside id="webmcp-devtools-slot" class="devtools"></aside>
    </div>
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: 1fr minmax(19rem, 24rem) minmax(19rem, 24rem);
      height: 100vh;
    }
    /* Custom elements default to display:inline, so a grid row never constrains
       them. Without this the chat grows with its transcript, pushes its own input
       past the bottom of the viewport, and becomes unusable. */
    app-chat, .devtools {
      display: block;
      min-height: 0;
      overflow: hidden;
    }
    .devtools {
      border-left: 1px solid var(--border);
      background: var(--surface-2);
      overflow: hidden;
      min-width: 0;
    }
    main { padding: 2rem; overflow-y: auto; }
    nav {
      display: flex; align-items: baseline; gap: 1.25rem; margin-bottom: 2rem;
      padding-bottom: 1rem; border-bottom: 1px solid var(--border);
    }
    nav strong { margin-right: auto; font-size: .9rem; color: var(--muted); font-weight: 500; }
    nav a { color: var(--muted); text-decoration: none; font-size: .9rem; }
    nav a:hover { color: inherit; }
    nav a.active { color: var(--accent); font-weight: 600; }
    @media (max-width: 82rem) {
      /* Not enough room for three columns — drop the inspector under the chat. */
      .shell { grid-template-columns: 1fr minmax(19rem, 24rem); }
      .devtools { grid-column: 2; border-left: 1px solid var(--border); min-height: 24rem; }
    }
    @media (max-width: 60rem) {
      .shell { grid-template-columns: 1fr; height: auto; }
      main { padding: 1.25rem; }
      .devtools { grid-column: 1; border-left: 0; border-top: 1px solid var(--border); }
    }
  `,
})
export class App {}

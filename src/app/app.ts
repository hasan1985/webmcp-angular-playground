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
    </div>
  `,
  styles: `
    .shell {
      display: grid; grid-template-columns: 1fr minmax(20rem, 26rem);
      height: 100vh;
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
    @media (max-width: 60rem) {
      .shell { grid-template-columns: 1fr; height: auto; }
      main { padding: 1.25rem; }
    }
  `,
})
export class App {}

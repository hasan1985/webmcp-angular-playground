import {ChangeDetectionStrategy, Component, inject} from '@angular/core';

import {AgentTurn} from '../agent-turn';
import {GameStore} from './game-store';

@Component({
  selector: 'app-game',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>Tic-tac-toe</h2>
      <p class="hint">
        Play by clicking, or ask the agent — it reaches the same state through the
        <code>get_board</code>, <code>make_move</code> and <code>reset_game</code> tools.
      </p>

      <div class="status" [class.over]="store.isOver()">
        @if (store.winner()) {
          {{ store.winner() }} wins
        } @else if (store.isDraw()) {
          Draw
        } @else {
          {{ store.turn() }} to move
        }
      </div>

      <div class="board">
        @for (cell of store.board(); track $index) {
          <button
            class="square"
            [disabled]="cell !== null || store.isOver()"
            (click)="play($index)"
            [attr.aria-label]="'Square ' + $index + (cell ? ', ' + cell : ', empty')"
          >
            <span [class.x]="cell === 'X'" [class.o]="cell === 'O'">{{ cell }}</span>
            <small class="idx">{{ $index }}</small>
          </button>
        }
      </div>

      <div class="controls">
        <button class="reset" (click)="store.reset()">Reset</button>

        <label class="autoplay">
          <input type="checkbox" [checked]="agent.enabled()"
                 (change)="agent.enabled.set($any($event.target).checked)" />
          Agent plays back
          @if (agent.running()) { <span class="thinking">thinking…</span> }
        </label>
      </div>
    </section>
  `,
  styles: `
    .page { max-width: 32rem; }
    h2 { margin: 0 0 .25rem; }
    .hint { color: var(--muted); margin: 0 0 1.5rem; line-height: 1.5; }
    .status {
      font-weight: 600; margin-bottom: 1rem; padding: .5rem .75rem;
      border-radius: .5rem; background: var(--surface); display: inline-block;
    }
    .status.over { background: var(--accent-soft); color: var(--accent); }
    .board {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: .5rem; max-width: 18rem;
    }
    .square {
      position: relative; aspect-ratio: 1; font-size: 2.5rem; font-weight: 600;
      border: 1px solid var(--border); border-radius: .75rem;
      background: var(--surface); color: inherit; cursor: pointer;
      display: grid; place-items: center;
    }
    .square:hover:not(:disabled) { border-color: var(--accent); }
    .square:disabled { cursor: default; }
    .idx {
      position: absolute; top: .3rem; left: .45rem;
      font-size: .7rem; color: var(--muted); font-weight: 400;
    }
    .x { color: var(--accent); }
    .o { color: var(--accent-2); }
    .controls {
      margin-top: 1.25rem; display: flex; align-items: center;
      gap: 1.25rem; flex-wrap: wrap;
    }
    .reset {
      padding: .5rem 1rem; border-radius: .5rem;
      border: 1px solid var(--border); background: transparent;
      color: inherit; cursor: pointer;
    }
    .autoplay {
      display: flex; align-items: center; gap: .45rem;
      font-size: .875rem; color: var(--muted); cursor: pointer;
    }
    .thinking { color: var(--accent); font-style: italic; }
  `,
})
export class GamePage {
  protected readonly store = inject(GameStore);
  protected readonly agent = inject(AgentTurn);

  protected play(square: number): void {
    const player = this.store.turn();
    const error = this.store.move(square, player);
    if (error) return;

    // Only after a *human* move. The agent's own moves go through the make_move
    // tool, which never comes back here — otherwise it would answer itself in a
    // loop until the board filled up.
    if (this.store.isOver()) return;

    this.agent.request(
      [
        `I just played ${player} on square ${square}.`,
        '',
        this.store.describe(),
        '',
        `Make one move as ${this.store.turn()} using the make_move tool, then say in one` +
          ' short sentence what you played and why.',
      ].join('\n'),
    );
  }
}

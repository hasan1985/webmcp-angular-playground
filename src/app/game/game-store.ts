import {Injectable, computed, signal} from '@angular/core';

export type Cell = 'X' | 'O' | null;
export type Player = 'X' | 'O';

/** Winning index triples, in board order. */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

/**
 * Plain Angular state. Note there is nothing WebMCP-aware in here — the tools in
 * `game.tools.ts` sit on top of the same API the UI uses. That separation is the
 * point: exposing an app to an agent should not mean rewriting the app.
 */
@Injectable({providedIn: 'root'})
export class GameStore {
  readonly board = signal<Cell[]>(Array(9).fill(null));
  readonly turn = signal<Player>('X');

  readonly winner = computed<Player | null>(() => {
    const b = this.board();
    for (const [a, c, d] of LINES) {
      if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a] as Player;
    }
    return null;
  });

  readonly isDraw = computed(() => !this.winner() && this.board().every((c) => c !== null));
  readonly isOver = computed(() => this.winner() !== null || this.isDraw());

  readonly emptySquares = computed(() =>
    this.board().reduce<number[]>((acc, cell, i) => (cell === null ? [...acc, i] : acc), []),
  );

  /**
   * Returns an error string instead of throwing. Agents recover from a described
   * problem far better than from an exception, and the tool layer passes this
   * straight back as the tool result.
   */
  move(square: number, player: Player): string | null {
    if (this.isOver()) {
      return `The game is already over (${this.winner() ? `${this.winner()} won` : 'it was a draw'}). Call reset_game to play again.`;
    }
    if (!Number.isInteger(square) || square < 0 || square > 8) {
      return `Square must be an integer from 0 to 8. Received: ${JSON.stringify(square)}.`;
    }
    if (player !== this.turn()) {
      return `It is ${this.turn()}'s turn, not ${player}'s.`;
    }
    const occupant = this.board()[square];
    if (occupant !== null) {
      return `Square ${square} is already taken by ${occupant}. Empty squares are: ${this.emptySquares().join(', ') || 'none'}.`;
    }

    this.board.update((b) => b.map((c, i) => (i === square ? player : c)));
    this.turn.set(player === 'X' ? 'O' : 'X');
    return null;
  }

  reset(): void {
    this.board.set(Array(9).fill(null));
    this.turn.set('X');
  }

  /** A compact, agent-legible view of the board. */
  describe(): string {
    const b = this.board();
    const rows = [0, 3, 6].map((r) => b.slice(r, r + 3).map((c) => c ?? '.').join(' '));
    const status = this.winner()
      ? `${this.winner()} has won`
      : this.isDraw()
        ? 'the game is a draw'
        : `it is ${this.turn()}'s turn`;
    return [
      'Board (squares numbered 0-8, left to right, top to bottom):',
      ...rows,
      `Status: ${status}.`,
      `Empty squares: ${this.emptySquares().join(', ') || 'none'}.`,
    ].join('\n');
  }
}

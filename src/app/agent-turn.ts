import {Injectable, signal} from '@angular/core';
import {Subject} from 'rxjs';

/**
 * Lets a feature hand the agent a turn without knowing anything about the chat.
 *
 * Until now the agent only ever acted because someone typed at it. This is the
 * other direction: the *page* decides the agent should act, and describes why.
 *
 * Deliberately a one-way channel carrying a plain string. The game pushes context;
 * the chat consumes it. Neither imports the other, so the chat still has no
 * knowledge of tic-tac-toe, and the game still has no knowledge of the LLM.
 */
@Injectable({providedIn: 'root'})
export class AgentTurn {
  /** When off, `request()` is a no-op. Bound to the checkbox on the game page. */
  readonly enabled = signal(false);

  /** True while a requested turn is running, so the UI can say so. */
  readonly running = signal(false);

  private readonly requests = new Subject<string>();
  readonly requests$ = this.requests.asObservable();

  /**
   * Asks the agent to take a turn, given a description of what just happened.
   *
   * Call this only for actions a *human* took. Calling it after the agent's own
   * move would have it respond to itself, forever.
   */
  request(context: string): void {
    if (!this.enabled()) return;
    this.requests.next(context);
  }
}

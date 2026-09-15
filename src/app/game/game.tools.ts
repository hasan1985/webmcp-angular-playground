import {inject} from '@angular/core';
import {webMcpTool} from 'webmcp-angular/strict';

import {GameStore, type Player} from './game-store';

/**
 * The tic-tac-toe tools, exposed to any AI agent that can see this page.
 *
 * Four things worth copying from this file:
 *
 * 1. `execute` runs inside the owning injector's injection context, so `inject()`
 *    works in the body. Tools stay thin wrappers over services you already have —
 *    note that `GameStore` knows nothing about WebMCP.
 *
 * 2. **Nothing validates the agent's arguments for you.** Neither the WebMCP spec
 *    nor Angular checks input against `inputSchema` — a schema is a hint to the
 *    model, not a runtime guard. Validate, and return a *description* of what was
 *    wrong rather than throwing. A good error is what lets an agent self-correct.
 *
 * 3. `webMcpTool()` is a no-op at runtime. It exists so each tool's schema is
 *    inferred on its own, which is what gives `execute` correctly-typed arguments
 *    as you write it. See angular/angular#70125.
 *
 * 4. Each tool is exported separately rather than as one array — see the comment
 *    in `app.config.ts` for why that matters. Short version: it is what lets the
 *    whole thing type-check with no casts.
 */

export const getBoardTool = webMcpTool({
  name: 'get_board',
  description:
    'Read the current tic-tac-toe board, whose turn it is, and which squares are still empty. ' +
    'Call this before making a move so you know the current state.',
  inputSchema: {type: 'object', properties: {}, required: []},
  execute: () => inject(GameStore).describe(),
});

export const makeMoveTool = webMcpTool({
  name: 'make_move',
  description:
    'Place a mark on the tic-tac-toe board. Squares are numbered 0-8, left to right, ' +
    'top to bottom, so 0 is the top-left corner and 8 is the bottom-right. ' +
    "Fails if the square is taken, the game is over, or it is not that player's turn.",
  inputSchema: {
    type: 'object',
    properties: {
      square: {
        type: 'integer',
        minimum: 0,
        maximum: 8,
        description: 'Which square to mark, 0-8.',
      },
      player: {
        type: 'string',
        enum: ['X', 'O'],
        description: 'Which player is moving. X always goes first.',
      },
    },
    required: ['square', 'player'],
  },
  execute: ({square, player}) => {
    const store = inject(GameStore);
    const error = store.move(square, player as Player);
    // A rejected move is a normal result, not an exception: the agent reads the
    // reason and tries again.
    return error
      ? `Move rejected. ${error}`
      : `Played ${player} on square ${square}.\n${store.describe()}`;
  },
});

export const resetGameTool = webMcpTool({
  name: 'reset_game',
  description: 'Clear the tic-tac-toe board and start a new game with X to move.',
  inputSchema: {type: 'object', properties: {}, required: []},
  execute: () => {
    const store = inject(GameStore);
    store.reset();
    return `New game started.\n${store.describe()}`;
  },
});

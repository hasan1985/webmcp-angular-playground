import {TestBed} from '@angular/core/testing';
import {provideExperimentalWebMcpTools} from 'ng-webmcp-compat';
import {installWebMcpTestHarness, type WebMcpHarness} from 'ng-webmcp-compat/testing';

import {GameStore} from './game-store';
import {getBoardTool, makeMoveTool, resetGameTool} from './game.tools';

/**
 * Tests the tools an agent sees, not the component.
 *
 * The harness installs an in-memory `document.modelContext`, so this runs with no
 * browser support for WebMCP and no polyfill — and it exercises the same
 * registration path a real page uses, rather than calling `execute` directly. That
 * distinction matters: calling `execute` yourself would skip
 * `runInInjectionContext`, and every `inject()` in these tools would fail in
 * production while the test stayed green.
 */
describe('game tools', () => {
  let webmcp: WebMcpHarness;
  let store: GameStore;

  beforeEach(() => {
    webmcp = installWebMcpTestHarness();

    TestBed.configureTestingModule({
      providers: [
        provideExperimentalWebMcpTools([getBoardTool]),
        provideExperimentalWebMcpTools([makeMoveTool]),
        provideExperimentalWebMcpTools([resetGameTool]),
      ],
    });

    // Environment initializers run lazily; touching the injector forces them.
    store = TestBed.inject(GameStore);
    store.reset();
  });

  afterEach(() => webmcp.uninstall());

  it('registers all three tools', () => {
    expect(webmcp.toolNames()).toEqual(['get_board', 'make_move', 'reset_game']);
  });

  it('describes an empty board', async () => {
    const board = (await webmcp.invoke('get_board')) as string;
    expect(board).toContain("it is X's turn");
    expect(board).toContain('Empty squares: 0, 1, 2, 3, 4, 5, 6, 7, 8');
  });

  it('plays a move that the app state reflects', async () => {
    await webmcp.invoke('make_move', {square: 4, player: 'X'});

    expect(store.board()[4]).toBe('X');
    expect(store.turn()).toBe('O');
  });

  it('rejects an occupied square with a message naming the alternatives', async () => {
    await webmcp.invoke('make_move', {square: 4, player: 'X'});
    const result = (await webmcp.invoke('make_move', {square: 4, player: 'O'})) as string;

    // Rejections are results, not exceptions: that is what lets an agent retry.
    expect(result).toContain('Move rejected');
    expect(result).toContain('already taken by X');
    expect(result).toContain('Empty squares are: 0, 1, 2, 3, 5, 6, 7, 8');
    expect(store.board()[4]).toBe('X');
  });

  it('rejects a move out of turn', async () => {
    await webmcp.invoke('make_move', {square: 0, player: 'X'});
    const result = (await webmcp.invoke('make_move', {square: 1, player: 'X'})) as string;

    expect(result).toContain("It is O's turn, not X's");
  });

  it('rejects an out-of-range square instead of corrupting the board', async () => {
    const result = (await webmcp.invoke('make_move', {square: 99, player: 'X'})) as string;

    expect(result).toContain('must be an integer from 0 to 8');
    expect(store.board().every((cell) => cell === null)).toBe(true);
  });

  it('refuses to play on after the game is over', async () => {
    for (const [square, player] of [[0, 'X'], [3, 'O'], [1, 'X'], [4, 'O'], [2, 'X']] as const) {
      await webmcp.invoke('make_move', {square, player});
    }
    expect(store.winner()).toBe('X');

    const result = (await webmcp.invoke('make_move', {square: 5, player: 'O'})) as string;
    expect(result).toContain('already over');
  });

  it('resets the board', async () => {
    await webmcp.invoke('make_move', {square: 0, player: 'X'});
    const result = (await webmcp.invoke('reset_game')) as string;

    expect(result).toContain('New game started');
    expect(store.board().every((cell) => cell === null)).toBe(true);
    expect(store.turn()).toBe('X');
  });

  it('runs execute inside the injection context', async () => {
    // If `runInInjectionContext` were skipped, the `inject(GameStore)` inside these
    // tools would throw NG0203 rather than returning the board.
    await expectAsync(webmcp.invoke('get_board')).toBeResolved();
    expect(webmcp.calls().map((c) => c.name)).toEqual(['get_board']);
  });
});

import {webMcpTool} from 'webmcp-angular/strict';

/**
 * App-level context for an agent — the things that are true about this app as a
 * whole, rather than about any one tool.
 *
 * WebMCP has nowhere to put this. Every `description` is per-tool, and there is no
 * equivalent of MCP's `instructions` field on `server/discover`. So it is published
 * as an ordinary tool, which costs nothing extra: only the short `description` below
 * appears in `getTools()`, and the body travels once, when someone actually reads it.
 *
 * Publishing it as a tool rather than as a new browser API also means it reaches
 * every consumer — the browser's own agent, an in-page chat, and an external MCP
 * client through the bridge — with no plumbing.
 */
export const aboutThisAppTool = webMcpTool({
  name: 'about_this_app',
  description:
    'Read this before using the other tools: what this app is, and the conventions ' +
    'its tools share.',
  inputSchema: {type: 'object', properties: {}, required: []},
  execute: () =>
    [
      'This is the webmcp-angular playground — a demo of exposing an Angular app to',
      'AI agents through WebMCP.',
      '',
      'Two pages, and the tools available depend on which one is open:',
      '  · Game  — tic-tac-toe. get_board, make_move, reset_game. Always available.',
      '  · Notes — a note list. list_notes, add_note. Only while the notes page is open.',
      '',
      'Conventions worth knowing:',
      '  · Read before you write. get_board and list_notes are free and safe.',
      '  · A rejected call is not an error. It returns text explaining what was wrong',
      '    and often what to do instead — read it and correct your next call rather',
      '    than retrying the same one.',
      '  · Successful calls return the new state, so you rarely need to read again',
      '    straight after writing.',
      '  · The tool list is live. If a tool you expected is missing, the user has',
      '    navigated away from the page that owns it.',
      '',
      'The user can see the same state you do, on screen. They may change it while you',
      'are working, so prefer reading current state over relying on memory.',
    ].join('\n'),
});

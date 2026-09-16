# webmcp-angular-playground

A sample Angular app that exposes its own features to an AI agent via
[WebMCP](https://webmachinelearning.github.io/webmcp/), using
[`webmcp-angular`](../webmcp-angular).

It is a **separate project on purpose.** A demo inside the library workspace would
resolve `webmcp-angular` through the TypeScript path mapping and import raw
source — never exercising what actually ships: the ng-packagr output, the entry
points, the `exports` map, the peer ranges. This app installs the built package the
way a user does, which is a class of bug the library's parity suite cannot catch.
(It caught one immediately — see *Install it from a tarball* below.)

## What it demonstrates

| Page | Tools | Point being made |
|---|---|---|
| **Game** (tic-tac-toe) | `get_board`, `make_move`, `reset_game` | App-lifetime tools; reading state before acting; **validation errors the agent can recover from** |
| **Notes** | `list_notes`, `add_note` | **Page-scoped** tools — they appear and disappear as you navigate |
| **Chat** | — | A BYO-key agent loop driven entirely by WebMCP discovery |

Verified in Chrome: 3 tools on the game route, 5 on the notes route, back to 3 on
return — the `DestroyRef → AbortController → registerTool({signal})` chain really
does unregister. Rejected moves come back as descriptions (`Square 4 is already
taken by X. Empty squares are: 0, 1, 2, 3, 5, 6, 7, 8.`), not exceptions, which is
what lets an agent self-correct.

## The page can drive the agent too

Tick **Agent plays back** under the board and the agent answers every move you make.

This is the other direction from a chat: nothing is typed. Clicking a square builds
a context string — what you played, the board, whose turn it is — and hands it to
the agent, which calls `make_move` and explains itself.

```
you click square 4
   ↓
"I just played X on square 4.  <board>  Make one move as O using make_move…"
   ↓
agent → make_move({square: 0, player: "O"})
   ↓
"I played O in the top-left corner — against a center X, taking a corner is the
 safest reply and avoids the fork traps an edge move allows."
```

While the agent is mid-turn the board is locked — every square and Reset disabled,
dimmed, `aria-busy`, and the status says so.

That applies to **any** agent turn, not just one the board asked for. Typing "you go
first" is a turn that moves, and the lock has to cover it: the agent holds
`make_move` and may call it whatever you asked, so a turn cannot be known in advance
not to touch the board. Without that you can
click into the gap and race the agent's own `make_move`, or reset the board out
from under a call that is already in flight. The autoplay checkbox stays live, so
you are never stuck waiting on a turn you no longer want.

Two details worth copying if you build something similar:

- **Only human actions trigger it.** The nudge fires from the component's click
  handler, not from `GameStore` and not from the tool — otherwise the agent's own
  move would prompt it again, forever.
- **The game and the chat do not know about each other.** `AgentTurn` is a one-way
  channel carrying a plain string. The game pushes context; the chat consumes it.
  The chat still knows nothing about tic-tac-toe.

Including the board in the context is a deliberate shortcut: the agent *could* call
`get_board` first, and does on its first turn, but handing it the state saves a
round trip. It still has to call `make_move` to actually play.

## The one rule

**The chat may only learn about tools through `document.modelContext.getTools()`,
and may only run them through `executeTool()`.** It never imports `GameStore`,
`NotesStore`, or any feature service — see `src/app/chat/webmcp-bridge.ts`.

If the chat called the app's services directly, this demo would behave identically
with WebMCP removed, and would therefore prove nothing. The real WebMCP consumer is
the browser's own agent or an extension; an in-page chat is a stand-in, and it is
only a *faithful* stand-in if it goes through the same browser API. Resist "just
import the store" when debugging.

## Running

```bash
npm install
npm start          # http://localhost:4200
```

The polyfill is installed via `installWebMcpPolyfill()` from
`webmcp-angular/polyfill` in `src/main.ts`, awaited **before** `bootstrapApplication`
— tools register during bootstrap, so anything that installs the API asynchronously
has to finish first. Use a `.then` chain, not top-level `await`: Angular's default
browserslist targets reject it.

Playing by hand needs nothing. The chat panel needs an Anthropic API key, entered
at runtime and kept in that tab's `sessionStorage`. It is sent straight from the
browser to the API (`dangerouslyAllowBrowser`), which is fine for a local demo and
**wrong for a product** — ship a backend that holds the key.

Try: *"what's on the board?"*, *"play X in the middle"*, *"beat me"*, then go to
Notes and ask it to add one — and ask again from the Game page, where the tool no
longer exists.

## Install it from a tarball, not `file:`

```bash
cd ../webmcp-angular && npx ng build webmcp-angular
cd dist/webmcp-angular && npm pack --pack-destination /tmp
cd ../../../webmcp-angular-playground && npm i /tmp/webmcp-angular-0.0.1.tgz
```

`npm i file:../webmcp-angular/dist/webmcp-angular` **symlinks**, and that breaks
secondary entry points. `webmcp-angular/strict` imports its types from the primary
entry by package name; TypeScript resolves symlinks to their real path, so from
`dist/webmcp-angular/strict/` the self-reference cannot be found. The types
silently degrade to `any` and you get `TS7031: implicitly has an 'any' type` on tool
arguments — with no indication of the real cause. A packed tarball installs as a real
directory and resolves correctly.

## The JSON-RPC bridge

`src/main.ts` also starts `createWebMcpBridge()`, which exposes the same tools over
MCP/JSON-RPC on the `mcp-default` postMessage channel. Verified end to end in Chrome:
`initialize` negotiates `2025-11-25`, `tools/list` returns all three tools with their
full JSON Schema, `tools/call` really plays a move, and
`notifications/tools/list_changed` fires as you navigate.

That last one is why the bridge listens for `toolchange` on both the document *and*
the model context: the polyfill dispatches it only on the context, so a
document-only listener never notifies.

## The inspector

`src/main.ts` mounts `mountWebMcpDevtools()` behind `isDevMode()` and a dynamic
import. Press **Ctrl/Cmd + Shift + M** to open it: live tool list, schemas,
schema-prefilled arguments, and a call log. Run `make_move` from the panel and watch
the board update — same state, different door in.

## Testing the tools

```bash
npm test      # headless Chrome
```

`src/app/game/game.tools.spec.ts` uses `webmcp-angular/testing`, which installs an
in-memory `document.modelContext` — so the tools are tested through the real
registration path with no browser support for WebMCP and no polyfill.

It deliberately goes through `webmcp.invoke(...)` rather than calling `execute`
directly. Calling `execute` yourself skips `runInInjectionContext`, so every
`inject()` in a tool would fail in production while the test stayed green.

## Notes on the code

- **`src/app/game/game-store.ts`** knows nothing about WebMCP. Exposing an app to an
  agent should not mean rewriting the app; tools are a thin layer on services you have.
- **Nothing validates agent input for you.** Neither the spec nor Angular checks
  arguments against `inputSchema` — it is a hint to the model, not a runtime guard.
- **Each tool gets its own `provideWebMcpTools` call.** One call per
  array forces every tool in it to share a single schema type
  ([angular#70125](https://github.com/angular/angular/issues/70125)); separate calls
  keep each array homogeneous, so it all type-checks with no casts. See `app.config.ts`.
- **Notes tools are declared in the component, not in route `providers`.** Route-level
  environment injectors are not destroyed on navigation before Angular 22 — that is
  what `withExperimentalAutoCleanupInjectors()` fixes. Component lifetime works on
  every version.
- **The chat uses a manual tool loop**, not the SDK's tool runner: the runner wants
  local `run` functions declared up front, but these tools are discovered at runtime
  from the page.

# ng-webmcp-playground

A sample Angular app that exposes its own features to an AI agent via
[WebMCP](https://webmachinelearning.github.io/webmcp/), using
[`ng-webmcp-compat`](../ng-webmcp-compat).

It is a **separate project on purpose.** A demo inside the library workspace would
resolve `ng-webmcp-compat` through the TypeScript path mapping and import raw
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

Playing by hand needs nothing. The chat panel needs an Anthropic API key, entered
at runtime and kept in that tab's `sessionStorage`. It is sent straight from the
browser to the API (`dangerouslyAllowBrowser`), which is fine for a local demo and
**wrong for a product** — ship a backend that holds the key.

Try: *"what's on the board?"*, *"play X in the middle"*, *"beat me"*, then go to
Notes and ask it to add one — and ask again from the Game page, where the tool no
longer exists.

## Install it from a tarball, not `file:`

```bash
cd ../ng-webmcp-compat && npx ng build ng-webmcp-compat
cd dist/ng-webmcp-compat && npm pack --pack-destination /tmp
cd ../../../ng-webmcp-playground && npm i /tmp/ng-webmcp-compat-0.0.1.tgz
```

`npm i file:../ng-webmcp-compat/dist/ng-webmcp-compat` **symlinks**, and that breaks
secondary entry points. `ng-webmcp-compat/strict` imports its types from the primary
entry by package name; TypeScript resolves symlinks to their real path, so from
`dist/ng-webmcp-compat/strict/` the self-reference cannot be found. The types
silently degrade to `any` and you get `TS7031: implicitly has an 'any' type` on tool
arguments — with no indication of the real cause. A packed tarball installs as a real
directory and resolves correctly.

## Notes on the code

- **`src/app/game/game-store.ts`** knows nothing about WebMCP. Exposing an app to an
  agent should not mean rewriting the app; tools are a thin layer on services you have.
- **Nothing validates agent input for you.** Neither the spec nor Angular checks
  arguments against `inputSchema` — it is a hint to the model, not a runtime guard.
- **Each tool gets its own `provideExperimentalWebMcpTools` call.** One call per
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

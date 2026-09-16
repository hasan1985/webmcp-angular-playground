import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideWebMcpTools} from 'webmcp-angular';

import {routes} from './app.routes';
import {getBoardTool, makeMoveTool, resetGameTool} from './game/game.tools';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),

    // App-lifetime tools: registered when the app bootstraps, unregistered when
    // the root injector is destroyed. Page-scoped tools are declared inside the
    // component that owns them instead — see notes.page.ts.
    //
    // ── Why three calls instead of one array ────────────────────────────────
    // The signature is:
    //
    //   <const S extends JsonSchemaForInference>(tools: WebMcpToolDescriptor<S>[])
    //
    // One type parameter for the whole array, so every tool in a single call must
    // share one schema type. Tools with *different* input schemas have no valid S,
    // and `provideWebMcpTools([getBoardTool, makeMoveTool])` fails to
    // compile — that is angular/angular#70125, still open.
    //
    // Passing each tool in its own call keeps every array homogeneous, so the
    // whole thing type-checks with no casts and `execute` keeps its real argument
    // types. The alternative you will see elsewhere is
    // `as unknown as WebMcpToolDescriptor<never>[]`, which compiles but throws away
    // the typing that made the schema worth writing.
    //
    // Collapse these into one call if #70125 is ever fixed.
    provideWebMcpTools([getBoardTool]),
    provideWebMcpTools([makeMoveTool]),
    provideWebMcpTools([resetGameTool]),
  ],
};

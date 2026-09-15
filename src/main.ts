import {isDevMode} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {createWebMcpBridge} from 'webmcp-angular/bridge';
import {installWebMcpPolyfill} from 'webmcp-angular/polyfill';

import {App} from './app/app';
import {appConfig} from './app/app.config';

// Installs `document.modelContext` where the browser has none, and leaves a real
// implementation alone if one exists.
//
// Resolved BEFORE bootstrap on purpose: tools register from an environment
// initializer during bootstrap, so anything that installs the API asynchronously
// has to finish first, or they silently no-op.
//
// A `.then` chain rather than top-level `await` — Angular's default browserslist
// targets do not allow top-level await, and the build fails with
// "Top-level await is not available in the configured target environment".
installWebMcpPolyfill()
  .then((backing) => {
    console.info(`[webmcp] backed by: ${backing}`);
    return bootstrapApplication(App, appConfig);
  })
  .then(() => {
    // Exposes the same tools over MCP/JSON-RPC so a browser extension or the
    // @mcp-b local relay can reach them from outside the page — the one thing
    // document.modelContext alone cannot do.
    const bridge = createWebMcpBridge({
      allowedOrigins: [window.location.origin],
      serverInfo: {name: 'webmcp-angular-playground', version: '0.0.0'},
    });
    bridge.start();
    console.info('[webmcp] JSON-RPC bridge listening on channel "mcp-default"');
  })
  .then(async () => {
    // The inspector: Ctrl/Cmd + Shift + M. The DYNAMIC import is what keeps it out
    // of the production bundle — a static import would pull it into main.js whether
    // or not isDevMode() is true.
    if (isDevMode()) {
      const {mountWebMcpDevtools} = await import('webmcp-angular/devtools');
      mountWebMcpDevtools();
    }
  })
  .catch((err) => console.error(err));

import {isDevMode} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
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
  // The JSON-RPC bridge — for agents OUTSIDE the page — is not started here. It is
  // opt-in, behind the "External agents" switch in the header; see
  // src/app/external-agents.ts. The in-page chat does not need it.
  .then(async () => {
    // The inspector: Ctrl/Cmd + Shift + M. The DYNAMIC import is what keeps it out
    // of the production bundle — a static import would pull it into main.js whether
    // or not isDevMode() is true.
    if (isDevMode()) {
      const {mountWebMcpDevtools} = await import('webmcp-angular/devtools');
      const slot = document.getElementById('webmcp-devtools-slot');
      // Docked into its own column so it does not cover the chat panel. Falls
      // back to floating if the slot is not in the DOM for some reason.
      mountWebMcpDevtools(
        slot ? {position: 'inline', container: slot} : {position: 'bottom-left'},
      );
    }
  })
  .catch((err) => console.error(err));

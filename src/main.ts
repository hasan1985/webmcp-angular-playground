import {bootstrapApplication} from '@angular/platform-browser';
import {installWebMcpPolyfill} from 'ng-webmcp-compat/polyfill';

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
  .catch((err) => console.error(err));

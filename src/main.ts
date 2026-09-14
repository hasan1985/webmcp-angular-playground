// Installs document.modelContext where the browser does not provide it natively.
// Must run before the app bootstraps, since tools register during bootstrap.
import '@mcp-b/webmcp-polyfill/iife';

import {bootstrapApplication} from '@angular/platform-browser';

import {App} from './app/app';
import {appConfig} from './app/app.config';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

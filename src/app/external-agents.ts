import {effect, Injectable, signal} from '@angular/core';
import type {WebMcpBridge} from 'webmcp-angular/bridge';

const STORAGE_KEY = 'webmcp-external-agents';

/**
 * Whether agents OUTSIDE the page may reach this app's tools.
 *
 * The in-page chat never needs this: it reads `document.modelContext` directly.
 * The bridge exists for the other case — an extension content script, Claude
 * Desktop, Cursor — which cannot see the page's JavaScript and speaks MCP over
 * JSON-RPC instead. Opening that door is a decision the person running the app
 * should make, so it is off by default, remembered per browser, and the bridge
 * code is not even downloaded until someone turns it on.
 */
@Injectable({providedIn: 'root'})
export class ExternalAgents {
  readonly enabled = signal(readStored());
  /** True while the bridge is listening on the postMessage channel. */
  readonly listening = signal(false);

  private bridge: WebMcpBridge | null = null;
  private loading: Promise<WebMcpBridge> | null = null;

  constructor() {
    effect(() => {
      const on = this.enabled();
      writeStored(on);
      void (on ? this.start() : this.stop());
    });
  }

  private async start(): Promise<void> {
    // Lazy: the bridge is its own entry point, and a dynamic import keeps it in
    // its own chunk, requested only when this switch is first turned on.
    this.loading ??= import('webmcp-angular/bridge').then(({createWebMcpBridge}) =>
      createWebMcpBridge({
        allowedOrigins: [window.location.origin],
        serverInfo: {name: 'webmcp-angular-playground', version: '0.0.0'},
      }),
    );
    const bridge = await this.loading;
    // The switch may have flipped back while the import was in flight.
    if (!this.enabled()) return;
    this.bridge = bridge;
    if (!bridge.running) bridge.start();
    this.listening.set(true);
    console.info('[webmcp] JSON-RPC bridge listening on channel "mcp-default"');
  }

  private async stop(): Promise<void> {
    if (this.bridge?.running) this.bridge.stop();
    this.listening.set(false);
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the switch still works for this page load.
  }
}

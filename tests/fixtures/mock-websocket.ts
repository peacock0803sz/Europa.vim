/**
 * MockWebSocket and MockWebSocketServer for unit-testing WebSocket-dependent
 * code without a real network connection.
 *
 * Phase 3.2: extracted from mock-host.ts
 *
 * @module tests/fixtures/mock-websocket
 */

// ---------------------------------------------------------------------------
// MockWebSocketServer interface
// ---------------------------------------------------------------------------

/** Server-side controller exposed by MockWebSocket for test orchestration. */
export interface MockWebSocketServer {
  /** Complete the WebSocket handshake with the given subprotocol. */
  accept(protocol: string): void;
  /** Push a text or binary message to the client listener. */
  receive(data: string | ArrayBuffer): void;
  /** Trigger a close event on the client side. */
  close(code?: number, reason?: string): void;
  /** Trigger an error event on the client side. */
  error(): void;
  /** All data frames sent by the client via ws.send(). */
  readonly sentData: ReadonlyArray<string | ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// MockWebSocket class
// ---------------------------------------------------------------------------

/**
 * Minimal WebSocket lookalike for unit testing WebSocket-dependent code.
 *
 * Exposes a `server` controller so tests can simulate server-side events
 * (accept/receive/close/error) without a real TCP connection.
 *
 * Usage:
 *   const ws = new MockWebSocket("ws://localhost:8888/channels", ["v1.kernel..."]);
 *   ws.addEventListener("open", () => { ... });
 *   ws.server.accept("v1.kernel.websocket.jupyter.org");
 */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  protocol = "";
  readonly url: string;
  readonly requestedProtocols: string[];

  private readonly _listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private readonly _sentData: Array<string | ArrayBuffer> = [];

  readonly server: MockWebSocketServer;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.requestedProtocols = Array.isArray(protocols)
      ? protocols
      : protocols
      ? [protocols]
      : [];

    // deno-lint-ignore no-this-alias
    const self = this;
    this.server = {
      accept(protocol: string): void {
        self.protocol = protocol;
        self.readyState = MockWebSocket.OPEN;
        self._dispatch(new Event("open"));
      },
      receive(data: string | ArrayBuffer): void {
        self._dispatch(new MessageEvent("message", { data }));
      },
      close(code = 1000, reason = ""): void {
        self.readyState = MockWebSocket.CLOSED;
        self._dispatch(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
      },
      error(): void {
        self._dispatch(new Event("error"));
      },
      get sentData(): ReadonlyArray<string | ArrayBuffer> {
        return self._sentData;
      },
    };
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this._listeners.get(type) ?? new Set();
    set.add(listener);
    this._listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this._listeners.get(type)?.delete(listener);
  }

  send(data: string | ArrayBuffer): void {
    this._sentData.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === MockWebSocket.OPEN || this.readyState === MockWebSocket.CONNECTING) {
      this.readyState = MockWebSocket.CLOSING;
      this.server.close(code, reason);
    }
  }

  private _dispatch(event: Event): void {
    for (const listener of this._listeners.get(event.type) ?? []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

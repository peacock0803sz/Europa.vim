/**
 * In-memory ZMQ transport double for ZmqKernelClient specs (no real zeromq).
 *
 * Provides a zeromq-module-like object (`module`) with fake Dealer / Subscriber
 * / Request classes backed by in-memory frame queues. A spec injects it via the
 * client's `importZmq` seam, so the fast gate stays FFI-free. The kernel logic
 * is scripted: it answers kernel_info_request with a signed kernel_info_reply,
 * answers execute_request with an iopub sequence plus a shell execute_reply, and
 * optionally answers control interrupt_request. It records whether a
 * shutdown_request ever arrives so shutdown specs can assert it does not
 * (FR-010, non-owned attach).
 *
 * @module tests/fixtures/mock-zmq-kernel
 */

import { decodeZmqMock, encodeZmqMock } from "./mock-zmq-codec.ts";
import type { MockKernelMessage } from "./mock-wire-codec.ts";

type Frames = Uint8Array[];
type Channel = "shell" | "iopub" | "stdin" | "control" | "hb";

/** Connection parameters the mock needs to route and sign (subset of ConnectionFile). */
export interface MockZmqParams {
  shell_port: number;
  iopub_port: number;
  stdin_port: number;
  control_port: number;
  hb_port: number;
  ip: string;
  key: string;
  signature_scheme: string;
}

/** Behaviour toggles for individual specs. */
export interface MockZmqOptions {
  /** Whether to answer kernel_info_request (false drives the handshake timeout). */
  respondToKernelInfo?: boolean;
  /** Whether the control channel answers interrupt_request (signal-only kernels do not). */
  controlRespondsToInterrupt?: boolean;
  /** kernel_name reported in kernel_info_reply.content. */
  kernelName?: string;
  /** Builds the iopub message sequence for an execute_request (excludes the shell reply). */
  scriptExecute?: (req: MockKernelMessage, session: string) => MockKernelMessage[];
}

const ENC = new TextEncoder();

/** Async queue of frame lists with a closeable async iterator (mirrors a zeromq socket). */
class FrameQueue {
  #buffer: Frames[] = [];
  #waiters: Array<(r: IteratorResult<Frames>) => void> = [];
  #closed = false;

  push(frames: Frames): void {
    if (this.#closed) return;
    const w = this.#waiters.shift();
    if (w) w({ value: frames, done: false });
    else this.#buffer.push(frames);
  }

  close(): void {
    this.#closed = true;
    for (const w of this.#waiters) w({ value: undefined as never, done: true });
    this.#waiters = [];
  }

  next(): Promise<IteratorResult<Frames>> {
    if (this.#buffer.length > 0) {
      return Promise.resolve({ value: this.#buffer.shift()!, done: false });
    }
    if (this.#closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<Frames> {
    return { next: () => this.next() };
  }
}

function portOf(addr: string): number {
  return Number(addr.slice(addr.lastIndexOf(":") + 1));
}

/** The scripted kernel: routes sent frames per channel and enqueues replies. */
class MockZmqKernel {
  readonly #params: MockZmqParams;
  readonly #opts: MockZmqOptions;
  readonly #portToChannel: Map<number, Channel>;
  readonly #queues: Record<Channel, FrameQueue>;
  readonly session = "mock-session-" + crypto.randomUUID();
  readonly closedChannels = new Set<Channel>();
  shutdownRequestSeen = false;
  interruptRequestSeen = false;

  constructor(params: MockZmqParams, opts: MockZmqOptions) {
    this.#params = params;
    this.#opts = opts;
    this.#portToChannel = new Map([
      [params.shell_port, "shell"],
      [params.iopub_port, "iopub"],
      [params.stdin_port, "stdin"],
      [params.control_port, "control"],
      [params.hb_port, "hb"],
    ]);
    this.#queues = {
      shell: new FrameQueue(),
      iopub: new FrameQueue(),
      stdin: new FrameQueue(),
      control: new FrameQueue(),
      hb: new FrameQueue(),
    };
  }

  channelForAddr(addr: string): Channel {
    const ch = this.#portToChannel.get(portOf(addr));
    if (!ch) throw new Error(`mock-zmq: no channel for ${addr}`);
    return ch;
  }

  queue(ch: Channel): FrameQueue {
    return this.#queues[ch];
  }

  closeChannel(ch: Channel): void {
    this.closedChannels.add(ch);
    this.#queues[ch].close();
  }

  #emit(ch: Channel, msg: MockKernelMessage): void {
    this.#queues[ch].push(
      encodeZmqMock(msg, this.#params.key, this.#params.signature_scheme),
    );
  }

  #reply(
    msgType: string,
    parent: MockKernelMessage,
    content: Record<string, unknown>,
  ): MockKernelMessage {
    return {
      header: {
        msg_id: crypto.randomUUID(),
        msg_type: msgType,
        username: "kernel",
        session: this.session,
        date: new Date().toISOString(),
        version: "5.3",
      },
      parent_header: parent.header as unknown as Record<string, unknown>,
      metadata: {},
      content,
      buffers: [],
    };
  }

  /** Decode a frame the client sent and enqueue the scripted reply (routed by msg_type). */
  onSend(frames: Frames): void {
    const msg = decodeZmqMock(frames, this.#params.key, this.#params.signature_scheme);
    const type = msg.header.msg_type;

    if (type === "shutdown_request") {
      // FR-010: attach is non-owning; the client must never send this.
      this.shutdownRequestSeen = true;
      return;
    }
    if (type === "interrupt_request") {
      this.interruptRequestSeen = true;
      if (this.#opts.controlRespondsToInterrupt) {
        this.#emit("control", this.#reply("interrupt_reply", msg, { status: "ok" }));
      }
      return;
    }
    if (type === "kernel_info_request") {
      if (this.#opts.respondToKernelInfo === false) return; // drive handshake timeout
      this.#emit(
        "shell",
        this.#reply("kernel_info_reply", msg, {
          status: "ok",
          protocol_version: "5.3",
          implementation: "mock",
          implementation_version: "0.0.0",
          language_info: { name: "python", version: "3.13.0", mimetype: "text/x-python", file_extension: ".py" },
          banner: "Mock ZMQ kernel",
          kernel_name: this.#opts.kernelName ?? "python3",
        }),
      );
      // status idle on iopub mirrors a real kernel settling after info.
      this.#emit("iopub", this.#reply("status", msg, { execution_state: "idle" }));
      return;
    }
    if (type === "execute_request") {
      const seq = this.#opts.scriptExecute
        ? this.#opts.scriptExecute(msg, this.session)
        : this.#defaultExecuteIopub(msg);
      for (const m of seq) {
        // status / execute_input / stream / results / error broadcast on iopub.
        this.#emit("iopub", m);
      }
      this.#emit(
        "shell",
        this.#reply("execute_reply", msg, { status: "ok", execution_count: 1 }),
      );
      return;
    }
    // stdin replies and anything else are ignored by the mock.
  }

  #defaultExecuteIopub(req: MockKernelMessage): MockKernelMessage[] {
    const code = String((req.content as { code?: unknown }).code ?? "");
    return [
      this.#reply("status", req, { execution_state: "busy" }),
      this.#reply("execute_input", req, { code, execution_count: 1 }),
      this.#reply("stream", req, { name: "stdout", text: "ok\n" }),
      this.#reply("execute_result", req, {
        execution_count: 1,
        data: { "text/plain": "ok" },
        metadata: {},
      }),
      this.#reply("status", req, { execution_state: "idle" }),
    ];
  }
}

/** A mock socket shared shape: connect / send / async-iterate / close. */
class MockSocket {
  protected channel?: Channel;
  protected readonly kernel: MockZmqKernel;
  routingId: string | null = null;

  constructor(kernel: MockZmqKernel) {
    this.kernel = kernel;
  }

  connect(addr: string): void {
    this.channel = this.kernel.channelForAddr(addr);
  }

  send(frames: (Uint8Array | string)[]): Promise<void> {
    const normalised = frames.map((f) => typeof f === "string" ? ENC.encode(f) : f);
    if (this.channel) this.kernel.onSend(normalised);
    return Promise.resolve();
  }

  close(): void {
    if (this.channel) this.kernel.closeChannel(this.channel);
  }

  [Symbol.asyncIterator](): AsyncIterator<Frames> {
    // Sockets only ever iterate after connect(); shell/iopub/control are read.
    return this.kernel.queue(this.channel!)[Symbol.asyncIterator]();
  }
}

class MockSubscriber extends MockSocket {
  subscribe(_topic?: string): void {
    // No-op: the mock delivers every iopub frame regardless of topic filter.
  }
}

class MockRequest extends MockSocket {
  receive(): Promise<Frames> {
    return this.kernel.queue(this.channel!).next().then((r) => r.value);
  }
}

/** A zeromq-module-like object plus a handle to inspect/observe the mock kernel. */
export interface MockZmqKernelHandle {
  /** Inject as the result of the client's `importZmq` (cast to the zeromq module type). */
  module: {
    Dealer: new () => MockSocket;
    Subscriber: new () => MockSubscriber;
    Request: new () => MockRequest;
  };
  /** True once the client sent an interrupt_request on the control channel. */
  interruptRequestSeen(): boolean;
  /** True if the client ever sent a shutdown_request (must stay false for attach, FR-010). */
  shutdownRequestSeen(): boolean;
  /** Channels the client close()d (shutdown specs assert all five). */
  closedChannels(): Set<Channel>;
}

/**
 * Build an in-memory ZMQ transport double for one connection_file.
 *
 * @param params - ports / ip / key / signature_scheme matching the connection_file the client parses
 * @param opts - per-spec behaviour toggles (handshake/interrupt/execute scripting)
 */
export function makeMockZmqKernel(
  params: MockZmqParams,
  opts: MockZmqOptions = {},
): MockZmqKernelHandle {
  const kernel = new MockZmqKernel(params, opts);
  return {
    module: {
      Dealer: class extends MockSocket {
        constructor() {
          super(kernel);
        }
      },
      Subscriber: class extends MockSubscriber {
        constructor() {
          super(kernel);
        }
      },
      Request: class extends MockRequest {
        constructor() {
          super(kernel);
        }
      },
    },
    interruptRequestSeen: () => kernel.interruptRequestSeen,
    shutdownRequestSeen: () => kernel.shutdownRequestSeen,
    closedChannels: () => kernel.closedChannels,
  };
}

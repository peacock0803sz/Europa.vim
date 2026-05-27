/**
 * BDD specs for kernel authentication helpers.
 *
 * @spec-id europa.kernel.auth.token-priority
 * @spec-id europa.kernel.auth.subprotocol-strings
 * @spec-id europa.kernel.auth.subprotocol-mode-switch
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import {
  buildAuthHeader,
  buildSubprotocols,
  resolveToken,
} from "../../../denops/europa/kernel/auth.ts";
import type { EuropaConfig } from "../../../schema/config.ts";
import { EuropaKernelError } from "../../../denops/europa/kernel/errors.ts";

// Minimal mock for the denops-shaped host needed by resolveToken
function makeMockDenops(vars: Record<string, unknown> = {}) {
  return {
    eval: (expr: string): Promise<unknown> => {
      const match = expr.match(/^get\(g:, '([^']+)', '([^']*)'\)$/);
      if (match) {
        const key = match[1];
        return Promise.resolve(vars[key] ?? match[2]);
      }
      return Promise.resolve(null);
    },
  };
}

const BASE_CONFIG: EuropaConfig = {
  connection_mode: "server",
  jupyter_url: "http://localhost:8888",
  jupyter_token: "",
  jupyter_ws_subprotocol: "auto",
  default_kernel: "python3",
  auto_start_kernel: false,
  jupyter_executable: "",
  python_env_detect: "auto",
  image_backend: "auto",
  mime_priority: ["image/png", "text/plain"],
  max_output_lines: 100,
  cell_border_chars: ["╭", "─", "╮", "╰", "╯"],
  cell_border_padding: 4,
  cell_border_align: "left" as const,
  lazy_padding: 10,
  auto_save: false,
  use_subprocess: true,
  wsReconnectMaxRetries: 5,
  wsReconnectInitialIntervalMs: 1000,
  wsReconnectMultiplier: 2.0,
  kernelInfoTimeoutMs: 10000,
  undo_max_history: 100,
  disable_default_mappings: false,
  ts_highlight: "auto",
  lsp_enable: "auto",
};

describe("resolveToken — priority order", () => {
  const ENV_BACKUP: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_BACKUP.JUPYTER_TOKEN = Deno.env.get("JUPYTER_TOKEN");
    Deno.env.delete("JUPYTER_TOKEN");
  });

  afterEach(() => {
    if (ENV_BACKUP.JUPYTER_TOKEN !== undefined) {
      Deno.env.set("JUPYTER_TOKEN", ENV_BACKUP.JUPYTER_TOKEN);
    } else {
      Deno.env.delete("JUPYTER_TOKEN");
    }
  });

  it("priority 1: g:europa_jupyter_token (Vim var) wins over env", async () => {
    Deno.env.set("JUPYTER_TOKEN", "env-token");
    const denops = makeMockDenops({ europa_jupyter_token: "vim-token" });
    const config = { ...BASE_CONFIG };
    const token = await resolveToken(denops as never, config, true);
    assertEquals(token, "vim-token");
  });

  it("priority 1: non-empty config.jupyter_token wins over env", async () => {
    Deno.env.set("JUPYTER_TOKEN", "env-token");
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG, jupyter_token: "config-token" };
    const token = await resolveToken(denops as never, config, true);
    assertEquals(token, "config-token");
  });

  it("priority 2: $JUPYTER_TOKEN env var when config empty", async () => {
    Deno.env.set("JUPYTER_TOKEN", "env-token");
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG };
    const token = await resolveToken(denops as never, config, true);
    assertEquals(token, "env-token");
  });

  it("priority 3: random 32-char token when subprocess mode and no other source", async () => {
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG };
    const token = await resolveToken(denops as never, config, true);
    assertEquals(token.length, 32);
    // All hex characters (from randomUUID().replaceAll('-', ''))
    assertEquals(/^[0-9a-f]{32}$/.test(token), true);
  });

  it("two calls produce different random tokens in subprocess mode", async () => {
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG };
    const t1 = await resolveToken(denops as never, config, true);
    const t2 = await resolveToken(denops as never, config, true);
    // Statistically impossible to be equal
    assertEquals(t1 !== t2, true);
  });

  it("throws TOKEN_MISSING when attach mode and no token configured", async () => {
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG };
    await assertRejects(
      () => resolveToken(denops as never, config, false),
      EuropaKernelError,
      undefined,
    );
    try {
      await resolveToken(denops as never, config, false);
    } catch (e) {
      assertEquals((e as EuropaKernelError).code, "TOKEN_MISSING");
    }
  });

  it("does not throw TOKEN_MISSING when attach mode with config token", async () => {
    const denops = makeMockDenops({});
    const config = { ...BASE_CONFIG, jupyter_token: "external-token" };
    const token = await resolveToken(denops as never, config, false);
    assertEquals(token, "external-token");
  });
});

describe("buildAuthHeader", () => {
  it("returns 'Authorization: token <TOKEN>' format", () => {
    const header = buildAuthHeader("mytoken123");
    assertEquals(header, "token mytoken123");
  });

  it("works with empty string (test only — real use requires non-empty)", () => {
    const header = buildAuthHeader("");
    assertEquals(header, "token ");
  });

  it("handles hex token", () => {
    const header = buildAuthHeader("abc123def456");
    assertEquals(header, "token abc123def456");
  });
});

describe("buildSubprotocols — subprotocol mode switch (SC-006)", () => {
  it("auto mode returns all 3 subprotocols", () => {
    const config = { ...BASE_CONFIG, jupyter_ws_subprotocol: "auto" as const };
    const protos = buildSubprotocols(config, "mytoken");
    assertEquals(protos.length, 3);
    assertEquals(protos.includes("v1.kernel.websocket.jupyter.org"), true);
    assertEquals(protos.includes("v1.token.websocket.jupyter.org"), true);
    assertEquals(
      protos.includes("v1.token.websocket.jupyter.org.mytoken"),
      true,
    );
  });

  it("v1 mode returns v1 subprotocols only (2 entries)", () => {
    const config = { ...BASE_CONFIG, jupyter_ws_subprotocol: "v1" as const };
    const protos = buildSubprotocols(config, "mytoken");
    assertEquals(protos.length, 2);
    assertEquals(protos.includes("v1.kernel.websocket.jupyter.org"), true);
    assertEquals(
      protos.includes("v1.token.websocket.jupyter.org.mytoken"),
      true,
    );
  });

  it("default mode returns empty array (= no subprotocol)", () => {
    const config = {
      ...BASE_CONFIG,
      jupyter_ws_subprotocol: "default" as const,
    };
    const protos = buildSubprotocols(config, "mytoken");
    assertEquals(protos, []);
  });

  it("auto mode token-suffixed subprotocol includes the token", () => {
    const config = { ...BASE_CONFIG, jupyter_ws_subprotocol: "auto" as const };
    const protos = buildSubprotocols(config, "deadbeef");
    const tokenProto = protos.find((p) =>
      p.startsWith("v1.token.websocket.jupyter.org.")
    );
    assertEquals(tokenProto, "v1.token.websocket.jupyter.org.deadbeef");
  });

  it("v1 mode token-suffixed subprotocol includes the token", () => {
    const config = { ...BASE_CONFIG, jupyter_ws_subprotocol: "v1" as const };
    const protos = buildSubprotocols(config, "secret42");
    const tokenProto = protos.find((p) =>
      p.startsWith("v1.token.websocket.jupyter.org.")
    );
    assertEquals(tokenProto, "v1.token.websocket.jupyter.org.secret42");
  });
});

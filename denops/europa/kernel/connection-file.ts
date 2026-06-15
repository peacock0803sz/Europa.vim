import { Value } from "@sinclair/typebox/value";
import {
  type ConnectionFile,
  ConnectionFileSchema,
} from "../../../schema/connection-file.ts";
import { EuropaKernelError } from "./errors.ts";

/**
 * Reads, parses, and validates a Jupyter connection file for ZMQ attach.
 *
 * Malformed inputs (missing file, bad JSON, schema-invalid) and unsupported
 * inputs (non-tcp transport, non-hmac-sha256 scheme) report distinct error
 * codes so the user can tell "broken" from "not yet supported" (SC-004).
 *
 * @param path - path to the connection.json passed to `:EuropaAttach`
 * @returns the validated ConnectionFile (transport === 'tcp', scheme usable)
 * @throws EuropaKernelError CONNECTION_FILE_INVALID on read / JSON / schema failure
 * @throws EuropaKernelError CONNECTION_FILE_UNSUPPORTED_TRANSPORT when transport !== 'tcp'
 * @throws EuropaKernelError CONNECTION_FILE_UNSUPPORTED_SCHEME when scheme !== 'hmac-sha256' and key is non-empty
 * @category Kernel
 * @spec-id europa.kernel.connection-file.parse
 * @spec-id europa.kernel.connection-file.tcp-only-reject
 * @spec-id europa.kernel.connection-file.missing-key
 * @spec-id europa.kernel.connection-file.unsupported-scheme
 */
export async function parseConnectionFile(
  path: string,
): Promise<ConnectionFile> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (e) {
    throw new EuropaKernelError(
      "CONNECTION_FILE_INVALID",
      `cannot read connection file '${path}': ${
        e instanceof Error ? e.message : String(e)
      }`,
      e,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new EuropaKernelError(
      "CONNECTION_FILE_INVALID",
      `connection file '${path}' is not valid JSON`,
      e,
    );
  }

  if (!Value.Check(ConnectionFileSchema, parsed)) {
    const first = [...Value.Errors(ConnectionFileSchema, parsed)][0];
    const at = first?.path ? ` (at '${first.path}')` : "";
    throw new EuropaKernelError(
      "CONNECTION_FILE_INVALID",
      `connection file '${path}' is missing or has an invalid field${at}`,
    );
  }
  const cf = parsed as ConnectionFile;

  // tcp-only / hmac-sha256-only are deferred-not-malformed conditions, so they
  // reject with their own codes after Value.Check rather than as schema literals
  // (Q3 / FR-003) — that keeps "unsupported" distinguishable from "broken".
  if (cf.transport !== "tcp") {
    throw new EuropaKernelError(
      "CONNECTION_FILE_UNSUPPORTED_TRANSPORT",
      `connection file transport '${cf.transport}' is unsupported; this slice handles tcp only`,
    );
  }
  if (cf.signature_scheme !== "hmac-sha256" && cf.key !== "") {
    throw new EuropaKernelError(
      "CONNECTION_FILE_UNSUPPORTED_SCHEME",
      `signature_scheme '${cf.signature_scheme}' is unsupported; this slice handles hmac-sha256 only`,
    );
  }
  return cf;
}

/**
 * Minimal type stub for @std/cli/parse-args used by TypeDoc generation.
 */
export declare function parseArgs(
  args: string[],
  options?: {
    string?: string[];
    boolean?: string[];
    "--"?: boolean;
  },
): Record<string, string | undefined> & { "--"?: string[] };

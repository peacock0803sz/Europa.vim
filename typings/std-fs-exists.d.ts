/**
 * Minimal type stub for @std/fs/exists used by TypeDoc generation.
 */
export declare function exists(
  path: string,
  options?: { isFile?: boolean; isDirectory?: boolean; isSymlink?: boolean },
): Promise<boolean>;

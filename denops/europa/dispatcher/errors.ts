/** Thrown by dispatcher methods that are not yet implemented. */
export class UnimplementedError extends Error {
  constructor(method: string) {
    super(`UnimplementedError: ${method} is not implemented in Phase 2`);
    this.name = "UnimplementedError";
  }
}

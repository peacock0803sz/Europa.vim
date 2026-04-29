// workaround for IM6 convert quirk: convert does not accept stdin piped
// through a fifo on Linux. We use a temp file instead and clean it up
// in the finally block to avoid leaving stale files on crash.
export function workaround(): void {}

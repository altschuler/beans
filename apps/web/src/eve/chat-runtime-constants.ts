export const CHAT_STALE_ADMISSION_CUTOFF_MS = 120_000
export const CHAT_STALE_RUNNING_RECONCILIATION_MS = 30_000
export const CHAT_UPSTREAM_POST_TIMEOUT_MS = 30_000
export const CHAT_RECONCILIATION_TIMEOUT_MS = 15_000
export const CHAT_POST_BOUNDARY_QUIET_PERIOD_MS = 250
// A pending dispatch can own the full POST timeout. Add one complete reconciliation window and
// its open/quiet margin before another process may conservatively take over the durable marker.
export const CHAT_FOLLOW_UP_DISPATCH_CUTOFF_MS = CHAT_UPSTREAM_POST_TIMEOUT_MS +
  CHAT_RECONCILIATION_TIMEOUT_MS + CHAT_POST_BOUNDARY_QUIET_PERIOD_MS
export const CHAT_ATTACHMENT_RETRY_DELAYS_MS = [50, 150, 300] as const
export const CHAT_RECEIPT_ACK_RETRY_DELAYS_MS = [50, 150, 300, 1_000, 2_000] as const
export const CHAT_BOOTSTRAP_POLL_INITIAL_MS = 250
export const CHAT_BOOTSTRAP_POLL_MAX_MS = 2_000
export const CHAT_BOOTSTRAP_POLL_MAX_ELAPSED_MS = 125_000
export const CHAT_MAX_NDJSON_LINE_BYTES = 1_048_576

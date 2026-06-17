## Before declaring work done

Review for repo fit, not just correctness.

- Remove unnecessary helpers, wrappers, and indirection.
- Do a collapse pass for trivial helpers; inline one-off wrappers around simple expressions unless they encode reused domain behavior.
- Collapse duplicated prop plumbing where callers pass labels, descriptions, placeholders, or config that the child can derive from a stable domain input.
- Check for boundary or layer violations; keep logic in the narrowest valid layer.
- Follow existing naming and file patterns; avoid naming drift.
- Make sure feature-local logic has not been promoted to shared code too early.
- Verify user-facing error handling maps known-safe codes to localized messages and falls back to generic copy for unknown errors.
- Assess whether docs need updating, including source-of-truth docs, reference docs, INBOX.md entries and backlog notes.
- Check whether a `HANDOFF.md` exists in the worktree or change set; if it does, flag it to the user because handoff documents should not be merged into the primary branch.
- Exclude active plan docs, handoff notes, and other process artifacts unless they are intentionally part of the change.


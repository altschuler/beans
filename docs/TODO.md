# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Category management cleanup

- Simplify category management dialog mounting. Still relevant: `src/components/ledger/category-management-page.tsx` mounts four dialogs at all times and uses `key` resets plus repeated `dialog.kind` guards. (Deferred: to be handled by the new dialog system.)
  - Render only the active dialog from a `switch`/helper on `dialog.kind`, or make form resets explicit inside the dialog components. Avoid keeping closed dialogs mounted just to preserve reset behavior.
  - Keep the current stacked flow intact: Add category → Add group should return to category creation, and successful group creation should pass the new group id back as `initialGroupId`.
  - Once only the active dialog is rendered, remove unnecessary `key` reset props and reduce inline `dialog.kind === ... ? ... : ...` guards.

## Production ready

- Add production zero-cache config before deploy. No production deployment/config exists beyond dev/env-example basics. Separate `ZERO_CVR_DB`/`ZERO_CHANGE_DB`, set `ZERO_ADMIN_PASSWORD`, configure a persistent `ZERO_REPLICA_FILE`, enable CVR garbage collection, and define an explicit publication.
- Document and harden production Zero cookie deployment. If `zero-cache` runs on a subdomain, Better Auth cookies need appropriate cross-subdomain configuration, and auth cookies must not use `SameSite=None`.

## Zero review

Findings from an idiomatic-usage review against the official Zero docs. The plumbing (custom synced queries + custom mutators, multi-tenant security) is correct; these items are about getting Zero's value (optimistic writes, instant reads) and fixing two data-correctness issues.

### Cleanups (minor)

- Add cross-tenant isolation tests for each query — the type system won't catch a missing `whereExists`.
- Prefer `NODE_EXTRA_CA_CERTS` over `NODE_TLS_REJECT_UNAUTHORIZED=0` in the `dev:zero` script (the `build` script already does this); confirmed not in the `start` path.

# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Auth review

- Clear or intentionally retain Zero local data on logout. Current sign-out only calls Better Auth and navigates away; Zero docs note synced IndexedDB data remains unless `zero.delete()` is called.
- Document and harden production Zero cookie deployment. If `zero-cache` runs on a subdomain, Better Auth cookies need appropriate cross-subdomain configuration, and auth cookies must not use `SameSite=None`.
- Add handling for Zero `needs-auth` connection state after query/mutate endpoints return `401`, so expired sessions can reconnect after login or route users back to sign-in cleanly.
- Remove production risk from auth development defaults: fail fast on missing production `BETTER_AUTH_SECRET`, and ensure prefilled test credentials in the auth form are dev/test-only.
- Add focused auth/Zero tests for unauthenticated query/mutate `401`s, authenticated server-verified `userID` propagation, and auth tables remaining excluded from Zero schema generation.

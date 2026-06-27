# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Category management cleanup

- Simplify category management dialog mounting. Still relevant: `apps/web/src/components/ledger/category-management-page.tsx` mounts four dialogs at all times and uses `key` resets plus repeated `dialog.kind` guards. (Deferred: to be handled by the new dialog system.)
  - Render only the active dialog from a `switch`/helper on `dialog.kind`, or make form resets explicit inside the dialog components. Avoid keeping closed dialogs mounted just to preserve reset behavior.
  - Keep the current stacked flow intact: Add category → Add group should return to category creation, and successful group creation should pass the new group id back as `initialGroupId`.
  - Once only the active dialog is rendered, remove unnecessary `key` reset props and reduce inline `dialog.kind === ... ? ... : ...` guards.

## Local development configuration

- Make local service ports easy to change from one documented place. Current web defaults are duplicated across `apps/web/package.json` (`dev:app` Vite CLI `--port`), `apps/web/vite.config.ts` (`server.port`), `apps/web/.env.example` (`ZERO_QUERY_URL`, `ZERO_MUTATE_URL`, `BETTER_AUTH_URL`, `VITE_PUBLIC_APP_URL`, `PENGE_FLUE_BASE_URL`), `apps/web/playwright.config.ts` (`use.baseURL`, `webServer.url`), `apps/web/tests/setup/env.ts` (test env fallbacks), `apps/web/src/auth/server.ts` (`BETTER_AUTH_URL` fallback), `apps/web/src/banking/banking-fns.ts` (`VITE_PUBLIC_APP_URL` fallback), `apps/web/src/routes/api/gocardless/callback.ts` (`VITE_PUBLIC_APP_URL` fallback), and `README.md`. Local untracked `apps/web/.env` also needs to mirror these values when present.
- Current Flue defaults are split across `apps/flue/package.json` (`flue dev --port`), `apps/flue/.env.example` (`PORT`), `apps/web/.env.example` (`PENGE_FLUE_BASE_URL`), `docs/ARCHITECTURE.md`, and `README.md`. Local untracked `apps/flue/.env` also needs to mirror these values when present. `justfile` and root `package.json` start these package scripts indirectly, so they should remain part of any future port-configuration review even when they do not contain numeric ports.

## Production ready

- Add a soft per-row agent activity marker for Flue categorization. The first agentic workflow will use team-level active workflow state only; a future UI improvement can show “agent is considering this row” as informational activity, not as a claim, lease, or write lock.
- Replace the first-slice Flue internal service token with a proper least-privilege authorization boundary. The Flue sidecar should not have broad read/write authority over Penge data; long term it should operate through authenticated app/domain APIs or capability-scoped services so every read and write is constrained to the authenticated user's authorized `userId` and `teamId`.
- Add production zero-cache config before deploy. No production deployment/config exists beyond dev/env-example basics. Separate `ZERO_CVR_DB`/`ZERO_CHANGE_DB`, set `ZERO_ADMIN_PASSWORD`, configure a persistent `ZERO_REPLICA_FILE`, enable CVR garbage collection, and define an explicit publication.
- Document and harden production Zero cookie deployment. If `zero-cache` runs on a subdomain, Better Auth cookies need appropriate cross-subdomain configuration, and auth cookies must not use `SameSite=None`.

## Read-model cleanup

- Unify transaction read-model derivations shared by Zero UI and Flue/domain read projections. Current UI and Flue paths independently derive review/status indicators, user-confirmed vs AI-confirmed semantics, interpretation kind, category/split/transfer summaries, and write eligibility. Prefer shared pure domain read-model functions with thin Zero relation adapters and Flue SQL adapters; avoid SQL views for now because current `drizzle-zero` generation is table/primary-key oriented and does not appear to support synced generated views.

## Zero review

Findings from an idiomatic-usage review against the official Zero docs. The plumbing (custom synced queries + custom mutators, multi-tenant security) is correct; these items are about getting Zero's value (optimistic writes, instant reads) and fixing two data-correctness issues.

### Cleanups (minor)

- Add cross-tenant isolation tests for each query — the type system won't catch a missing `whereExists`.
- Prefer `NODE_EXTRA_CA_CERTS` over `NODE_TLS_REJECT_UNAUTHORIZED=0` in the `dev:zero` script (the `build` script already does this); confirmed not in the `start` path.

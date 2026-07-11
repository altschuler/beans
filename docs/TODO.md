# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Category management cleanup

- Simplify category management dialog mounting. Still relevant: `apps/web/src/components/ledger/category-management-page.tsx` mounts four dialogs at all times and uses `key` resets plus repeated `dialog.kind` guards. (Deferred: to be handled by the new dialog system.)
  - Render only the active dialog from a `switch`/helper on `dialog.kind`, or make form resets explicit inside the dialog components. Avoid keeping closed dialogs mounted just to preserve reset behavior.
  - Keep the current stacked flow intact: Add category → Add group should return to category creation, and successful group creation should pass the new group id back as `initialGroupId`.
  - Once only the active dialog is rendered, remove unnecessary `key` reset props and reduce inline `dialog.kind === ... ? ... : ...` guards.

## Local development configuration

- Make local service ports easy to change from one documented place. Web defaults remain duplicated across `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/.env.example`, `apps/web/playwright.config.ts`, test env setup, server URL fallbacks, and `README.md`. Eve defaults span `apps/eve/package.json`, `apps/eve/.env.example`, `apps/web/.env.example`, `dev.config.mjs`, and architecture docs. Local generated env files must stay aligned.

## Production ready

- Add a soft per-row agent activity marker for Eve categorization. The first agentic workflow will use team-level active workflow state only; a future UI improvement can show “agent is considering this row” as informational activity, not as a claim, lease, or write lock.
- Add production zero-cache config before deploy. No production deployment/config exists beyond dev/env-example basics. Separate `ZERO_CVR_DB`/`ZERO_CHANGE_DB`, set `ZERO_ADMIN_PASSWORD`, configure a persistent `ZERO_REPLICA_FILE`, enable CVR garbage collection, and define a production equivalent of the local `penge_zero_app` publication.
- Document and harden production Zero cookie deployment. If `zero-cache` runs on a subdomain, Better Auth cookies need appropriate cross-subdomain configuration, and auth cookies must not use `SameSite=None`.
- Select and document the durable Eve persistence backend for deployment.
- Define retention and an app-owned deletion procedure for Eve sessions and sensitive sandbox state.
- Delete orphaned Eve sessions after ambiguous chat admission once backend cleanup APIs are available.

## Read-model cleanup

- Unify transaction read-model derivations shared by Zero UI and Eve/domain read projections. Current UI and Eve paths independently derive review/status indicators, user-confirmed vs AI-confirmed semantics, interpretation kind, category/split/transfer summaries, and write eligibility. Prefer shared pure domain read-model functions with thin Zero relation adapters and Eve/domain adapters; avoid SQL views for now because current `drizzle-zero` generation is table/primary-key oriented and does not appear to support synced generated views.

## Zero review

Findings from an idiomatic-usage review against the official Zero docs. The plumbing (custom synced queries + custom mutators, multi-tenant security) is correct; these items are about getting Zero's value (optimistic writes, instant reads) and fixing two data-correctness issues.

### Cleanups (minor)

- Add cross-tenant isolation tests for each query — the type system won't catch a missing `whereExists`.

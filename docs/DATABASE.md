# Database

Postgres is the durable database. Drizzle defines the database schema in `src/db/schema.ts`, and migrations live in `drizzle/`.

Zero is the required sync layer for app/domain data. Any user-facing application data that should be available to the client must be exposed through Zero rather than fetched directly from server routes or ad-hoc client APIs.

## Generated files are read-only

Never hand-edit generated database artifacts. Change the source files (`src/db/schema.ts`, `drizzle-zero.config.ts`, or related generator inputs) and rerun the appropriate generator instead.

Generated files include `src/zero/schema.ts`, Drizzle migration metadata under `drizzle/meta/`, and generated migration files under `drizzle/`.

## App/domain data must use Zero

Use Zero for all app/domain tables and queries:

- Define tables in `src/db/schema.ts`.
- Include app/domain tables in `drizzle-zero.config.ts`.
- Regenerate the Zero schema with `just zero-generate` or `pnpm zero:generate`.
- Do not hand-edit `src/zero/schema.ts`; it is generated.
- Add Zero queries in `src/zero/queries.ts` for client-readable domain data.
- Keep query authorization scoped by the authenticated user, usually through team membership.

Current Zero-synced app/domain tables:

- `teams`
- `team_members`
- `bank_connections`
- `bank_accounts`
- `bank_transactions`
- `ledger_account_groups`
- `ledger_accounts`
- `ledger_transactions`
- `ledger_postings`

Imported bank transactions reconcile through `ledger_postings.bank_transaction_id`, not through `ledger_transactions`.

When adding a new app/domain table, it is not complete until it is represented in both Drizzle and Zero generation config, and the generated Zero schema has been updated.

## Client mutations

Writes go through Zero custom mutators: Zod input schemas in `src/zero/mutators.ts`, server logic in `src/zero/mutators.server.ts` (and the `*.server.ts` command files it calls). The client mutators are currently no-ops, so writes are server-authoritative with no optimistic update — the UI reflects a change only after the server round-trip syncs back (see the empty-client-mutators item in `docs/TODO.md`).

Always run mutations through `runZeroMutation` (`src/lib/run-mutation.ts`); never `await zero.mutate(...)` directly. A mutator call returns `{client, server}` promises that **resolve** with a result detail — they do not reject on failure. A server-side error resolves `.server` with `{type: 'error', ...}` and Zero only logs it to the console, so awaiting the mutation alone silently swallows the error. `runZeroMutation` inspects the resolved detail, shows an error toast, and returns a success boolean:

```ts
// Fire-and-forget: the error toast still fires in the background.
void runZeroMutation(zero.mutate(mutators.ledger.categorizeTransaction({...})), 'Could not save category')

// Gate success-only follow-ups (closing a dialog, a success toast) on the result.
const ok = await runZeroMutation(zero.mutate(mutators.ledger.clearCategorizations({})), 'Could not clear')
if (ok) { /* ... */ }
```

When mocking a failing mutation in tests, resolve `.server` with `{type: 'error', error: {...}}` — do not reject it; rejection does not match Zero's real behavior.

## Tables not synced with Zero

Zero must not be used for authentication, session, account credential, verification, or other security-sensitive storage.

These tables are intentionally excluded in `drizzle-zero.config.ts`:

- `user`
- `session`
- `account`
- `verification`

Access these tables only through server-side auth/database code. Do not expose their rows through Zero queries, Zero schema generation, client components, or client-callable app data APIs.

## Local commands

```bash
just db-generate
just db-migrate
just zero-generate
```

Use `just zero-generate` after changing Drizzle tables or `drizzle-zero.config.ts`.

## Zero dev replica resets

`zero-cache-dev` keeps a local SQLite replica. In dev, keep it under `.zero-cache/` via `ZERO_REPLICA_FILE` so `just db-reset` can remove it.

After migrations that rewrite existing synced data without changing Zero column types (for example changing money `number` semantics from decimal major units to scale-4 integers), reset the Zero replica before restarting the app. Zero's client schema hash is derived from generated table/column shape, so representation-only changes may not invalidate cached replica rows by themselves.

# Database

Postgres is the durable database. The web app's Drizzle schema lives in `apps/web/src/db/schema.ts`, and web app migrations live in `apps/web/drizzle/`.

Flue runtime persistence also uses Postgres through `@flue/postgres`, but it owns separate `flue_*` tables. Those tables store Flue sessions, submissions, workflow runs, and events; they are not Penge domain tables and must not be exposed through Zero.

Zero is the required sync layer for app/domain data. Any user-facing application data that should be available to the client must be exposed through Zero rather than fetched directly from server routes or ad-hoc client APIs.

## Generated files are read-only

Never hand-edit generated database artifacts. Change the source files (`apps/web/src/db/schema.ts`, `apps/web/drizzle-zero.config.ts`, or related generator inputs) and rerun the appropriate generator instead.

Generated files include `apps/web/src/zero/schema.ts`, Drizzle migration metadata under `apps/web/drizzle/meta/`, and generated migration files under `apps/web/drizzle/`.

## App/domain data must use Zero

Use Zero for all app/domain tables and queries:

- Define tables in `apps/web/src/db/schema.ts`.
- Include app/domain tables in `apps/web/drizzle-zero.config.ts`.
- Regenerate the Zero schema with `just zero-generate` or `pnpm zero:generate` from the workspace root.
- Do not hand-edit `apps/web/src/zero/schema.ts`; it is generated.
- Add Zero queries in `apps/web/src/zero/queries.ts` for client-readable domain data.
- Keep query authorization scoped by the authenticated user, usually through team membership.

Current Zero-synced app/domain tables:

- `teams`
- `team_members`
- `agent_workflow_runs`
- `bank_connections`
- `bank_accounts`
- `bank_transactions`
- `ledger_account_groups`
- `ledger_accounts`
- `ledger_transactions`
- `ledger_postings`

Imported bank transactions reconcile through `ledger_postings.bank_transaction_id`, not through `ledger_transactions`.

## Money storage

Money amounts use the canonical representation documented in `docs/reference/money.md`: signed scale-4 integer amounts plus a currency code.

Current stored money columns:

- `bank_transactions.amount`
- `ledger_postings.amount`

These columns are Postgres `bigint` values exposed by Drizzle and Zero as `number`. Keep safe-integer database checks on stored money columns, and do not reintroduce `numeric(18,4)` or decimal-string storage for synced money amounts.

When adding a new app/domain table, it is not complete until it is represented in both Drizzle and Zero generation config, and the generated Zero schema has been updated.

`agent_workflow_runs` is the app-owned workflow visibility projection. It is Zero-synced so clients can observe active team workflows, while the separate `flue_*` runtime tables remain internal to Flue.

## Client mutations

Writes go through Zero custom mutators: Zod input schemas and optimistic client logic in `apps/web/src/zero/mutators.ts`, server logic in `apps/web/src/zero/mutators.server.ts` (and the `*.server.ts` command files it calls). Transaction categorization, splits, confirmation, and clearing apply deterministic optimistic updates in the client replica while the server remains authoritative. Transfer categorization intentionally stays server-authoritative because it depends on server-side counter-transaction matching.

Always pass mutations through `runZeroMutation` (`apps/web/src/lib/run-mutation.ts`); never `await zero.mutate(...)` directly. A mutator call returns `{client, server}` promises that **resolve** with a result detail — they do not reject on failure. A server-side error resolves `.server` with `{type: 'error', ...}` and Zero only logs it to the console, so awaiting the mutation alone silently swallows the error.

Prefer fire-and-forget for normal Zero-backed UI. The optimistic client write should drive the experience: close dialogs, popovers, and menus immediately after the local input is valid, and let `runZeroMutation` toast rare server failures in the background.

```ts
void runZeroMutation(zero.mutate(mutators.ledger.categorizeTransaction({...})), 'Could not save category')
closePopover()
```

Only await `runZeroMutation` when the next step genuinely requires server acknowledgement rather than optimistic state.

When mocking a failing mutation in tests, resolve `.server` with `{type: 'error', error: {...}}` — do not reject it; rejection does not match Zero's real behavior.

## Tables not synced with Zero

Zero must not be used for authentication, session, account credential, verification, or other security-sensitive storage.

These tables are intentionally excluded in `apps/web/drizzle-zero.config.ts`:

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

Use `just zero-generate` after changing Drizzle tables or `apps/web/drizzle-zero.config.ts`.

## Zero dev replica resets

`zero-cache-dev` keeps a local SQLite replica. In dev, keep it under `apps/web/.zero-cache/` via `ZERO_REPLICA_FILE` so `just db-reset` can remove it.

After migrations that rewrite existing synced data without changing Zero column types (for example changing money `number` semantics from decimal major units to scale-4 integers), reset the Zero replica before restarting the app. Zero's client schema hash is derived from generated table/column shape, so representation-only changes may not invalidate cached replica rows by themselves.

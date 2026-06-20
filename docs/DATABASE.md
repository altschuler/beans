# Database

Postgres is the durable database. Drizzle defines the database schema in `src/db/schema.ts`, and migrations live in `drizzle/`.

Zero is the required sync layer for app/domain data. Any user-facing application data that should be available to the client must be exposed through Zero rather than fetched directly from server routes or ad-hoc client APIs.

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

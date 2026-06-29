# Zero team-scope permissions cleanup

## 1. Summary

Cleanup item #4 in `CLEANUP.md` identifies repeated team-membership authorization logic across Zero queries, domain read projections, Flue tools, banking helpers, workflow startup, and category management. The cleanup should reduce duplicated `teamMembers` joins and `whereExists('members')` boilerplate without weakening authorization.

The Zero-auth idiom from Zero's Permission Patterns is filter-based authorization in named queries and explicit checks in mutators. Zero does not require a separate RLS-like permission layer. The application should authenticate Zero query/mutate endpoints, build a trusted `ctx`, and have each query/mutator use that context to restrict rows.

Recommended direction: preserve Zero's per-query/per-mutator permission model, extract shared permission helpers for repeated team-visibility patterns as a readability-only first slice, then separately simplify non-Zero/Flue/domain code where a boundary has already produced a trusted `{userId, teamId}` scope. The architectural goal from `CLEANUP.md` #4 is realized in the later trusted-scope phases, not by the initial Zero helper extraction.

## Implementation status — 2026-06-27

Phases 1–5 have been implemented in the current worktree:

- `apps/web/src/zero/permissions.ts` owns shared Zero visibility helpers.
- `apps/web/src/zero/queries.ts` uses those helpers instead of local helper functions.
- `apps/web/src/teams/team-access.server.ts` owns neutral server-side team-access helpers.
- `packages/domain/src/team-scope.ts` defines the shared `TrustedTeamScope` type.
- `packages/domain/src/read-projections.ts` treats `TrustedToolScope` as boundary-validated and filters directly by team-owned tables.
- Flue read/write tools use runtime scope and ignore model-supplied user/team values.
- Trusted Flue write paths pass `trustedScope: true`; Zero/web mutator paths remain membership-checked unless they separately validate scope.
- `docs/AUTH.md`, `docs/DATABASE.md`, and `docs/ARCHITECTURE.md` describe the Zero filter-permission vs trusted server/Flue scope split.
- `ZeroContext` remains `{userID: string}`; no active-team context was introduced.
- Zero authorization behavior remains membership-filter based.

Validated commands:

```bash
pnpm --filter @penge/web test zero-queries.test.ts
pnpm --filter @penge/web test domain-read-projections.test.ts flue-agent-read-tools.test.ts flue-agent-write-tools.test.ts category-management-server.test.ts ledger-categorization-server.test.ts team-access-server.test.ts gocardless-callback.test.ts flue-proxy.test.ts flue-categorization-web-start.test.ts
pnpm --filter @penge/domain typecheck
pnpm --filter @penge/flue typecheck
pnpm --filter @penge/web typecheck
```

## 2. Goals

- Keep Zero queries and mutators explicitly scoped by authenticated context.
- Reduce duplicated Zero query helper code and make query authorization intent easier to read without changing Zero authorization semantics in the first slice.
- Keep support for the current multi-team-shaped data model, even if the UI mostly uses the personal team today.
- Make trusted scope boundaries clear:
  - Zero endpoints authenticate and pass trusted user context.
  - Queries filter rows by that context.
  - Mutators validate target-row ownership/access before writes.
  - Flue/domain tools may rely on trusted `{userId, teamId}` only after the web boundary has validated it.
- Update tests so they verify authorization behavior and representative query shapes without over-specifying every repeated helper expansion.
- Update docs to distinguish Zero filter permissions from server-side trusted-scope adapters.

## 3. Non-goals

- Do not remove query-level Zero permissions.
- Do not trust client-supplied `teamId` arguments by themselves.
- Do not introduce deprecated Zero `definePermissions` usage.
- Do not introduce Postgres RLS in this cleanup.
- Do not change the product's active-team UX or add multi-team switching.
- Do not collapse Flue or change the internal Flue token boundary.
- Do not change database schema or generated Zero schema unless implementation uncovers a small necessary codegen-only change.

## 4. Current state

### Zero context and queries

`apps/web/src/zero/context.ts` currently defines:

```ts
export type ZeroContext = {
  userID: string
}
```

Zero query/mutate endpoints authenticate via Better Auth and pass `{userID: session.user.id}` to query and mutator functions.

`apps/web/src/zero/queries.ts` previously repeated membership scoping in several local helper forms. Phase 1 moved those local helper functions into `apps/web/src/zero/permissions.ts` with names that describe visibility intent:

- `visibleTeam(userID)` scopes through `team.members.userId`.
- `visibleBankConnection(userID)`, `visibleBankAccount(userID)`, `visibleLedgerAccount(userID)`, and `visibleLedgerTransaction(userID)` scope rows through their team.
- `visibleBankTransaction(userID)` scopes through `bankAccount -> team -> members`.
- `visibleLedgerPosting(userID)` scopes through `ledgerTransaction -> team -> members`.
- `visibleAgentWorkflowRun(userID)` scopes workflow runs through their team.
- nested related queries still re-apply equivalent membership filters via the same helpers.

This remains secure and broadly idiomatic Zero. The cleanup reduced local vocabulary duplication, not the underlying authorization joins.

### Server/domain code

Outside Zero, the general team-access boundary now lives in `apps/web/src/teams/team-access.server.ts`:

- `userCanAccessTeam(teamId, userId)` checks `team_members`.
- `requireAccessibleTeamScope({teamId, userId})` returns a trusted scope after validation.
- `requireCurrentPersonalTeamScope({userId})` resolves the user's current team from membership data.

`apps/web/src/banking/repository.server.ts`, `apps/web/src/banking/callback.server.ts`, `apps/web/src/flue/flue-proxy.server.ts`, and the Flue workflow starter use the neutral team-access module where the check is a boundary concern.

Some inline membership joins intentionally remain where a query is both looking up a resource and authorizing it, such as bank-account sync access, row-constrained workflow transaction-team resolution, Zero/web mutator categorization without a trusted team scope, confirmation, and clear-categorizations. Those are still self-authorizing boundary paths rather than trusted downstream paths.

### Flue tools

Flue tools receive trusted scope from the web app (`userId`, `teamId`, optional targets). The model does not choose this scope. Domain read projections now treat `TrustedToolScope` as already validated and filter directly by `teamId`. Trusted Flue write paths pass an explicit trusted-scope marker so category management and categorization commands can avoid redundant membership joins while Zero/web paths remain self-authorizing.

## 5. Design principles

### Zero permissions stay filter-based

Read permissions in Zero should continue to be encoded as query filters. If the user is not authorized for a query, return a query matching no rows rather than relying on hidden UI or later checks.

### Mutators check before writing

Write permissions should remain in mutators/domain commands. For edits/deletes, load the target row under an authorization predicate or load the row and compare its team to the trusted scope. For creates, validate the target team before insert.

### Client context is not authority

The client passes context for local/optimistic execution, but server endpoints must reconstruct or validate trusted context from the authenticated request. If future `activeTeamID` is added to Zero context, the server must derive or validate it independently.

### Boundary vs downstream responsibility

At request/service boundaries, validate authentication and team access. Downstream code may accept a branded/typed trusted scope and filter by `teamId` directly. This distinction is especially useful for Flue tools and domain read projections.

## 6. Proposed architecture

### 6.1 Extract Zero permission helpers

Implemented a small helper module, `apps/web/src/zero/permissions.ts`, owning query scoping helpers. It imports Zero query/schema types and `ZeroContext`.

Implemented helpers:

```ts
export function requireZeroUserID(ctx: ZeroContext | undefined): string

export function visibleTeam(userID: string): <TReturn>(team: Query<'teams', Schema, TReturn>) => Query<'teams', Schema, TReturn>

export function visibleBankConnection(userID: string): <TReturn>(connection: Query<'bankConnections', Schema, TReturn>) => Query<'bankConnections', Schema, TReturn>

export function visibleAgentWorkflowRun(userID: string): <TReturn>(run: Query<'agentWorkflowRuns', Schema, TReturn>) => Query<'agentWorkflowRuns', Schema, TReturn>

export function visibleBankAccount(userID: string): <TReturn>(account: Query<'bankAccounts', Schema, TReturn>) => Query<'bankAccounts', Schema, TReturn>

export function visibleLedgerAccount(userID: string): <TReturn>(account: Query<'ledgerAccounts', Schema, TReturn>) => Query<'ledgerAccounts', Schema, TReturn>

export function visibleLedgerTransaction(userID: string): <TReturn>(transaction: Query<'ledgerTransactions', Schema, TReturn>) => Query<'ledgerTransactions', Schema, TReturn>

export function visibleBankTransaction(userID: string): <TReturn>(transaction: Query<'bankTransactions', Schema, TReturn>) => Query<'bankTransactions', Schema, TReturn>

export function visibleLedgerPosting(userID: string): <TReturn>(posting: Query<'ledgerPostings', Schema, TReturn>) => Query<'ledgerPostings', Schema, TReturn>
```

These helpers replaced the existing local curried helpers in `queries.ts` (`teamForUser`, `bankAccountForUser`, `ledgerAccountForUser`, and related variants), rather than sitting alongside a second vocabulary. They preserve current behavior. For example, `visibleBankTransaction(userID)` still scopes through the bank account's visible team and does not assume a global active team.

`apps/web/src/zero/context.ts` still keeps `ZeroContext = {userID: string}`. Avoid introducing `teamID` until there is a concrete active-team product model.

### 6.2 Refactor Zero queries to use helpers

Rewrite `apps/web/src/zero/queries.ts` to read like permission declarations rather than repeated nested details.

Example target shape:

```ts
bankAccounts: defineQuery(({ctx}) => {
  const userID = requireZeroUserID(ctx)
  return visibleBankAccount(userID)(zql.bankAccounts).orderBy('createdAt', 'desc')
})
```

For queries with explicit `teamId` args, keep both filters:

```ts
activeAgentWorkflowRunsByTeam: defineQuery(activeAgentWorkflowRunsByTeamArgs, ({ctx, args}) => {
  const userID = requireZeroUserID(ctx)
  return zql.agentWorkflowRuns
    .where('teamId', args.teamId)
    .whereExists('team', visibleTeam(userID))
    .where('status', 'active')
    .orderBy('createdAt', 'desc')
})
```

This continues to treat `args.teamId` as a requested team, not authority.

### 6.3 Keep nested related scoping, but centralize it

Nested related queries should still be scoped where relationship traversal could otherwise reveal cross-team rows. Use the same helpers for related subqueries.

Examples:

- dashboard bank transactions:
  - root bank transaction scoped by `visibleBankTransaction(userID)`
  - related posting scoped by `visibleLedgerPosting(userID)`
  - related ledger transaction scoped by `visibleLedgerTransaction(userID)`
  - related accounts scoped by `visibleLedgerAccount(userID)`
- ledger account detail:
  - root account scoped by id plus `visibleLedgerAccount(userID)`
  - related group scoped through visible team
  - postings and their related bank transactions/ledger transactions/accounts use central helpers

Do not remove related scoping simply because the root row is scoped. Keep the conservative current behavior unless a focused Zero query analysis proves the related rows cannot cross team boundaries.

### 6.4 Add server-side team scope helpers for non-Zero paths

The pure trusted-scope type is defined once in the domain package at `packages/domain/src/team-scope.ts`.

```ts
export type TrustedTeamScope = {
  userId: string
  teamId: string
}
```

Server-only helpers for non-Zero request boundaries live under `apps/web/src/teams/team-access.server.ts`. That module imports the domain type when it returns `TrustedTeamScope`, but it owns request/session/database validation.

Implemented API:

```ts
import type {TrustedTeamScope} from '@penge/domain/team-scope'

export async function userCanAccessTeam(teamId: string, userId: string): Promise<boolean>
export async function requireAccessibleTeamScope(input: {userId: string; teamId: string}): Promise<TrustedTeamScope>
export async function requireCurrentPersonalTeamScope(input: {userId: string}): Promise<TrustedTeamScope>
```

Responsibilities:

- move the general `userCanAccessTeam` lookup out of `apps/web/src/banking/repository.server.ts`
- replace the equivalent local Flue proxy membership-check implementation with the neutral helper
- centralize simple server-boundary membership checks against `team_members`
- return not-found/access-denied style errors consistently
- make remaining inline membership joins explicit targets for later trusted-scope refactors, especially where they are doing both lookup and authorization in one query

Do not move request/session resolution into `packages/domain`. Domain owns pure types and pure database/domain behavior; web owns Better Auth/TanStack request boundaries.

### 6.5 Distinguish trusted downstream domain scope

Use the single domain-owned `TrustedTeamScope` type from section 6.4. `packages/domain/src/read-projections.ts` already has `TrustedToolScope`; it can keep that name but should extend or compose the shared type instead of duplicating `{userId, teamId}`.

Once a boundary validates scope, read projections can remove `teamMembers` joins and filter directly by team-owned tables:

- bank transaction search: `bankAccounts.teamId = scope.teamId`
- ledger transaction search: `ledgerTransactions.teamId = scope.teamId`
- ledger account search: `ledgerAccounts.teamId = scope.teamId`
- load postings: `ledgerTransactions.teamId = scope.teamId`

Keep `userId` in scope for:

- audit fields
- user-confirmed metadata
- tool descriptions/instructions
- future role checks if needed

### 6.6 Category management and categorization commands

Domain write commands take `userId` and optional/required `teamId`. Trusted Flue call paths now pass an explicit `trustedScope: true` marker with runtime `{userId, teamId}` after the web boundary has validated scope.

- Web/Zero server mutator paths continue to pass only authenticated `userId` or untrusted client-requested ids and therefore remain membership-checked.
- Flue tools pass trusted `{userId, teamId}` from the validated Flue boundary and commands filter by `teamId` directly for those trusted paths.
- The implementation avoided broad API churn; a future cleanup may replace the temporary marker with more explicit trusted command input types if the API grows.

## 7. Implementation phases

### Phase 1 — Zero helper extraction, no behavior change — implemented

This phase is complete as a readability and vocabulary cleanup only. It does not deliver the architectural thesis of `CLEANUP.md` #4 for Zero because `ZeroContext` remains `{userID}` and queries continue to authorize through membership filters. That is intentional: without a server-validated active team in context, the idiomatic Zero pattern is still per-query filter authorization.

Files changed:

- `apps/web/src/zero/permissions.ts` (new)
- `apps/web/src/zero/queries.ts`
- `apps/web/tests/unit/zero-queries.test.ts`

Implemented details:

1. Moved current helper logic from `queries.ts` into `permissions.ts`.
2. Kept helper implementations behavior-equivalent.
3. Refactored `queries.ts` to call the helpers.
4. Added focused helper coverage for `visibleBankTransaction` and `requireZeroUserID`.
5. Kept representative AST-shape tests for authorization paths.

Acceptance status:

- No intended data-access behavior changes.
- Representative Zero query ASTs remain authorization-equivalent.
- `zero-queries.test.ts` passes.
- `@penge/web` typecheck passes.
- `queries.ts` now reads in terms of visibility helpers rather than local authorization helper internals.
- Reviewers should continue to judge this phase as readability-only, not as removal of join-based Zero authorization.

### Phase 2 — Server boundary team-access helper — implemented

Phase 2 is complete. It did not change Zero query authorization semantics. It centralized simple web/server boundary team-access checks while leaving coupled lookup+authorization queries alone unless they could be simplified without behavior changes.

Files changed:

- `apps/web/src/teams/team-access.server.ts` (new)
- `apps/web/src/banking/repository.server.ts`
- `apps/web/src/flue/flue-proxy.server.ts`
- `apps/web/src/ledger/flue-categorization-workflow.server.ts`
- related tests

Steps:

1. Move `userCanAccessTeam` from `apps/web/src/banking/repository.server.ts` into a neutral server-only teams module.
2. Replace the Flue proxy's local membership-check implementation with the neutral helper.
3. Update banking callback/server-function imports so general team access no longer depends on the banking repository module.
4. Add or export the domain-owned `TrustedTeamScope` type only if the Phase 2 helper returns it; otherwise defer that type until Phase 3 to avoid unused API churn.
5. Inventory inline web-side membership joins such as `requireAccessibleBankAccount`, `listAccessibleBankAccountsForSync`, and workflow transaction-team resolution. Collapse only simple boundary checks in this phase; leave coupled lookup+authorization queries in place unless they can be simplified without behavior changes.
6. Keep outward behavior and error messages stable where tests depend on them.
7. Do not yet change domain package APIs broadly beyond a small shared scope type if it is immediately used.

Acceptance:

- General `userCanAccessTeam` lives in a neutral teams module, not in banking.
- Flue proxy and banking callback still deny cross-team access.
- Workflow startup still resolves only accessible teams/transactions.
- Remaining inline `teamMembers` joins in web code are intentional lookup+authorization queries or are documented as targets for later trusted-scope phases.

### Phase 3 — Trusted Flue/domain read projections — implemented

Files changed:

- `packages/domain/src/read-projections.ts`
- `apps/flue/src/agent-tools/read-tools.ts`
- `apps/web/tests/unit/domain-read-projections.test.ts`
- `apps/web/tests/unit/flue-agent-read-tools.test.ts`

Steps:

1. Treat `TrustedToolScope` as already boundary-validated.
2. Audit all production callers of `searchBankTransactions`, `getBankTransactionDetail`, `searchLedgerTransactions`, and `searchLedgerAccounts`; every caller must pass through a boundary that validates `{userId, teamId}` before calling the projection.
3. Remove `teamMembers` joins from read-projection queries.
4. Keep direct `teamId` filters on the relevant team-owned table.
5. Ensure cross-team rows remain excluded by tests.

Dropping these joins should be row-count safe: `team_members(team_id, user_id)` is unique, so at most one membership row matches for an authorized user/team. The semantic change is where authorization responsibility lives, not result multiplicity.

Acceptance:

- Caller audit proves all production read-projection callers pass trusted, validated scope.
- Read projection tests still prove team isolation.
- Flue read tools ignore any model-supplied user/team fields and use runtime scope.
- Queries are simpler and avoid redundant membership joins.

### Phase 4 — Trusted Flue/domain write commands — implemented

Files changed:

- `packages/domain/src/category-management.ts`
- `packages/domain/src/categorization-service.ts`
- `apps/flue/src/agent-tools/write-tools.ts`
- `apps/web/tests/unit/flue-agent-write-tools.test.ts`
- existing Zero/web mutator call paths were intentionally left membership-checked

Steps:

1. Identify commands called from Flue with trusted team scope.
2. Add explicit trusted-scope input forms if needed.
3. Replace membership joins with direct team filters only for trusted-scope call paths.
4. Keep Zero/web mutator paths authorized if they still only have `userId`.

Acceptance:

- Cross-team write tests still fail safely.
- Flue write tools cannot write outside runtime `teamId` or target transaction constraints.
- Server mutators still authorize writes from authenticated sessions.

### Phase 5 — Docs cleanup — implemented

Files changed:

- `docs/AUTH.md`
- `docs/DATABASE.md`
- maybe `docs/ARCHITECTURE.md`

Docs should say:

- Zero query/mutator endpoints authenticate and pass trusted context.
- Zero read permissions are expressed as query filters.
- Mutators enforce write permissions with context and target-row checks.
- Server/Flue boundaries may validate team scope once and pass trusted scope downstream.
- Client-supplied team ids are requests, not authority.

## 8. Testing strategy

### Unit tests

Update `apps/web/tests/unit/zero-queries.test.ts` to test representative permission behavior rather than every repeated implementation detail.

Recommended assertions:

- `activeAgentWorkflowRunsByTeam` includes both requested `teamId` and a membership path.
- dashboard bank transactions are scoped through bank account team membership.
- ledger account detail is scoped by account id plus team membership and scopes important related rows.
- ledger postings with relations scope root postings and related account/transaction/bank transaction rows.

For server/domain tests:

- cross-team reads return no rows in read projections.
- cross-team category management writes are rejected.
- cross-team categorization writes are rejected.
- Flue tools ignore user/team fields in tool input and use runtime scope.

### Focused commands

Run after Phase 1:

```bash
pnpm --filter @penge/web test zero-queries.test.ts
pnpm --filter @penge/web typecheck
```

Run after domain/Flue phases:

```bash
rg "searchBankTransactions|getBankTransactionDetail|searchLedgerTransactions|searchLedgerAccounts" apps packages -g '*.ts' -g '*.tsx'
pnpm --filter @penge/web test domain-read-projections.test.ts flue-agent-read-tools.test.ts flue-agent-write-tools.test.ts category-management-server.test.ts ledger-categorization-server.test.ts
pnpm --filter @penge/web typecheck
pnpm --filter @penge/flue typecheck
```

Optional broader validation:

```bash
pnpm --filter @penge/web test
pnpm check
```

## 9. Risks

### Accidentally trusting client team ids

Mitigation: any `teamId` query/mutator argument must be combined with context-based membership filtering or server validation.

### Removing related-row scoping too aggressively

Mitigation: Phase 1 should preserve current behavior. Only remove redundant nested scopes after focused analysis and tests.

### Confusing Zero context with server authority

Mitigation: server endpoints reconstruct trusted context from the request; client context remains for local/optimistic execution only.

### Multi-team future path

Mitigation: do not hard-code personal-team-only assumptions into Zero permissions. If active team is needed later, add explicit active-team validation at the endpoint boundary.

### Single validated boundary for read projections

After Phase 3, domain read projections are no longer self-authorizing by joining `teamMembers`; they trust the caller's scope and filter directly by `teamId`. Any future caller that does not pass through the Flue proxy or another explicit team-access boundary must validate the scope before calling these projections.

Mitigation: Phase 3 includes a caller audit gate, tests keep cross-team rows excluded, and docs must state that read projections require trusted scope.

### Domain API churn

Mitigation: separate Zero helper extraction from domain trusted-scope refactors. Keep each phase reviewable.

## 10. Open questions

- Should the app introduce a first-class `activeTeamID` in Zero context now, or wait until multi-team switching exists? Recommendation: wait.

## 11. Follow-up considerations

- Consider replacing the temporary `trustedScope: true` marker in trusted Flue write paths with more explicit trusted-scope command input types if future write APIs expand.
- Keep remaining inline `teamMembers` joins where they are self-authorizing untrusted boundary paths, and only collapse them after adding an explicit trusted-scope boundary.

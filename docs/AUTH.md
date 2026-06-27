# Authentication and Authorization

Penge uses [Better Auth](https://www.better-auth.com/) for identity, credentials, and session management. App/domain access is authorized separately with application data, primarily team membership.

## Broad authentication flow

- `apps/web/src/auth/server.ts` creates the server-side Better Auth instance with:
  - the Drizzle adapter backed by Postgres,
  - email/password auth enabled,
  - `tanstackStartCookies()` so TanStack Start request/response cookies work correctly,
  - `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` from the environment.
- Better Auth trusts the configured `BETTER_AUTH_URL` origin automatically. For local worktrees or fallback dev ports, add comma-separated patterns to `BETTER_AUTH_TRUSTED_ORIGINS`, for example `https://localhost:*`.
- `apps/web/src/routes/api/auth/$.ts` forwards Better Auth API requests to `auth.handler(request)`. Client calls such as sign-in, sign-up, sign-out, and session cookie management go through this route.
- `apps/web/src/auth/client.ts` creates the browser `authClient` without an explicit base URL so Better Auth uses the current origin. This avoids absolute localhost HTTPS fetches during TanStack Start SPA shell generation.
- `apps/web/src/components/auth/auth-form.tsx` signs users up or in with `authClient.signUp.email(...)` and `authClient.signIn.email(...)`.
- Better Auth persists auth records in the Drizzle tables `user`, `session`, `account`, and `verification` from `apps/web/src/db/schema.ts`.
- Better Auth reads the session token from request cookies and returns the current `{ user, session }` via `auth.api.getSession({ headers })`.

## Session helpers

Use the existing helpers instead of calling Better Auth directly throughout the app:

- `getSession()` in `apps/web/src/auth/session.ts` is a TanStack `createServerFn` for optional session reads from route loaders/server functions.
- `ensureSession()` in `apps/web/src/auth/session.ts` is a TanStack `createServerFn` for authenticated server functions. It throws when no valid session exists.
- `getSessionFromRequest(request)` in `apps/web/src/auth/session.server.ts` is for route/API handlers that already have a `Request` object and need to return an HTTP response such as `401 Unauthorized`.

Modules that import the Better Auth server instance, the Drizzle adapter, Postgres, secrets, or other server-only dependencies must stay server-only. Add `import '@tanstack/react-start/server-only'` to those modules and avoid importing them from client components.

## Protected routes

Authenticated pages live under the `/_protected` route tree.

Penge runs TanStack Start in SPA mode for Zero. Protected app routes must not depend on route-level server `beforeLoad` for ordinary page rendering. `apps/web/src/routes/_protected.tsx` renders `ProtectedAppGate`, which uses the Better Auth client session hook in the browser. When there is no client session it redirects to `/login` with the current route as `redirect`. When a session exists, it calls `ensureCurrentUserPersonalTeam()` as a client-triggered server function, then mounts `AppZeroProvider` and the app shell.

Use this pattern for app pages that require a signed-in user. Public pages, such as `/` and `/login`, should not call `ensureSession()` just to render. Server functions, API routes, Zero query endpoints, and Zero mutator endpoints still authenticate and authorize server-side.

## Authorization model

Authentication answers “who is this user?” Authorization answers “can this user access or change this resource?” Do not treat a valid session as sufficient authorization for domain data.

The current domain authorization model is team-based:

- Each signed-in user gets a personal team via `ensureCurrentUserPersonalTeamServer()`.
- Team membership lives in `team_members`.
- Current memberships use role `owner`; the schema has a `role` column for future role-based permissions.
- Banking resources belong to a team through `teamId` or through a parent record that belongs to a team.
- A user may access team-owned data only when there is a matching `team_members` row for that user and team.
- Once a server boundary has checked membership, downstream Flue/domain read and write code may receive a trusted `{userId, teamId}` scope and filter directly by `teamId`. Do not construct that trusted scope from client/model input without a server-side membership check.

## Authorization patterns

### Server functions

For authenticated server functions:

1. Call `ensureSession()` first.
2. Derive `userId` from `session.user.id`.
3. Validate input with Zod or equivalent.
4. Authorize against server-side data before reading or writing domain rows.
5. Never trust `userId`, `email`, `role`, or ownership claims supplied by the client.

Examples:

- `apps/web/src/banking/banking-fns.ts` calls `ensureSession()` before listing institutions, listing banking data, starting bank links, or syncing accounts.
- `syncBankAccount` authorizes with `requireAccessibleBankAccount(bankAccountId, session.user.id)` before using the provider account.

### Repository/database access

Prefer boundary helpers that encode authorization checks near the request boundary:

- `apps/web/src/teams/team-access.server.ts` owns general team-access helpers.
- `userCanAccessTeam(teamId, userId)` checks for a matching `team_members` row.
- `requireAccessibleTeamScope({teamId, userId})` returns a trusted scope only after membership is verified.
- `requireCurrentPersonalTeamScope({userId})` resolves the user's current team scope from server-side membership data.
- `listBankAccountsForTeam(teamId, userId)` and `listTransactionsForTeam(teamId, userId)` check team access before returning rows.
- `requireAccessibleBankAccount(bankAccountId, userId)` joins through `team_members` so users can only operate on bank accounts in teams they belong to.

When adding a new team-owned table, include a clear path back to `teams` and enforce access by joining/checking `team_members` at an untrusted boundary or by requiring a trusted team scope from an upstream boundary. Prefer returning “not found” style errors for inaccessible resources so callers do not leak whether another user’s resource exists.

### Route/API handlers

For route handlers with a raw `Request`, use `getSessionFromRequest(request)` and return `401 Unauthorized` if it is missing.

Examples:

- `apps/web/src/routes/api/zero/query.ts`
- `apps/web/src/routes/api/zero/mutate.ts`
- `apps/web/src/routes/api/gocardless/callback.ts`

After authentication, build server-side context from the session, for example `const ctx: ZeroContext = { userID: session.user.id }`.

### Zero queries and mutators

Zero is used for app/domain data, not auth data.

- Do not expose Better Auth tables (`user`, `session`, `account`, `verification`) through Zero.
- Keep those tables disabled in `apps/web/drizzle-zero.config.ts`.
- Zero query and mutate endpoints must authenticate the request and pass the authenticated `userID` into `ZeroContext`.
- Every Zero query must filter data by `ctx.userID`, usually through team membership.

Current examples in `apps/web/src/zero/queries.ts` scope teams, team members, bank connections, bank accounts, and bank transactions to the authenticated user. Shared helpers in `apps/web/src/zero/permissions.ts` centralize the repeated visibility predicates, but the authorization model remains filter-based per query.

Zero mutators follow the same rule: authenticate at the endpoint, derive `userID` from the session, and authorize each write against team membership or a stricter permission check. Client-supplied team ids in Zero arguments are requests, not authority.

### Flue sidecar calls

The Flue sidecar in `apps/flue` is an internal service. The first workflow version uses a shared `PENGE_FLUE_INTERNAL_TOKEN` for web-to-Flue calls; this is temporary and tracked in `docs/TODO.md`.

For current Flue workflows:

1. `apps/web` authenticates the browser user normally.
2. `apps/web` derives the trusted `userId` and authorized `teamId` server-side.
3. `apps/web` reserves an app-visible `agent_workflow_runs` row and sends its id as `appRunId`.
4. `apps/web` calls Flue at `PENGE_FLUE_BASE_URL` with `Authorization: Bearer $PENGE_FLUE_INTERNAL_TOKEN`.
5. Workflow input includes `appRunId`, `userId`, `teamId`, and optional workflow target constraints such as `targetBankTransactionIds`.
6. Flue tools scope every domain read/write by the trusted values and never allow model-selected user/team scope.

Domain read projections and trusted Flue write paths treat their runtime `{userId, teamId}` as already boundary-validated. They filter by `teamId` directly and keep `userId` for audit metadata, confirmation fields, tool instructions, and future role checks. Any new production caller of those trusted-scope APIs must validate team access before calling them.

Long term, Flue should operate through a least-privilege authorization boundary, such as authenticated app/domain APIs or capability-scoped services, so broad database access is not available to the agent runtime.

### Role-based authorization

The database already stores `team_members.role`. Today the app only creates `owner` memberships. If more roles are added:

- Define the allowed role values and permission matrix in code, not ad hoc string comparisons scattered across features.
- Check both membership and role for privileged operations.
- Keep read/write permissions explicit per feature.
- Add tests for each role boundary.

## Security guidelines

- Keep `BETTER_AUTH_SECRET` private and strong in non-development environments.
- Keep `BETTER_AUTH_URL` and `VITE_PUBLIC_APP_URL` aligned with the deployed origin.
- Keep `BETTER_AUTH_TRUSTED_ORIGINS` narrow in shared and production environments; wildcard localhost patterns are for local development only.
- Keep auth/session/account/verification data server-only and excluded from Zero.
- Do not import `apps/web/src/auth/server.ts` into client components or shared client-rendered modules.
- Do not rely on hidden UI, route context, request body fields, or client-side Zero filters for authorization.
- Authorize again in every server function, route handler, Zero query, and Zero mutator that touches protected data.
- Prefer small helper functions with names like `requireAccessible...` for reusable authorization checks.
- Add tests for unauthenticated access, authenticated access to owned data, and authenticated denial for another user’s/team’s data.

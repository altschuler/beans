# Architecture Notes

For product/system-design explanations, use `docs/reference/` alongside this architecture map. The reference docs describe current behavior and intentionally synthesize implemented specs rather than preserving all historical spec details.

## Client/server import boundaries

TanStack Start builds client and server environments from overlapping route modules, so server-only dependencies must be explicit.

Use TanStack import-protection markers at the top of boundary-only modules:

```ts
import '@tanstack/react-start/server-only'
```

Use this for modules that touch secrets, Postgres, Drizzle server adapters, Better Auth server instances, or `@rocicorp/zero/server`. These modules must not be imported directly by client components or shared route code.

```ts
import '@tanstack/react-start/client-only'
```

Use this only for modules that cannot run during SSR.

Shared modules, route components, and `createServerFn` wrappers should stay marker-free unless they are truly one-environment-only. If shared code needs server work, call a server function or dynamically import a marked server module from inside server-only execution.

## Zero-backed app data reads and writes

Zero is the required read and write path for app/domain data that is exposed through the Zero schema.

If an app/domain table is included in `drizzle-zero.config.ts`, then user-facing reads and writes for that table must go through Zero queries and Zero mutators. Do not add TanStack server functions, ad-hoc route handlers, or direct client-callable APIs for ordinary CRUD or domain updates on Zero-backed tables.

Server functions are reserved for special cases where Zero is not the right boundary, including:

- authentication/session helpers
- external-provider orchestration such as starting a bank link or manually triggering a provider sync
- tables intentionally excluded from Zero, such as Better Auth tables
- operational endpoints that do not expose or mutate app/domain rows directly

Zero mutators must still authorize server-side using the authenticated Zero context. Client-side filters and hidden UI are not authorization.

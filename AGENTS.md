<!-- 
Very short description of the project
-->

## Source of truth

Read the relevant doc before doing any work in that area. These are authoritative — don't guess when the answer is documented.

Read entire relevant source files before reasoning or editing. Do not rely on excerpts/ranges unless the file is generated, vendored, or extremely large.

<!--
List all docs files with a short explanation of what it documents and when to read it
-->

- Architecture map: `docs/ARCHITECTURE.md`
- Frontend (SSR, data loading patterns): `docs/FRONTEND.md`
- Design system (tokens, UI rules, component guidance): `docs/DESIGN.md` — read before changing UI
- Internationalization / Paraglide messages: `docs/I18N.md`
- Databases (public graph, overview DB, migrations, codegen): `docs/DATABASES.md`
- Environment variables (t3-env, config rules): `docs/ENVIRONMENT.md`
- Server (activity system, server-side services): `docs/SERVER.md`
- Authentication (Entra, sessions, local dev impersonation): `docs/AUTH.md`
- Testing (shared mocks, builders, harnesses, philosophy): `docs/TESTING.md`
- Code style defaults and extraction guidance: `docs/CODESTYLE.md`
- Code review guidelines (authorization, i18n, repo fit): `docs/REVIEW.md`
- Planning guidelines (read before brainstorming, planning or implementing features): `docs/PLANS.md`
- Reference docs: `docs/reference/`
- Design specs: `docs/specs/`
- Active execution plans (not committed): `docs/plans/active/`
- Tech debt / backlog: `docs/TODO.md`

## Verifying your work

<!--
How can agents verify their own work? How to run tests (unit/integration/e2e), do builds, automated usage of the application, etc
-->

## INBOX

Use `docs/INBOX.md` proactively during implementation — not just at the end. Write an entry whenever you encounter something that would help future agents, such as:

- A manual process that could be automated
- Missing docs or knowledge gaps
- Friction you hit that others will hit too


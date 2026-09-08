# Flue v2 runtime — stage 2

A minimal, CLI-only [Flue](https://flueframework.com) agent in `apps/flue`.
Scaffolded with `pnpm dlx @flue/cli@2.0.3 init apps/flue --target node`.
No sidebar, HTTP server, finance tools, or app/database integration yet.

## Run from the repository root

```sh
pnpm install --frozen-lockfile
pnpm --filter @penge/flue mock --message "Hi" --id example --json
pnpm --filter @penge/flue mock --message "Hi again" --id example --json
pnpm --filter @penge/flue check:types
pnpm --filter @penge/flue test
```

The `mock` script sets `FLUE_MOCK=1` and runs
`flue run src/agents/assistant.ts`. Without explicit mock mode, the agent
refuses to load. **Do not add provider keys.** There is no real-provider path.
Node >=22.19.0 is required; orb setup pins Node 24.20.0 and pnpm 10.34.5.

`Assistant` uses `useModel('mock/local')` and `useSandbox(local())`.
The generated `src/db.ts` uses `sqlite('./data/flue.db')`; `--id` resumes the
same durable conversation. SQLite and scratch test data are ignored by Git.

## Mock boundaries and safety

The only mocked boundary is the model: Pi's public `fauxProvider` is registered
with Flue's `setProvider`. It scripts two model responses per CLI invocation:
a built-in `bash` call running a fixed `printf`, then text derived from the real
tool result and the persisted user-message count. It does not understand the
prompt, choose tools intelligently, or validate model quality. Its finite response
queue is for one submission per process, not a long-running HTTP server.

The integration test invokes the real CLI in fresh processes with an isolated
SQLite database, no inherited credentials, and `--env /dev/null`. It verifies
sandbox output, continued history/identity, and rejection without mock mode.
No network model requests or provider tokens are used.

`local()` runs real host commands, **not an isolation boundary**. Its working
directory defaults to `apps/flue`; Flue only forwards shell-essential environment
variables. Files elsewhere on the host are still accessible. Do not expose this
agent to untrusted users or tenants. No secrets are opted into the sandbox.

Dependencies are `@flue/runtime` **2.0.3**, `@earendil-works/pi-ai` **0.83.0**,
`@flue/cli` **2.0.3**, TypeScript **6.0.3**, and `@types/node` **22.20.1**
(lockfile). The CLI initially scaffolded TypeScript 7; this repo keeps 6.0.3 to
match its ESLint peer range. No separate sandbox package is required.

## Orbs and stage 3

`.agents/setup` installs the locked workspace and runs the credential-free Flue
typecheck and integration test; `.agents/resume` checks the CLI exists. No Flue
env file or supervised service is needed. Existing PostgreSQL/web setup remains.
There is no Flue build artifact for `flue run`; `pnpm build` still builds the web app.

Prefer installed-version documentation:
`pnpm --filter @penge/flue exec flue docs read guide/react` (also `guide/routing`,
`guide/node-target`, and `reference/provider-api`).

For stage 3, use the Node `--deploy` scaffold to add Hono `src/app.ts` and the
`@flue/vite` plugin. Scaffold in a temporary empty directory and fold those pieces
in: **do not run `init --force` over this customized project**. Mount
`createAgentRouter(Assistant)` at a chosen agent path. `vite dev` serves it;
`vite build` emits `dist/server.mjs`. Keep one live Node owner per conversation.

Flue recommends `@flue/react`'s `useFlueAgent({url})` with `@flue/sdk`, not AI SDK
chat adapters: render `messages[].parts`, call `sendMessage`, and use `status`
and `historyReady`. Sending resolves on admission, not completion; the hook
reconstructs durable history and follows SSE with long-poll fallback. Put session
authentication and per-conversation ownership checks in front of **all** routes,
including history, streams, attachments, and abort. Prefer a same-origin web
proxy. Agent transport is separate from Zero-backed financial data. Resolve the
known Zero browser 401 before claiming stage-3 app interaction works.

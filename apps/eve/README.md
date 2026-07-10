# Penge eve runtime

`apps/eve` is Penge's internal eve.dev runtime. Browser and orchestration requests must enter through Penge-owned authenticated boundaries; an eve session id, continuation token, stream index, sandbox id, or model message is never authorization.

## Capability surfaces

One eve agent serves two authenticated purposes selected from `ctx.session.auth.current.attributes` at `session.started`:

- `chat-session`: shared finance reads, confirmed chat categorization/category-management writes, and the constrained workspace file tools (`read_file`, `write_file`, `glob`, `grep`).
- `categorization-task`: shared finance reads plus `applyCategorizationSuggestion`. Task sessions receive no chat write, approval, question, delegation, shell, file, or network tools.

The dynamic tools and instructions resolvers fail closed if the trusted scope is missing or malformed. Authority fields never appear in model-callable input schemas. All finance writes go through `@penge/domain` services and require current categorization revisions. Successful writes record their structured result in the server-only `agent_tool_executions` table within the same transaction, so eve durable-step replay returns the original outcome instead of repeating a side effect.

## Sandbox policy

The sandbox root is `/workspace`; interactive chat bulk categorization reserves `/workspace/bulk-categorization`. Files there are sensitive working memory, not authority or app-owned history, and must not be exposed through Zero or rendered raw.

`agent/sandbox.ts` uses eve's availability-aware backend in this order: Vercel Sandbox, Docker, microsandbox, then just-bash. Vercel, Docker, and microsandbox start with `deny-all` egress. Just-bash has no real network and rejects network-policy configuration, so it is left without a policy option. Domain allowlists are intentionally not used: Docker only supports allow-all/deny-all, and this runtime needs no sandbox egress.

All eve default tools are disabled statically. The dynamic chat capability reintroduces only the four file tools listed above. `bash`, `web_fetch`, `web_search`, `todo`, `ask_question`, and `agent` remain disabled. Authored `defineTool` code still runs in the app process with full environment and network access; sandbox policy does not constrain authored tools.

## Persistence and reset

Workspace state is per durable eve session. Docker keeps the session container filesystem, Vercel and microsandbox retain resumable session state through their backends, and just-bash stores local state under `.eve/sandbox-cache/`. Server shutdown stops sandbox compute but does not itself delete durable session state.

For a local migration-only reset, stop eve and remove only eve-owned local runtime/sandbox state (for example `apps/eve/.eve/sandbox-cache/` and the configured local workflow state). Never reset Penge domain, Better Auth, banking, or ledger tables as part of an eve runtime reset.

This first pass is local-development only. Production use with finance data is blocked until the chosen backend has an enforced retention duration and an app-owned deletion procedure that removes the eve session and its sandbox when the corresponding chat/run expires or is deleted. Do not assume deployment, app-row deletion, or server shutdown erases backend session data.

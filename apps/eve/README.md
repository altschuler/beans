# Penge Eve runtime

`apps/eve` is Penge's internal Eve assistant runtime. Browser requests enter through Penge-owned authenticated boundaries; runtime handles and model messages are never authorization.

## Chat capability

The runtime accepts only the `chat-session` capability. It provides scoped finance reads, approval-gated chat categorization/category-management writes, and constrained workspace tools (`read_file`, `write_file`, `glob`, `grep`). Dynamic tools and instructions fail closed when trusted `{userId, teamId, chatId}` scope is missing or malformed. Authority fields never appear in model-callable schemas.

All writes use `@penge/domain` services. Successful outcomes are recorded in `agent_tool_executions` in the same transaction so durable step replay does not repeat side effects.

## Sandbox policy

The sandbox root is `/workspace`; interactive bulk work uses `/workspace/bulk-categorization`. Files are sensitive working memory, not authority or app-owned history. Vercel, Docker, and microsandbox use deny-all egress; just-bash has no real network. Authored tools run in the app process and are not constrained by sandbox policy.

## Persistence

Eve's default local workflow world and per-session sandbox state provide development durability. Production use is blocked until a durable world, retention period, and app-owned session/sandbox deletion procedure are selected and documented.

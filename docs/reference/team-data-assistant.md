# Team data assistant

## Purpose

Ask Penge is an experimental Eve-backed assistant for the signed-in user's current team finance data. It can read compact finance projections and apply only approval-gated categorization and category-management operations. The model never chooses authorization scope, and app/domain data remains authoritative.

## Web shell and chat identity

The authenticated shell owns one Ask Penge surface under `apps/web/src/components/assistant/`. Desktop uses a sibling sidebar and narrow viewports use a chat-focused panel. `team_data_assistant_chats` stores user/team-owned thread metadata plus two server-only runtime handles: `eveSessionId` and `eveContinuationToken`. One product chat maps permanently to one Eve session.

Chat history and approval state are not stored in app Postgres or synced through Zero. Eve's durable event stream is the transcript. Opening a mapped chat replays its sanitized stream from index zero, then initializes `useEveAgent` with the replayed events and session cursor. The chats list and thread metadata continue to use Zero.

Each send derives a small known `clientContext.currentPage` hint from the current route. This is an ephemeral navigation hint, never identity, scope, or authority.

## Authorized Eve proxy

The browser uses a same-origin host under `/api/eve/chat/:chatId`. The catch-all accepts only Eve's start, follow-up, and stream routes. On every request it:

1. authenticates the Better Auth cookie;
2. verifies chat ownership and current team membership;
3. enforces exact route, method, query, origin, body-size, and body-shape rules;
4. mints a short-lived `chat-session` capability scoped to the exact user, team, and chat;
5. forwards only to the configured Eve origin with redirects disabled.

Start receipts attach the Eve session id and continuation token to the chat row. Follow-ups always use the server-held continuation token. Continuation tokens, service credentials, raw Eve events, and authority headers never reach the browser. Eve's default channel independently verifies the capability, and tools derive trusted `{userId, teamId, chatId}` only from session auth.

## Reads, writes, and approval

Ask Penge can inspect scoped bank transactions, transaction details and categorization revisions, ledger history, and ledger accounts. Results are compact team-scoped projections rather than arbitrary rows or provider payloads.

`applyCategorizations` and `manageCategory` use Eve's durable per-call `always()` approval. The stream sanitizer resolves each pending write into a bounded display-safe proposal under trusted team scope and embeds it in the sanitized `input.requested` event. If resolution fails, the replayed card is marked unavailable and both controls are disabled. Approval state is derived from later Eve events, including replay after reload.

The proxy accepts only one explicit structured approve/deny response tied to a request id; textual aliases, numeric choices, mixed text/responses, and multi-request responses are rejected. Eve binds the response to the exact pending call. The server-only `agent_tool_executions` ledger makes durable write replay idempotent. Domain revision, team, category eligibility, balance, transfer, and expected-name guards remain authoritative.

## Sanitized stream

Every browser-bound live or replay stream passes through one stateless NDJSON sanitizer. It emits exactly one reducer-safe output line per Eve input event, redacts tool input/output and runtime/provider details, maps failures to the fixed app-owned error catalog, and converts unknown events to no-op envelopes. No event or approval projection is written to app Postgres.

## Stop and recovery

`useEveAgent` owns live sending, optimistic user messages, stream reconnection, reduction, and stop behavior. Stop aborts only the local request; Eve continues durably. The client immediately reattaches by replaying the session, so a completed answer can appear after stop or reload. The composer remains unavailable during replay.

If Eve reports a completed or failed session, the replayable history remains visible read-only and the user starts a new product chat. Concurrent tabs are best-effort and rely on Eve's one-active-continuation behavior; domain guards and per-call approval still protect writes.

## Sandbox and deployment

Interactive bulk categorization may use sensitive per-session working memory under `/workspace/bulk-categorization`. Only `read_file`, `write_file`, `glob`, and `grep` are enabled. Workspace files are not authority or app-owned history.

Local durability currently uses Eve's default workflow world. Selecting a production world and defining retention plus app-owned session/sandbox deletion remain production blockers in `docs/TODO.md`.

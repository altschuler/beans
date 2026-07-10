# Team data assistant

## Purpose

Ask Penge is an experimental Eve-backed chat assistant for questions about the signed-in user's current team finance data. It is personal to that user and team. It can read compact finance projections and can apply only the guarded categorization and category-management operations exposed by the Eve agent.

Ask Penge is not an unrestricted database console. The model never chooses authorization scope, and app-owned data remains authoritative.

## Web shell and conversation scope

The authenticated shell owns one root Ask Penge surface under `apps/web/src/components/assistant/`. `PageLayout` adds the trigger to page actions; desktop uses a sibling sidebar and narrow viewports use a chat-focused panel.

`team_data_assistant_chats` stores the user/team-owned thread metadata. The panel resumes the latest recently submitted chat, supports history switching and clear/new-thread behavior, and excludes empty placeholder threads from history. Each send derives a small known `clientContext.currentPage` hint from the current route. The hint is ephemeral Eve client context, is never authority, and is not persisted as message text or chat state.

Chat UI files use product naming (`assistant`), not runtime naming. There is no app-wide Flue provider; the remaining workflow-only Flue provider is mounted only by the automated-categorization trace.

## Authorized Eve proxy

The browser configures Eve React with a same-origin host under `/api/eve/chat/:chatId`. The catch-all accepts only Eve's start, follow-up, and stream session routes. The browser never receives `PENGE_EVE_BASE_URL`, the service-capability secret, or a service bearer, and it cannot send a direct Eve host or authority headers.

For every request the web proxy:

1. authenticates the Better Auth cookie;
2. resolves the app-owned chat and verifies user ownership plus current team membership;
3. requires an exact trusted `Origin` for POST requests;
4. validates a bounded, strict body and exact route/method/query shape;
5. serializes starts and follow-ups through server-owned compare-and-set chat state;
6. substitutes stored session/continuation state rather than trusting browser handles;
7. mints a fresh short-lived `chat-session` capability scoped to the exact user, team, and chat;
8. forwards only to the configured Eve origin with redirects disabled.

The Eve default channel independently verifies the capability and stamps trusted session auth. Tools derive `{userId, teamId, chatId}` from that auth; model input, request bodies, session ids, continuation tokens, call ids, and approval ids are never authority.

## Reads and per-turn context

Ask Penge can use scoped Eve tools to inspect:

- bank transactions and current categorization state;
- transaction detail and current `categorizationRevision`;
- ledger transactions and prior categorization examples;
- ledger accounts, editable categories, and bank-linked transfer accounts.

Results are team-scoped compact projections, not arbitrary database rows or provider payloads. A server-owned sitemap is part of chat instructions. The per-turn page key only helps answer page-relative or navigation questions.

## Writes and durable approval

Chat write tools are `applyCategorizations` and `manageCategory`. Both use Eve's durable `always()` approval, bound to one exact pending tool call and its input. A normal initial request to change data is not permission to write.

Penge sanitizes Eve's pending approval event and resolves all referenced records under trusted team scope into a bounded display-safe proposal. Proposal cards expose names, dates, amounts, descriptions, operation type, and counts—not internal ids or raw tool input. Approve is enabled only when this exact proposal projection is ready. Deny remains available when projection is blocked.

Before forwarding a response, the proxy requires the approval to be pending for the current chat, Eve session, and session ordinal. Structured controls send an exact request response. Text approval is intentionally limited to literal `approve` or `deny` when exactly one request is pending; aliases, numeric choices, multi-request resolution, stale/replayed responses, and cross-session responses are rejected. Eve executes an approved call at most once, and the server-only `agent_tool_executions` ledger makes durable write replay idempotent.

Categorization writes still require the current `categorizationRevision`, use shared domain rules, and preserve imported bank evidence. Category update and delete approvals also carry the trusted current target name shown on the card; execution locks and re-reads that target and returns a safe conflict without mutation if the name changed after approval. Category management continues to reject system, bank-linked, cross-team, or ledger-history-unsafe operations.

## Sanitized durable history

Penge owns the user-facing transcript projection in `team_data_assistant_chat_events` and the safe approval projection in `team_data_assistant_chat_approvals`. Raw Eve events may contain tool input/output, reasoning, runtime ids, model/provider metadata, sandbox paths, or raw errors, so they are never persisted or forwarded.

The web stream pipeline produces exactly one allowlisted event for each positional Eve event, persists it transactionally, advances the server cursor only across contiguous committed indexes, and only then emits it to the browser. Zero exposes the sanitized event/approval fields through chat ownership and current membership. Eve session ids, continuation tokens, admission ids, ingestion metadata, and runtime coordination state remain server-only.

Fixed product errors replace raw provider/runtime failures. Unsupported or future non-boundary events become reducer-safe no-op envelopes rather than leaking raw data or changing positional stream indexes.

## Stop, reload, and recovery

A chat row records server-only session ordinal, state (`none`, `admitting`, `running`, `waiting`, `completed`, or `failed`), turn start, admission id, Eve handles, and the next committed stream index. A waiting follow-up CAS also captures the pre-turn cursor and reserves a rollback-ineligible `pending` dispatch marker before network delivery; a validated receipt is durably retried to `acknowledged` independently of browser abort. Explicit ambiguous network outcomes move the exact marker to `ambiguous` after the request ends. Approval claims are tagged with that exact admission. One concurrent start/follow-up wins; another tab receives `409` and reloads authoritative state.

`useEveAgent.stop()` aborts only the local request/stream. It is not a server-side cancellation guarantee. After stop, reload during a turn, or an interrupted stream, the composer remains blocked while the client explicitly attaches to the stored Eve session from the committed cursor. Web reconciliation consumes the same durable Eve stream and uses the same sanitizer/persistence path until a waiting or terminal boundary is committed. A committed terminal boundary is authoritative and is not fetched again from Eve; unresolved catch-up returns a non-sendable reconnecting bootstrap state. An answer completed after the local stop can therefore appear during recovery.

A terminal completed or failed boundary atomically expires unresolved approval projections for that exact session. Expired cards remain visible only for the current session ordinal as inert historical context and never offer approval controls.

An unresolved admission initially remains leased because Eve may already be executing. For a stale running follow-up, reconciliation consumes Eve's durable stream from the captured pre-turn cursor for the full bounded deadline. Any cursor advancement proves admission and prevents rollback, even before a boundary. A validated POST receipt is acknowledged and is never rolled back just because the provider is slow. A pending dispatch remains locked until a centralized takeover cutoff strictly beyond the full upstream POST lifetime plus reconciliation grace. Bootstrap may then atomically promote only the exact stale pending marker to ambiguous before reconciliation. Only a clean durable EOF from the latest stream attempt, with zero advancement for the full deadline, may atomically restore that exact ambiguous lease to waiting and return only that admission's approval claims to pending. An earlier EOF is discarded as evidence when a newer attempt starts, so a later hanging, transient, or malformed attempt cannot authorize rollback; 404s, stale identities, delayed acknowledgements after restoration, and concurrent boundaries likewise never infer delivery or non-delivery without cursor evidence. Session handles and transcript remain intact. A start with no recoverable handle is reaped after the bounded stale-admission interval; it cannot execute a finance write because every chat mutation remains approval-gated. Switching or clearing a thread aborts only local work and never reuses the old thread's runtime handles.

## Interactive bulk categorization

Ask Penge retains an interactive bulk mode under `/workspace/bulk-categorization`. Workspace files are sensitive per-session working memory, not authority. Only `read_file`, `write_file`, `glob`, and `grep` are available; shell, web/network, question, todo, and delegation tools remain disabled. Every final write re-reads authoritative data as needed, requires current revisions, and uses the same exact per-call Eve approval.

Production Eve session/sandbox retention and app-owned deletion remain deployment work outside migration Section 4.

## Current migration boundary

Ask Penge chat is Eve-native. Flue is still the default automated categorization workflow/runtime and active-run trace; an Eve categorization spike can be selected with `PENGE_AI_RUNTIME=eve`, but migration Sections 5–6 are not complete. Keep the categorization-only Flue route/provider, runtime variables, dependencies, and `flue_run_id` until those sections replace the lifecycle and trace and perform broad removal.

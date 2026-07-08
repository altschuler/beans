# Team data assistant

## Purpose

Ask Penge is an experimental chat assistant for questions about the current team's finance data. It is personal to the signed-in user and current team, and it can apply only the guarded writes exposed through Flue tools.

The assistant is useful for exploring transactions, categories, category groups, bank accounts, and prior categorizations in context. It is not an unrestricted database console, and the model never chooses authorization scope.

## Web shell and conversation scope

The protected app wraps authenticated pages in an `AppFlueProvider`. Browser requests use `/api/flue`; server rendering uses an absolute app URL for the same proxy path.

The app shell owns one root chat surface:

- `Shell` provides `TeamChatSidebarProvider` around the routed app content.
- `PageLayout` appends an icon-only `Ask Penge` trigger to the page-header actions.
- On desktop-sized viewports, opening chat renders a right sidebar sibling beside the routed content, reducing the available workspace width instead of overlaying it.
- On narrow viewports, opening chat hides the routed page content and shows a chat-focused panel with a close control to return to the page.

Conversation ids are encoded as `team-data:{...}` values containing trusted `teamId`, `userId`, and a per-chat `chatId`. Penge stores app-owned chat records in `team_data_assistant_chats` so each user/team pair has durable conversation history while Flue remains the message-history source. When the chat client loads, it resumes the latest submitted chat for the current user/team if it was used less than one hour ago; otherwise opening Ask Penge starts a new chat row. Clearing chat also creates a new persisted chat id, but only chats with a submitted message are shown in the timestamp-labelled history list so empty placeholder chat ids do not send users to missing Flue history.

## Flue proxy boundary

The browser never receives `PENGE_FLUE_INTERNAL_TOKEN`. The web `/api/flue` proxy authenticates the web session, decodes the team-data assistant id, verifies that the id's `userId` matches the session user, verifies team membership, strips hop-by-hop headers, then forwards the request to Flue with:

- the internal bearer token
- `x-penge-user-id`
- `x-penge-team-id`

The Flue agent route repeats the boundary check: the internal token must match, the agent id must decode, and the decoded scope must match the trusted forwarded headers. Agent tools close over that trusted scope.

## Reads

The assistant uses scoped Flue read tools to inspect current data before answering or proposing changes:

- `searchBankTransactions`
- `getBankTransactionDetail`
- `searchLedgerTransactions`
- `searchLedgerAccounts`

Read results are scoped to the trusted user/team and expose compact domain projections rather than arbitrary raw database rows or provider payloads.

## Live turn progress

During long turns, the chat transcript shows a small Penge activity bubble instead of only a generic working state. The bubble is derived from `useFlueAgent()` status and streamed message parts in the browser; it is not a separate trace panel.

Progress text is app-authored and allowlisted. Known tool activity maps to labels such as “Searching transactions…”, “Reading transaction details…”, “Checking categories…”, and “Reviewing prior categorizations…”. Streaming assistant text shows “Writing answer…”, submitted turns show “Starting…”, and unknown or unclassified activity falls back to “Thinking through the request…”. Raw tool names, tool arguments, tool outputs, internal ids, model reasoning, and provider details must not be shown in the progress bubble.

Progress labels remain visible for at least one second to avoid flicker. Errors bypass that delay and appear immediately, while final assistant text and idle states clear the activity bubble immediately.

While an assistant turn is active, the composer send control becomes an icon-only stop control. Stopping calls Flue's agent abort API for the current chat instance, which asks Flue to abort in-flight and queued work for that Ask Penge conversation. The control stays in stop mode while Flue reports an active turn, then returns to send mode once Flue settles the turn.

## Interactive bulk categorization

Ask Penge can handle initial or backlog categorization through an interactive bulk mode. The mode starts when the user explicitly asks for bulk, backlog, or initial categorization, and the assistant may also choose it after finding roughly 50 or more eligible uncategorized or needs-review transactions.

Bulk mode uses the default Flue virtual sandbox with a predictable workspace cwd. The assistant should work under `/work/bulk-categorization` and maintain working files such as `categories.json`, `eligible-transactions.jsonl`, `merchant-groups.jsonl`, `recurring-groups.jsonl`, `transfer-candidates.jsonl`, `category-decisions.jsonl`, and `progress.json`.

The workspace files are working memory, not authority. The assistant should ingest scoped data into files near the start of the run and avoid repeated broad exploratory database reads over the same set. Targeted database reads remain appropriate for missing details, stale or conflicted rows, user questions outside the workspace, refreshes, and final guarded writes that need current `categorizationRevision` values.

The assistant should group transactions by merchant, counterparty, recurrence, amount pattern, transfer candidates, and description similarity. It asks concise group-level confirmation questions that name the user-facing pattern, category, count, and representative examples. The initial bulk request is not permission to write. Confirmed groups are applied through the `applyCategorizations` tool with every transaction in the confirmed group, and progress is reported in chat. The assistant should verify remaining eligible transactions before saying a group or run is done.

Confirmed group decisions are current-backlog/session decisions only. Ask Penge does not create durable merchant/category rules in the first implementation.

## Writes and confirmation

Before any write, the assistant must state a concrete proposal naming the transaction, category, or category group and the exact change, then ask for permission. An initial user request to create, update, delete, apply, categorize, or otherwise change data is a request for a proposal, not permission to write. The assistant may call a write tool only after a separate natural explicit confirmation of the latest proposal, such as “yes”, “sounds good”, or “go ahead”. A new unrelated request is not confirmation.

Supported chat writes are:

- transaction categorization changes through `applyCategorizations`: category, split, or transfer
- category/group management through `manageCategory`: create group, update group, delete empty editable group, create category, update category, or delete unused editable category

Chat categorization writes use manual user-confirmed semantics and still require the current `categorizationRevision`. Category-management writes run one operation per tool call. If a category-management operation fails, the assistant should report the failure, re-read relevant categories or groups before proposing a follow-up, and stop remaining operations from that failed proposal.

## Shared domain rules

Category-management chat writes use the same shared domain functions as the Categories page. The shared rules trim names, authorize team membership, validate category type, reject edits to system or bank-linked accounts, reject system groups, enforce group/account ownership, and protect ledger history by refusing non-empty group deletion and category deletion when ledger postings exist.

Flue tools return structured results that the assistant can explain in chat, including `{ok: true, status: "applied"}` on success and `{ok: false, status: "rejected", error: "..."}` on validation, authorization, database constraint, or delete-eligibility failures.

The assistant must not surface internal ids, UUIDs, run ids, database ids, account ids, category ids, group ids, transaction ids, or other tool-only identifiers in normal chat responses. It can use ids internally for tool calls, but user-facing proposals, confirmations, and summaries should use names, dates, amounts, descriptions, and concise natural-language context instead.

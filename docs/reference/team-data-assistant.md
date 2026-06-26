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

Conversation ids are encoded as `team-data:{...}` values containing trusted `teamId`, `userId`, and a per-chat `chatId`. Clearing chat generates a new `chatId`, so history is personal per user/team/chat rather than a shared team channel.

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

## Writes and confirmation

Before any write, the assistant must state a concrete proposal naming the transaction, category, or category group and the exact change. It may call a write tool only after natural explicit confirmation of the latest proposal, such as “yes”, “sounds good”, or “go ahead”. A new unrelated request is not confirmation.

Supported chat writes are:

- transaction categorization changes through `applyCategorization`: category, split, or transfer
- category/group management through `manageCategory`: create group, update group, delete empty editable group, create category, update category, or delete unused editable category

Chat categorization writes use manual user-confirmed semantics and still require the current `categorizationRevision`. Category-management writes run one operation per tool call. If a category-management operation fails, the assistant should report the failure, re-read relevant categories or groups before proposing a follow-up, and stop remaining operations from that failed proposal.

## Shared domain rules

Category-management chat writes use the same shared domain functions as the Categories page. The shared rules trim names, authorize team membership, validate category type, reject edits to system or bank-linked accounts, reject system groups, enforce group/account ownership, and protect ledger history by refusing non-empty group deletion and category deletion when ledger postings exist.

Flue tools return structured results that the assistant can explain in chat, including `{ok: true, status: "applied"}` on success and `{ok: false, status: "rejected", error: "..."}` on validation, authorization, database constraint, or delete-eligibility failures.

# Flue team data chat design

Date: 2026-06-25

## Summary

Add an experimental chat interface for asking a Flue agent general-purpose questions about the current team's finance data. The first slice uses a root-level collapsible chat sidebar owned by the authenticated app shell, with `PageLayout` rendering a reusable trigger in its header. On wider screens, opening chat pushes routed page content inward instead of overlaying it. On mobile/narrow screens, opening chat switches to a chat-focused mode rather than attempting side-by-side layout. Conversations are personal per user/team. The agent can read scoped team data and can perform only the categorization writes supported by the existing guarded Flue/domain tools. Category-management writes are out of scope until dedicated guarded tools exist.

This is intentionally an experiment. The first slice uses natural-language confirmation: the agent must propose a concrete categorization write, then may apply it after the user naturally confirms the latest proposal, such as "yes" or "go ahead".

## Goals

- Let a signed-in user chat about transactions, categories, and related team data.
- Keep the finance page as the primary workspace while making chat available in context.
- Reuse existing Flue sidecar architecture and existing guarded categorization tools.
- Avoid new category-management write tools in this slice.
- Make the UI simple enough to evaluate the usefulness and safety of chat-driven writes.

## Non-goals

- No shared team chat history; conversations are personal per user/team.
- No category or category-group create/edit/delete writes.
- No explicit action-card confirmation system in this slice.
- No broad arbitrary ledger writes beyond existing categorization capabilities.
- No long-term least-privilege Flue authorization redesign.

## Architecture

### Flue sidecar

Add a continuing Flue agent, tentatively named `team-data-assistant`. The agent is exposed over HTTP for the web app to use through the Flue React hooks. Its instance id is derived from trusted web-side state, for example `team-data:${teamId}:${userId}`, so conversation history is personal for a user within a team.

The browser should not receive the internal Flue token. The web app should expose an authenticated proxy/mount path for Flue agent traffic; that boundary derives the signed-in user and selected team from the web session, forwards only trusted scope to Flue, and uses the existing internal token for the sidecar hop. The Flue agent route should reject requests that do not come through that trusted boundary or whose instance id does not match the forwarded `{userId, teamId}` scope. Agent tools close over trusted `{userId, teamId}` scope.

The agent can reuse existing categorization read/write tools where they fit. For category discussion, it can use existing read tools such as `searchLedgerAccounts`; if a requested category-management operation needs a missing tool, the agent should explain that it can suggest the change but cannot apply it yet.

### Web app

Add `@flue/react` and `@flue/sdk` to the web app. Create one Flue SDK client and provide it under the authenticated app shell with `FlueProvider`. Because TanStack Start server rendering needs absolute URLs while browser calls can use relative URLs, client creation should follow the Flue React guidance and the app's SSR constraints.

Add a reusable chat sidebar system: a provider that owns open/closed state and trusted user/team scope, a root host rendered by the authenticated shell, and a trigger rendered by `PageLayout`. The panel uses `useFlueAgent({ name: 'team-data-assistant', id })` to read the transcript, send messages, and observe status. The host exposes a right-side sidebar as a sibling to routed page content instead of rendering a modal overlay or placing chat inside individual page content.

## UI design

Use shadcn-style primitives and app design tokens:

- `Button` for the page-header trigger, close/back action, clear-chat action, and send action.
- `Textarea` or `Input` for the composer, depending on final ergonomics.
- Existing semantic token utilities such as `bg-background`, `bg-muted`, `text-muted-foreground`, `border`, and `text-destructive`.
- A root-level right sidebar container built with ordinary layout primitives; do not use `Sheet`/dialog content for the desktop chat surface because it overlays the workspace.

The first slice UI contains:

1. An `Ask Penge` button rendered by `PageLayout` in the page-header actions area.
2. On wider screens, a root-level right-side collapsible panel with a fixed header, scrollable transcript, and bottom composer. Opening this panel reduces the routed content width rather than covering it.
3. On mobile/narrow screens, a chat-focused mode that hides or collapses the routed page content while chat is open. The chat header must provide a clear back/close control to return to the page.
4. Text rendering for Flue message parts. Non-text parts can be ignored or displayed conservatively until a richer renderer is needed.
5. Status copy for connecting, submitting, streaming, and error states.

The UI should remain dense and calm. It should not obscure the existing table/category workflows with an overlay. Mobile does not attempt side-by-side layout.

## Agent behavior

The agent instructions should require:

- Use only scoped team data from available tools.
- Search/read relevant transactions, accounts, categories, and examples before recommending changes.
- Before any write, make a concrete proposal that names what will change.
- Treat natural confirmation of the latest concrete proposal as permission to apply that proposal.
- If the user asks for a category-management write, explain that this first slice can discuss/suggest it but cannot apply it without future guarded tools.
- Keep user-facing reasoning concise and display-safe.
- Never reveal private chain-of-thought.

Supported writes are limited to existing categorization interpretations:

- category
- split
- transfer
- unable

All writes still go through existing guarded domain logic and must re-authorize scope server-side.

## Data flow

1. The authenticated web app determines the signed-in user and current/personal team.
2. The authenticated shell provides chat scope and renders a single root sidebar host around routed page content.
3. `PageLayout` renders the reusable chat trigger; the root chat panel calls `useFlueAgent` for the personal user/team agent instance.
4. On submit, `sendMessage()` admits the prompt and the stream updates the transcript.
5. The agent uses scoped read tools to answer questions.
6. For supported categorization writes, the agent proposes a concrete change and waits for user confirmation.
7. After natural confirmation, the agent calls the existing guarded write tool.
8. Domain changes commit to Postgres; Zero observes the committed changes and syncs page data back to the client.

## Error handling

- If Flue is unavailable, show an error in the chat panel and leave the surrounding page usable.
- If the stream disconnects, show the `useFlueAgent` status and allow the user to retry when appropriate.
- Disable or mark the composer while a message submission is in progress.
- If a guarded write fails validation, authorization, or revision conflict checks, the tool returns a structured failure and the agent explains the failure in chat.
- If the agent cannot perform a requested write because a guarded tool does not exist, it should say so and provide a non-applied suggestion.

## Testing and verification

- Typecheck `apps/flue` after adding the agent.
- Typecheck `apps/web` after adding the React integration and chat panel component.
- Add focused tests only where they protect new behavior:
  - Flue agent/tool wiring tests for trusted scope closure if the implementation exposes test seams.
  - Component tests for opening/collapsing the chat panel, transcript rendering, composer submission, disabled/submitting state, error status, and mobile chat-focused mode if the existing test harness supports these patterns.
- Existing domain categorization tests remain the primary coverage for categorization write safety.

## Open follow-ups after the experiment

- Replace natural-language confirmation with explicit action cards if the experiment proves valuable.
- Add guarded category-management tools for create/edit operations.
- Revisit the web-to-Flue auth boundary and reduce reliance on the shared internal token model.
- Add richer rendering for tool activity or proposal summaries if Flue message parts expose useful structured data.

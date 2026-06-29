# Categorization Workflow Trace Design

## Goal

Add team-level visibility into the active AI categorization workflow on the Transactions page by observing the Flue workflow run from the browser with `useFlueWorkflow()`.

This is an active-run trace only. It does not add persisted app trace events, completed-run history, or a sanitized domain activity projection.

## Current context

- The web app starts categorization through server functions.
- The web server reserves an `agent_workflow_runs` row with an app-visible `appRunId`.
- Flue starts the `categorize-transactions` workflow and later attaches its runtime `flueRunId` to the app run.
- The Transactions page already reads active `agent_workflow_runs` through Zero and shows a team-level running indicator.
- `AppFlueProvider` already provides an SDK client at `/api/flue`, which is the correct setup for `@flue/react` hooks.

## Approach

Use `@flue/react`'s `useFlueWorkflow({runId})` hook in a Transactions-page trace component.

The component receives the active categorization run from the existing Zero query:

- if no active run exists, render nothing
- if an active run exists but `flueRunId` is still `null`, render a small pending message
- once `flueRunId` exists, pass it to `useFlueWorkflow({runId: flueRunId})`
- render a compact team-level event timeline from `run.events`, plus status/error state

Workflow invocation remains server-owned. The browser only observes an already-started run.

## Proxy authorization

Extend the existing `/api/flue` proxy to allow workflow run observation routes:

- `GET /api/flue/runs/:runId`
- `HEAD /api/flue/runs/:runId`

The proxy should authorize these requests by:

1. requiring an authenticated session
2. looking up `agent_workflow_runs.flue_run_id = :runId`
3. checking that the authenticated user can access that run's `teamId`
4. forwarding the request to Flue with the internal bearer token

Unauthorized or inaccessible runs should return `404` after authentication, matching the app's existing not-found authorization style. Unauthenticated requests should return `401`.

The proxy should keep the existing team-data-assistant route behavior unchanged.

## UI behavior

Add a compact trace panel near the existing Transactions page AI running indicator.

Suggested first-slice event labels:

- `run_start`: Workflow started
- `run_end` without error: Workflow completed
- `run_end` with error: Workflow failed
- `turn_start`: AI started a model step
- `turn`: AI finished a model step
- `tool_start`: Started tool: `<toolName>`
- `tool`: Finished tool: `<toolName>`
- `log`: the event message
- fallback: the raw event type

Keep the panel calm and dense. Use existing semantic tokens and shadcn/Tailwind patterns. Do not add new design tokens.

## Failure states

- No `flueRunId` yet: show “Preparing AI categorization trace…”
- `connecting`: show “Connecting to workflow trace…”
- `disconnected`: show “Could not connect to workflow trace.”
- `errored`: show workflow error text if displayable, otherwise “Workflow failed.”

The trace connection is informational. A disconnected trace should not imply the categorization workflow itself was cancelled, because the authoritative active/completed workflow state still comes from Zero and `agent_workflow_runs`.

## Tests

Keep tests light and focused.

Recommended coverage:

- Proxy authorization for `/runs/:runId`:
  - unauthenticated request returns `401`
  - inaccessible or unknown run returns `404`
  - accessible run forwards to Flue with the internal bearer token
- UI rendering for the trace component with a mocked `useFlueWorkflow`:
  - pending message when active run has no `flueRunId`
  - event/status rendering when a run id is present

Avoid broad snapshot tests or tests that assert implementation details of the Flue hook.

## Out of scope

- Persisted sanitized trace events in app tables
- Completed-run history
- Per-transaction trace details
- Browser-side workflow invocation
- Redacting or transforming all raw Flue event payloads for end-user safety

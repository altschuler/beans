# Server

## Zero mutators and external orchestration

Zero mutators are for app/domain writes that should run through Zero mutation processing. They run on the client optimistically and on the server through the mutate endpoint, where server-side reads and writes have database transaction semantics.

Keep Zero mutators short. Do not perform long-running external calls inside a Zero mutator, such as:

- LLM/API calls for AI categorization
- banking/provider sync calls
- notification delivery
- webhooks to third-party systems

For external orchestration, use a server function, server-only service, or an internal runtime sidecar such as the current Flue service or the eve migration skeleton instead:

1. authenticate and authorize server-side
2. make short committed database updates to record visible state, such as an `agent_workflow_runs` row or other processing marker
3. call the external service outside any Zero mutator or long-lived database transaction
4. make short committed database updates with the result or admission failure
5. clear transient processing state in a `finally` path when the orchestration owns transient state

The remaining Flue categorization workflow lives in `apps/flue` and runs as a sidecar service. Eve-backed Ask Penge lives in `apps/eve`; the web app owns chat admission, authorization, sanitized persistence, and recovery before forwarding to Eve with a resource-scoped service capability. The Eve categorization spike similarly reserves app-visible workflow state before invocation and passes trusted `appRunId`, `userId`, and `teamId`. Runtime tools must not let the model choose authorization scope. Runtime sidecars should update domain tables through trusted server/domain logic, not through Zero.

If the work needs durable retry, use an outbox table or background worker rather than relying on an in-request async task.

Domain rows that are exposed through Zero should still be read by the client through Zero queries. The orchestration boundary does not change the read path; it only keeps slow external work out of Zero mutators.

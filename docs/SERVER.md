# Server

## Zero mutators and external orchestration

Zero mutators are for app/domain writes that should run through Zero mutation processing. Keep them short and do not perform long-running provider, model, notification, or webhook calls inside a Zero mutator or long-lived request transaction.

External orchestration belongs in an authenticated server function, server-only service, or internal runtime sidecar. Authorize first, perform external work outside Zero mutation transactions, and use short committed writes for any app-visible state. Durable retry requires an outbox or background worker rather than an in-request detached task.

Ask Penge runs in `apps/eve`. The web app owns the authenticated chat proxy, chat-to-session mapping, capability minting, and stateless event sanitization. Eve owns durable execution, transcripts, approval state, stream replay, and reconnection. The client uses Zero only for chat-list metadata; it replays transcript state directly from Eve through the authorized proxy.

Runtime tools must never let the model choose authorization scope. They derive trusted scope from verified Eve session auth and call shared `@penge/domain` services. App/domain rows exposed through Zero continue to use Zero as their normal browser read/write path.

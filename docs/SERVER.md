# Server

## Zero mutators and external orchestration

Zero mutators are for app/domain writes that should run through Zero mutation processing. Keep them short and do not perform long-running provider, model, notification, or webhook calls inside a Zero mutator or long-lived request transaction.

External orchestration belongs in an authenticated server function, server-only service, or internal runtime sidecar. Authorize first, perform external work outside Zero mutation transactions, and use short committed writes for any app-visible state. Durable retry requires an outbox or background worker rather than an in-request detached task.

App/domain rows exposed through Zero use Zero as their normal browser read/write path. Domain commands authorize writes through persisted team membership.

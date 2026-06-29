# Ask Penge chat progress visibility

## Goal

Ask Penge should give users a calm, useful indication of what is happening during long chat turns. The current generic "Penge is working…" message can remain on screen for a long time and gives no confidence that the assistant is making progress.

## Chosen design

Use a compact live status bubble in the existing chat transcript. Replace generic working copy with one safe, user-facing label that describes the current activity.

Examples:

- "Starting…"
- "Searching transactions…"
- "Reading transaction details…"
- "Checking categories…"
- "Reviewing prior categorizations…"
- "Thinking through the request…"
- "Writing answer…"

The status stays visually similar to the current activity bubble: a small Penge bubble in muted text. It should not become a trace panel, timeline, or debug view.

## Source of progress

First implementation should derive progress from the existing `useFlueAgent()` state and message parts in `TeamChatPanel`:

- `agent.status === "submitted"` maps to "Starting…".
- streaming assistant text maps to "Writing answer…".
- dynamic tool parts map by `toolName` to safe labels.
- reasoning-only or otherwise unclassified streaming activity maps to "Thinking through the request…".
- errors keep using the existing error presentation.

If the React hook does not expose enough live state for useful progress, a later iteration can add a direct `client.agents.stream()` observer for the active agent. That is intentionally out of scope for the first slice.

## Privacy and safety

The progress bubble must use only application-authored labels. It must never show raw model reasoning, tool arguments, tool outputs, internal IDs, UUIDs, database IDs, counts from raw tool output, or provider details.

Tool names are treated as internal signals and translated through an explicit allowlist. Unknown tools fall back to a generic safe status.

## Anti-flash behavior

Progress labels should have a minimum display time of 1000 ms to avoid flickering through quick tool states.

Rules:

- The minimum display time applies only to progress/action statuses.
- Errors bypass the delay and appear immediately.
- Final assistant text and idle/clear states can appear immediately.
- If multiple progress labels arrive quickly, queue or coalesce them so the UI remains readable. The implementation can keep the latest pending label and show it when the current label's minimum time has elapsed.

## UI placement

Keep the status in the transcript where the current `ChatActivityBubble` appears. Do not add a header indicator or separate panel for this first slice.

## Testing

Add or update unit tests for:

- safe tool-label mapping for known Flue tools;
- unknown tools falling back to a generic status;
- text streaming showing "Writing answer…";
- progress labels respecting the 1000 ms minimum display time;
- errors bypassing the progress delay;
- idle/final answer states clearing the activity bubble without waiting.

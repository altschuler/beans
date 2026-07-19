import { describe, expect, it, vi } from "vitest";
import { defaultMessageReducer, isCurrentTurnBoundaryEvent } from "eve/client";
import type { EveMessageData, HandleMessageStreamEvent } from "eve/client";
import { safeChatErrorSchema } from "@/eve/chat-error-catalog";
import { sanitizeChatEvent } from "@/eve/chat-event-sanitizer.server";

const structure = { sequence: 1, stepIndex: 0, turnId: "turn-1" };
const meta = { at: "2026-07-10T12:00:00.000Z" };
const rawSecret = "FORBIDDEN_RAW_SENTINEL";
const safeProposal = {
  kind: "manageCategory" as const,
  operation: { kind: "createGroup" as const, newName: "Household" },
};
type EveEventType = HandleMessageStreamEvent["type"];

// Record<> + satisfies makes an Eve upgrade fail this test at compile time until every new
// discriminant has an explicit sanitizer fixture.
const eveFixtures = {
  "session.started": {
    type: "session.started",
    data: {
      runtime: {
        agentId: rawSecret,
        modelId: rawSecret,
        eveVersion: rawSecret,
        build: { gitSha: rawSecret },
      },
    },
    meta,
  },
  "turn.started": {
    type: "turn.started",
    data: { sequence: 1, turnId: "turn-1" },
    meta,
  },
  "message.received": {
    type: "message.received",
    data: {
      message: "Hello",
      parts: [
        {
          type: "file",
          filename: rawSecret,
          mediaType: "text/plain",
          url: `https://example.test/${rawSecret}`,
        },
      ],
      sequence: 1,
      turnId: "turn-1",
    },
    meta,
  },
  "actions.requested": {
    type: "actions.requested",
    data: {
      ...structure,
      actions: [
        {
          kind: "tool-call",
          callId: "call-tool",
          toolName: "manageCategory",
          input: { secret: rawSecret },
        },
        {
          kind: "load-skill",
          callId: "call-skill",
          input: { secret: rawSecret },
        },
        {
          kind: "subagent-call",
          callId: "call-subagent",
          description: rawSecret,
          input: { secret: rawSecret },
          name: rawSecret,
          nodeId: rawSecret,
          subagentName: rawSecret,
        },
        {
          kind: "remote-agent-call",
          callId: "call-remote",
          description: rawSecret,
          input: { secret: rawSecret },
          name: rawSecret,
          nodeId: rawSecret,
          remoteAgentName: rawSecret,
        },
      ],
    },
    meta,
  },
  "input.requested": {
    type: "input.requested",
    data: {
      ...structure,
      requests: [
        {
          requestId: "request-1",
          prompt: rawSecret,
          display: "confirmation",
          options: [
            { id: "approve", label: "Approve" },
            { id: "deny", label: "Deny" },
          ],
          action: {
            kind: "tool-call",
            callId: "call-1",
            toolName: "manageCategory",
            input: {
              operation: { kind: "createGroup", name: "Household" },
              secret: rawSecret,
            },
          },
        },
      ],
    },
    meta,
  },
  "action.result": {
    type: "action.result",
    data: {
      ...structure,
      status: "completed",
      result: {
        kind: "tool-result",
        callId: "call-1",
        toolName: "manageCategory",
        output: { secret: rawSecret },
      },
    },
    meta,
  },
  "subagent.called": {
    type: "subagent.called",
    data: {
      callId: "call-child",
      childSessionId: rawSecret,
      sessionId: rawSecret,
      sequence: 1,
      name: rawSecret,
      toolName: rawSecret,
      turnId: "turn-1",
      workflowId: rawSecret,
    },
    meta,
  },
  "subagent.started": {
    type: "subagent.started",
    data: { callId: "call-child", subagentName: rawSecret },
    meta,
  },
  "subagent.event": {
    type: "subagent.event",
    data: {
      callId: "call-child",
      subagentName: rawSecret,
      event: {
        type: "message.completed",
        data: { ...structure, message: rawSecret, finishReason: "stop" },
      },
    },
    meta,
  },
  "subagent.completed": {
    type: "subagent.completed",
    data: { callId: "call-child", subagentName: rawSecret, output: rawSecret },
    meta,
  },
  "message.appended": {
    type: "message.appended",
    data: { ...structure, messageDelta: "Hi", messageSoFar: "Hi" },
    meta,
  },
  "reasoning.appended": {
    type: "reasoning.appended",
    data: {
      ...structure,
      reasoningDelta: rawSecret,
      reasoningSoFar: rawSecret,
    },
    meta,
  },
  "message.completed": {
    type: "message.completed",
    data: { ...structure, message: "Hi there", finishReason: "stop" },
    meta,
  },
  "reasoning.completed": {
    type: "reasoning.completed",
    data: { ...structure, reasoning: rawSecret },
    meta,
  },
  "result.completed": {
    type: "result.completed",
    data: { ...structure, result: { secret: rawSecret } },
    meta,
  },
  "step.started": { type: "step.started", data: structure, meta },
  "step.completed": {
    type: "step.completed",
    data: {
      ...structure,
      finishReason: "stop",
      usage: { inputTokens: 999 },
      providerMetadata: { gateway: { generationId: rawSecret } },
    },
    meta,
  },
  "step.failed": {
    type: "step.failed",
    data: {
      ...structure,
      code: rawSecret,
      message: rawSecret,
      details: { secret: rawSecret },
    },
    meta,
  },
  "turn.completed": {
    type: "turn.completed",
    data: { sequence: 1, turnId: "turn-1" },
    meta,
  },
  "turn.cancelled": {
    type: "turn.cancelled",
    data: { sequence: 1, turnId: "turn-1" },
    meta,
  },
  "turn.failed": {
    type: "turn.failed",
    data: {
      sequence: 1,
      turnId: "turn-1",
      code: rawSecret,
      message: rawSecret,
      details: { secret: rawSecret },
    },
    meta,
  },
  "compaction.requested": {
    type: "compaction.requested",
    data: {
      modelId: rawSecret,
      sequence: 1,
      sessionId: rawSecret,
      turnId: "turn-1",
      usageInputTokens: 1,
    },
    meta,
  },
  "compaction.completed": {
    type: "compaction.completed",
    data: {
      modelId: rawSecret,
      sequence: 1,
      sessionId: rawSecret,
      turnId: "turn-1",
    },
    meta,
  },
  "authorization.required": {
    type: "authorization.required",
    data: {
      ...structure,
      name: rawSecret,
      description: rawSecret,
      webhookUrl: rawSecret,
    },
    meta,
  },
  "authorization.completed": {
    type: "authorization.completed",
    data: {
      ...structure,
      name: rawSecret,
      outcome: "failed",
      reason: rawSecret,
    },
    meta,
  },
  "session.waiting": {
    type: "session.waiting",
    data: { continuationToken: rawSecret, wait: "next-user-message" },
    meta,
  },
  "session.failed": {
    type: "session.failed",
    data: {
      sessionId: rawSecret,
      code: rawSecret,
      message: rawSecret,
      details: { secret: rawSecret },
    },
    meta,
  },
  "session.completed": { type: "session.completed", meta },
} satisfies Record<EveEventType, HandleMessageStreamEvent>;

const nestedActionResults = [
  {
    type: "action.result",
    data: {
      ...structure,
      status: "completed",
      result: {
        kind: "tool-result",
        callId: "call-tool",
        toolName: "manageCategory",
        output: { secret: rawSecret },
      },
    },
    meta,
  },
  {
    type: "action.result",
    data: {
      ...structure,
      status: "completed",
      result: {
        kind: "load-skill-result",
        callId: "call-skill",
        name: rawSecret,
        output: { secret: rawSecret },
      },
    },
    meta,
  },
  {
    type: "action.result",
    data: {
      ...structure,
      status: "completed",
      result: {
        kind: "subagent-result",
        callId: "call-subagent",
        subagentName: rawSecret,
        output: { secret: rawSecret },
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
        },
      },
    },
    meta,
  },
] satisfies Array<Extract<HandleMessageStreamEvent, { type: "action.result" }>>;

const maliciousMalformedFixtures: unknown[] = [
  null,
  { type: "future.secret.event", data: { secret: rawSecret } },
  { type: "message.completed", data: rawSecret },
  {
    type: "session.waiting",
    data: { wait: "authorization", secret: rawSecret },
  },
];

describe("Eve chat event sanitizer", () => {
  it("exhaustively emits one reducer-consumable safe event for every Eve 0.25.1 discriminant", async () => {
    const reducer = defaultMessageReducer();
    let state = reducer.initial();
    const fixtures = Object.values(eveFixtures);
    const outputs = [];
    for (const raw of fixtures) {
      const sanitized = await sanitizeChatEvent(raw, {
        scope: { teamId: "team-1", userId: "user-1" },
        resolveProposal: async () => ({
          status: "ready",
          proposal: safeProposal,
        }),
      });
      outputs.push(sanitized.event);
      expect(sanitized.event).toEqual(
        expect.objectContaining({ type: expect.any(String) }),
      );
      expect(JSON.stringify(sanitized)).not.toContain(rawSecret);
      expect(() => {
        state = reducer.reduce(state, sanitized.event as never);
      }).not.toThrow();
    }
    expect(outputs).toHaveLength(fixtures.length);
    expect(state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          parts: [expect.objectContaining({ type: "text", text: "Hello" })],
        }),
        expect.objectContaining({
          role: "assistant",
          parts: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "Hi there" }),
          ]),
        }),
      ]),
    );
  });

  it("maps malformed and future non-boundaries one-for-one to a no-op without leaking raw data", async () => {
    const outputs = await Promise.all(
      maliciousMalformedFixtures.map((raw) =>
        sanitizeChatEvent(raw, {
          scope: { teamId: "team-1", userId: "user-1" },
        }),
      ),
    );
    expect(outputs).toHaveLength(maliciousMalformedFixtures.length);
    expect(outputs.map((output) => output.event)).toEqual(
      maliciousMalformedFixtures.map(() => ({
        type: "session.started",
        data: {},
      })),
    );
    expect(JSON.stringify(outputs)).not.toContain(rawSecret);
  });

  it("keeps every nested action request/result kind structurally valid with redacted payloads", async () => {
    const requested = await sanitizeChatEvent(
      eveFixtures["actions.requested"],
      { scope: { teamId: "team-1", userId: "user-1" } },
    );
    expect(requested.event).toEqual({
      type: "actions.requested",
      data: {
        ...structure,
        actions: [
          {
            kind: "tool-call",
            callId: "call-tool",
            toolName: "manageCategory",
            input: {},
          },
          { kind: "load-skill", callId: "call-skill", input: {} },
          {
            kind: "subagent-call",
            callId: "call-subagent",
            description: "",
            input: {},
            name: "redacted",
            nodeId: "redacted",
            subagentName: "redacted",
          },
          {
            kind: "remote-agent-call",
            callId: "call-remote",
            description: "",
            input: {},
            name: "redacted",
            nodeId: "redacted",
            remoteAgentName: "redacted",
          },
        ],
      },
      meta,
    });

    const results = await Promise.all(
      nestedActionResults.map((fixture) =>
        sanitizeChatEvent(fixture, {
          scope: { teamId: "team-1", userId: "user-1" },
        }),
      ),
    );
    expect(results.map((result) => result.event)).toEqual([
      {
        type: "action.result",
        data: {
          ...structure,
          status: "completed",
          result: {
            kind: "tool-result",
            callId: "call-tool",
            toolName: "manageCategory",
            output: { redacted: true },
          },
        },
        meta,
      },
      {
        type: "action.result",
        data: {
          ...structure,
          status: "completed",
          result: {
            kind: "load-skill-result",
            callId: "call-skill",
            name: "redacted",
            output: { redacted: true },
          },
        },
        meta,
      },
      {
        type: "action.result",
        data: {
          ...structure,
          status: "completed",
          result: {
            kind: "subagent-result",
            callId: "call-subagent",
            subagentName: "redacted",
            output: { redacted: true },
          },
        },
        meta,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain(rawSecret);
  });

  it("replaces raw approval input with the canonical safe proposal inside action.input only", async () => {
    const ready = await sanitizeChatEvent(eveFixtures["input.requested"], {
      scope: { teamId: "team-1", userId: "user-1" },
      resolveProposal: async () => ({
        status: "ready",
        proposal: safeProposal,
      }),
    });
    expect(ready.event).toEqual({
      type: "input.requested",
      data: {
        ...structure,
        requests: [
          {
            requestId: "request-1",
            prompt: "Approve this change?",
            display: "confirmation",
            allowFreeform: false,
            options: [
              { id: "approve", label: "Approve", style: "primary" },
              { id: "deny", label: "Deny", style: "danger" },
            ],
            action: {
              kind: "tool-call",
              callId: "call-1",
              toolName: "manageCategory",
              input: safeProposal,
            },
          },
        ],
      },
      meta,
    });

    const blocked = await sanitizeChatEvent(eveFixtures["input.requested"], {
      scope: { teamId: "team-1", userId: "user-1" },
      resolveProposal: async () => ({ status: "blocked" }),
    });
    expect(blocked.event).toEqual({
      type: "input.requested",
      data: {
        ...structure,
        requests: [
          {
            requestId: "request-1",
            prompt: "Approve this change?",
            display: "confirmation",
            allowFreeform: false,
            options: [
              { id: "approve", label: "Approve", style: "primary" },
              { id: "deny", label: "Deny", style: "danger" },
            ],
            action: {
              kind: "tool-call",
              callId: "call-1",
              toolName: "manageCategory",
              input: { proposalUnavailable: true },
            },
          },
        ],
      },
      meta,
    });
    expect(JSON.stringify(blocked)).not.toContain(rawSecret);
  });

  it("rejects duplicate approval request IDs before resolving or emitting a partial projection", async () => {
    const resolveProposal = vi.fn(async () => ({
      status: "ready" as const,
      proposal: safeProposal,
    }));
    const raw = eveFixtures["input.requested"];
    const duplicated = {
      ...raw,
      data: {
        ...raw.data,
        requests: [
          raw.data.requests[0],
          {
            ...raw.data.requests[0],
            action: {
              ...raw.data.requests[0].action,
              callId: "different-call",
            },
          },
        ],
      },
    };
    const sanitized = await sanitizeChatEvent(duplicated, {
      scope: { teamId: "team-1", userId: "user-1" },
      resolveProposal,
    });
    expect(sanitized).toEqual({
      event: { type: "session.started", data: {}, meta },
    });
    expect(resolveProposal).not.toHaveBeenCalled();
  });

  it("replays safe approval, denial, completed/failed tool states through the real reducer", async () => {
    const reducer = defaultMessageReducer();
    let state = reducer.initial();
    const reduceRaw = async (raw: unknown) => {
      const sanitized = await sanitizeChatEvent(raw, {
        scope: { teamId: "team-1", userId: "user-1" },
        resolveProposal: async () => ({
          status: "ready",
          proposal: safeProposal,
        }),
      });
      state = reducer.reduce(state, sanitized.event as never);
      return sanitized.event;
    };
    const approvalRequest = (requestId: string, callId: string) => ({
      type: "input.requested",
      data: {
        ...structure,
        requests: [
          {
            requestId,
            prompt: rawSecret,
            display: "confirmation",
            action: {
              kind: "tool-call",
              callId,
              toolName: "manageCategory",
              input: { operation: { kind: "createGroup", name: "Household" } },
            },
          },
        ],
      },
    });

    await reduceRaw(approvalRequest("request-denied", "call-denied"));
    let part = findToolPart(state, "call-denied");
    expect(part).toMatchObject({
      state: "approval-requested",
      input: safeProposal,
      approval: { id: "request-denied" },
    });
    await reduceRaw({
      type: "action.result",
      data: {
        ...structure,
        status: "rejected",
        error: { code: rawSecret, message: rawSecret },
        result: {
          kind: "tool-result",
          callId: "call-denied",
          toolName: "manageCategory",
          output: rawSecret,
        },
      },
    });
    part = findToolPart(state, "call-denied");
    expect(part).toMatchObject({
      state: "output-denied",
      approval: {
        approved: false,
        id: "request-denied",
        reason: "This change was denied.",
      },
    });

    await reduceRaw(approvalRequest("request-completed", "call-completed"));
    await reduceRaw({
      type: "action.result",
      data: {
        ...structure,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-completed",
          toolName: "manageCategory",
          output: { secret: rawSecret },
        },
      },
    });
    expect(findToolPart(state, "call-completed")).toMatchObject({
      state: "output-available",
      approval: { approved: true, id: "request-completed" },
      output: { redacted: true },
    });

    await reduceRaw({
      type: "actions.requested",
      data: {
        ...structure,
        actions: [
          {
            kind: "tool-call",
            callId: "call-failed",
            toolName: "manageCategory",
            input: { secret: rawSecret },
          },
        ],
      },
    });
    await reduceRaw({
      type: "action.result",
      data: {
        ...structure,
        status: "failed",
        error: { code: rawSecret, message: rawSecret },
        result: {
          kind: "tool-result",
          callId: "call-failed",
          toolName: "manageCategory",
          output: { secret: rawSecret },
          isError: true,
        },
      },
    });
    expect(findToolPart(state, "call-failed")).toMatchObject({
      state: "output-error",
      errorText: "Ask Penge could not complete this response.",
      input: {},
    });
    expect(JSON.stringify(state)).not.toContain(rawSecret);
  });

  it("preserves only genuine waiting/completed/failed boundaries and maps failures to the bounded catalog", async () => {
    for (const raw of [
      eveFixtures["session.waiting"],
      eveFixtures["session.failed"],
      eveFixtures["session.completed"],
    ]) {
      const { event } = await sanitizeChatEvent(raw, {
        scope: { teamId: "team-1", userId: "user-1" },
      });
      expect(isCurrentTurnBoundaryEvent(event as never)).toBe(true);
    }
    const malformedWaiting = await sanitizeChatEvent(
      { type: "session.waiting", data: { wait: "not-a-real-boundary" } },
      { scope: { teamId: "t", userId: "u" } },
    );
    expect(malformedWaiting.event).toEqual({
      type: "session.started",
      data: {},
    });
    expect(isCurrentTurnBoundaryEvent(malformedWaiting.event as never)).toBe(
      false,
    );

    for (const raw of [
      eveFixtures["step.failed"],
      eveFixtures["turn.failed"],
      eveFixtures["session.failed"],
    ]) {
      const { event } = await sanitizeChatEvent(raw, {
        scope: { teamId: "team-1", userId: "user-1" },
      });
      const data =
        "data" in event ? (event.data as Record<string, unknown>) : {};
      expect(
        safeChatErrorSchema.safeParse({
          code: data.code,
          message: data.message,
        }).success,
      ).toBe(true);
      expect(data).toMatchObject({
        code: "CHAT_TURN_FAILED",
        message: "Ask Penge could not complete this response.",
      });
      expect(data).not.toHaveProperty("details");
    }
  });

  it("retains valid UTC/offset meta.at and rejects malformed or calendar-impossible timestamps", async () => {
    const offsetMeta = { at: "2026-07-10T14:00:00+02:00" };
    for (const accepted of [meta, offsetMeta]) {
      const sanitized = await sanitizeChatEvent(
        { type: "session.started", data: {}, meta: accepted },
        { scope: { teamId: "t", userId: "u" } },
      );
      expect(sanitized.event).toEqual({
        type: "session.started",
        data: {},
        meta: accepted,
      });
    }
    for (const at of [
      rawSecret,
      "2026-02-30T12:00:00.000Z",
      "2026-07-10T25:00:00.000Z",
    ]) {
      const sanitized = await sanitizeChatEvent(
        { type: "session.started", data: {}, meta: { at, other: rawSecret } },
        { scope: { teamId: "t", userId: "u" } },
      );
      expect(sanitized.event).toEqual({ type: "session.started", data: {} });
    }
  });
});

function findToolPart(state: EveMessageData, callId: string) {
  return state.messages
    .flatMap((message) => message.parts)
    .find((part) => part.type === "dynamic-tool" && part.toolCallId === callId);
}

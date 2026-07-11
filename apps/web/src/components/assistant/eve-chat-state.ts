import type { EveMessage } from "eve/client";
import type { UseEveAgentStatus } from "eve/react";
import {
  safeChatProposalSchema,
  type SafeChatProposal,
} from "@penge/domain/eve-chat-approval";
import type { ChatApprovalStatus } from "./chat-approval-card";

/**
 * This intentionally uses the raw proxy POST. The browser never receives Eve's continuation token,
 * and the SDK rejects inputResponses-only sends when its client store has no continuation token.
 */
export async function sendEveApprovalResponse(
  chatId: string,
  sessionId: string,
  action: { requestId: string; decision: "approve" | "deny" },
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `/api/eve/chat/${encodeURIComponent(chatId)}/eve/v1/session/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputResponses: [
          { requestId: action.requestId, optionId: action.decision },
        ],
      }),
    },
  );
  if (!response.ok)
    throw new Error("Ask Penge could not submit this approval.");
}

export function canStopEveTurn(
  status: UseEveAgentStatus,
  hasAttachedSession: boolean,
) {
  return (
    status === "streaming" || (status === "submitted" && hasAttachedSession)
  );
}

export function approvalCards(messages: readonly EveMessage[]) {
  const cards: Array<{
    requestId: string;
    toolCallId: string;
    proposal: SafeChatProposal | null;
    toolName: string;
    status: ChatApprovalStatus;
  }> = [];
  for (const part of messages.flatMap((message) => message.parts)) {
    if (part.type !== "dynamic-tool" || !part.approval) continue;
    const parsed = safeChatProposalSchema.safeParse(part.input);
    let status: ChatApprovalStatus;
    switch (part.state) {
      case "approval-requested":
        status = parsed.success ? "pending" : "unavailable";
        break;
      case "approval-responded":
        status = part.approval.approved === true
          ? "approved"
          : part.approval.approved === false
            ? "denied"
            : "submitting";
        break;
      case "output-denied":
        status = "denied";
        break;
      case "output-error":
        status = "failed";
        break;
      case "output-available":
        status = "approved";
        break;
    }
    cards.push({
      requestId: part.approval.id,
      toolCallId: part.toolCallId,
      proposal: parsed.success ? parsed.data : null,
      toolName: part.toolName,
      status,
    });
  }
  return cards;
}

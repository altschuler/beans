// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatApprovalCard } from "@/components/assistant/chat-approval-card";

const proposal = {
  kind: "manageCategory" as const,
  operation: {
    kind: "updateCategory" as const,
    currentName: "Meals",
    newName: "Dining",
    description: "Food away from home",
    type: "expense" as const,
    groupName: "Expenses",
  },
};

describe("ChatApprovalCard", () => {
  it.each(["approve", "deny"] as const)(
    "submits the exact pending %s response",
    async (decision) => {
      const onRespond = vi.fn();
      render(
        <ChatApprovalCard
          requestId="request-1"
          proposal={proposal}
          toolName="manageCategory"
          status="pending"
          submittingDecision={null}
          readOnly={false}
          onRespond={onRespond}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", {
          name: `${decision === "approve" ? "Approve" : "Deny"} proposed change`,
        }),
      );
      expect(onRespond).toHaveBeenCalledWith({
        requestId: "request-1",
        decision,
      });
    },
  );

  it("fails closed when the proposal is unavailable", () => {
    render(
      <ChatApprovalCard
        requestId="request-1"
        proposal={null}
        toolName="manageCategory"
        status="unavailable"
        submittingDecision={null}
        readOnly={false}
        onRespond={vi.fn()}
      />,
    );
    expect(
      screen.getByText("This change cannot be safely approved."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve proposed change" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Deny proposed change" }),
    ).toBeDisabled();
  });

  it.each([
    ["approved" as const, "This change was approved."],
    ["denied" as const, "This change was denied."],
  ])("renders replayed %s state without controls", (status, label) => {
    render(
      <ChatApprovalCard
        requestId="request-1"
        proposal={proposal}
        toolName="manageCategory"
        status={status}
        submittingDecision={null}
        readOnly={false}
        onRespond={vi.fn()}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    ["approve" as const, "Approving…"],
    ["deny" as const, "Denying…"],
  ])(
    "shows decision-specific non-actionable %s progress",
    (decision, label) => {
      render(
        <ChatApprovalCard
          requestId="request-1"
          proposal={proposal}
          toolName="manageCategory"
          status="pending"
          submittingDecision={decision}
          readOnly={false}
          onRespond={vi.fn()}
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Approve proposed change" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Deny proposed change" }),
      ).toBeDisabled();
    },
  );

  it("keeps unresolved approvals non-actionable in a read-only chat", async () => {
    const onRespond = vi.fn();
    render(
      <ChatApprovalCard
        requestId="request-1"
        proposal={proposal}
        toolName="manageCategory"
        status="pending"
        submittingDecision={null}
        readOnly
        onRespond={onRespond}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Approve proposed change" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Deny proposed change" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Approve proposed change" }),
    );
    expect(onRespond).not.toHaveBeenCalled();
  });

  it.each([
    ["submitting" as const, "This approval is being submitted."],
    ["failed" as const, "This approved change could not be applied."],
  ])("renders %s state without controls", (status, label) => {
    render(
      <ChatApprovalCard
        requestId="request-1"
        proposal={proposal}
        toolName="manageCategory"
        status={status}
        submittingDecision={null}
        readOnly={false}
        onRespond={vi.fn()}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

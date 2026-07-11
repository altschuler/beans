import { type SafeChatProposal } from "@penge/domain/eve-chat-approval";
import { Currency } from "@/components/currency";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type ChatApprovalStatus =
  | "pending"
  | "submitting"
  | "approved"
  | "denied"
  | "failed"
  | "unavailable";

export type ChatApprovalAction = {
  requestId: string;
  decision: "approve" | "deny";
};

type Props = {
  requestId: string;
  proposal: SafeChatProposal | null;
  toolName: string;
  status: ChatApprovalStatus;
  submittingDecision: ChatApprovalAction["decision"] | null;
  readOnly: boolean;
  onRespond(action: ChatApprovalAction): void;
};

export function ChatApprovalCard(props: Props) {
  const pending = props.status === "pending";
  const disabled =
    !pending || props.readOnly || props.submittingDecision !== null;
  const title =
    (props.proposal?.kind ?? props.toolName) === "applyCategorizations"
      ? "Transaction categorization"
      : "Category change";
  const description =
    props.status === "unavailable"
      ? "This change cannot be safely approved."
      : props.status === "submitting"
        ? "This approval is being submitted."
        : props.status === "failed"
          ? "This approved change could not be applied."
          : props.status === "approved"
            ? "This change was approved."
            : props.status === "denied"
              ? "This change was denied."
              : "Review this exact proposal before it is applied.";

  return (
    <Card className="border-border bg-card" aria-label={`${title} approval`}>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {props.proposal ? (
        <CardContent className="px-3 pb-2">
          <Proposal proposal={props.proposal} />
        </CardContent>
      ) : null}
      {pending || props.status === "unavailable" ? (
        <CardFooter className="justify-end gap-2 p-3 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Deny proposed change"
            onClick={() =>
              props.onRespond({ requestId: props.requestId, decision: "deny" })
            }
          >
            {props.submittingDecision === "deny" ? "Denying…" : "Deny"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled || !props.proposal}
            aria-label="Approve proposed change"
            onClick={() =>
              props.onRespond({
                requestId: props.requestId,
                decision: "approve",
              })
            }
          >
            {props.submittingDecision === "approve" ? "Approving…" : "Approve"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function Proposal({ proposal }: { proposal: SafeChatProposal }) {
  if (proposal.kind === "applyCategorizations") {
    return (
      <div className="space-y-2 text-sm">
        <p>
          {proposal.itemCount === 1
            ? "1 transaction"
            : `${proposal.itemCount} transactions`}
        </p>
        <ul
          className="space-y-2"
          aria-label="Proposed transaction categorizations"
        >
          {proposal.items.map((item, index) => (
            <li
              key={`${item.date}:${item.description}:${index}`}
              className="rounded-md border p-2"
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words text-sm">
                <dt className="text-muted-foreground">Date</dt>
                <dd>{item.date}</dd>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="whitespace-pre-wrap">{item.description}</dd>
                {item.counterpartyName ? (
                  <>
                    <dt className="text-muted-foreground">Counterparty</dt>
                    <dd className="whitespace-pre-wrap">
                      {item.counterpartyName}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Amount</dt>
                <dd>
                  <Currency
                    amount={item.amount}
                    currency={item.currency}
                    className="font-mono"
                  />
                </dd>
                <dt className="text-muted-foreground">Proposed</dt>
                <dd>
                  <CategorizationTarget
                    proposal={item.proposal}
                    currency={item.currency}
                  />
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const operation = proposal.operation;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words text-sm [&_dd]:whitespace-pre-wrap">
      <dt className="text-muted-foreground">Operation</dt>
      <dd>{categoryOperationLabel(operation.kind)}</dd>
      {"currentName" in operation ? (
        <>
          <dt className="text-muted-foreground">Current</dt>
          <dd>{operation.currentName}</dd>
        </>
      ) : null}
      {"newName" in operation ? (
        <>
          <dt className="text-muted-foreground">Name</dt>
          <dd>{operation.newName}</dd>
        </>
      ) : null}
      {"groupName" in operation ? (
        <>
          <dt className="text-muted-foreground">Group</dt>
          <dd>{operation.groupName}</dd>
        </>
      ) : null}
      {"description" in operation ? (
        <>
          <dt className="text-muted-foreground">Description</dt>
          <dd>{operation.description || "None"}</dd>
        </>
      ) : null}
      {"type" in operation ? (
        <>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{operation.type}</dd>
        </>
      ) : null}
    </dl>
  );
}

function CategorizationTarget({
  proposal,
  currency,
}: {
  proposal: Extract<
    SafeChatProposal,
    { kind: "applyCategorizations" }
  >["items"][number]["proposal"];
  currency: string;
}) {
  if (proposal.kind === "category") return proposal.categoryName;
  if (proposal.kind === "transfer")
    return `Transfer to ${proposal.transferAccountName}`;
  return (
    <ul className="space-y-1" aria-label="Proposed split lines">
      {proposal.lines.map((line, index) => (
        <li
          key={`${line.categoryName}:${index}`}
          className="flex flex-wrap justify-between gap-x-3"
        >
          <span>{line.categoryName}</span>
          <Currency
            amount={line.amount}
            currency={currency}
            className="font-mono"
          />
        </li>
      ))}
    </ul>
  );
}

function categoryOperationLabel(
  kind: Extract<
    SafeChatProposal,
    { kind: "manageCategory" }
  >["operation"]["kind"],
) {
  return (
    {
      createGroup: "Create category group",
      updateGroup: "Update category group",
      deleteGroup: "Delete category group",
      createCategory: "Create category",
      updateCategory: "Update category",
      deleteCategory: "Delete category",
    } as const
  )[kind];
}

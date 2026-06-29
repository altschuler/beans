import {WorkflowTrace} from '@/components/flue/workflow-trace'

export type CategorizationWorkflowTraceProps = {
  flueRunId?: string | null
}

export function CategorizationWorkflowTrace({flueRunId}: CategorizationWorkflowTraceProps) {
  return (
    <WorkflowTrace
      flueRunId={flueRunId}
      title="AI workflow trace"
      description="Team-level trace for the active categorization workflow."
      pendingMessage="Preparing AI categorization trace…"
      ariaLabel="AI workflow trace"
    />
  )
}

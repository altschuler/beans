import {Button} from '@/components/ui/button'

export function DeleteSection({title, description, disabled, onDelete}: {title: string; description: string; disabled: boolean; onDelete?: () => void}) {
  return (
    <div className="rounded-md border border-destructive/30 p-3">
      <div className="text-sm font-semibold text-destructive">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <Button type="button" variant="destructive" className="mt-3" disabled={disabled} onClick={onDelete}>
        {title}
      </Button>
    </div>
  )
}

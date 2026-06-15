import {useState} from 'react'
import {useQuery, useZero} from '@rocicorp/zero/react'
import {Button} from '@/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'

export function ItemsPanel() {
  const zero = useZero()
  const [items] = useQuery(queries.items.list())
  const [title, setTitle] = useState('First synced item')

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      return
    }

    await zero.mutate(
      mutators.items.create({
        id: crypto.randomUUID(),
        title: trimmedTitle,
        createdAt: new Date().toISOString(),
      }),
    )
    setTitle('')
  }

  async function renameItem(id: string, currentTitle: string) {
    await zero.mutate(
      mutators.items.update({
        id,
        title: `${currentTitle} updated`,
        updatedAt: new Date().toISOString(),
      }),
    )
  }

  async function deleteItem(id: string) {
    await zero.mutate(mutators.items.delete({id}))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zero sync smoke test</CardTitle>
        <CardDescription>Create, update, and delete a per-user demo item.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createItem}>
          <div className="flex-1 space-y-2">
            <Label htmlFor="item-title">Item title</Label>
            <Input
              id="item-title"
              data-testid="item-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Add a demo item"
            />
          </div>
          <Button data-testid="create-item" type="submit">
            Create item
          </Button>
        </form>

        <div data-testid="items-list" className="space-y-3">
          {items.length === 0 ? (
            <p data-testid="items-empty" className="text-sm text-muted-foreground">
              No synced items yet.
            </p>
          ) : (
            items.map(item => (
              <div key={item.id} data-testid="item-row" className="flex items-center justify-between rounded-md border p-3">
                <span>{item.title}</span>
                <div className="flex gap-2">
                  <Button
                    data-testid="update-item"
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => renameItem(item.id, item.title)}
                  >
                    Update
                  </Button>
                  <Button
                    data-testid="delete-item"
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteItem(item.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

import {useState} from 'react'
import {useFlueAgent} from '@flue/react'
import {MessageScroller} from '@shadcn/react/message-scroller'
import {MessageCircle, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Textarea} from '@/components/ui/textarea'
import {Sheet, SheetContent, SheetTitle, SheetDescription} from '@/components/ui/sheet'
import {useIsMobile} from '@/hooks/use-mobile'

export function ChatSidebar() {
  const [open, setOpen] = useState(false)
  const mobile = useIsMobile()
  return (
    <>
      {!open && (
        <Button variant="outline" className="fixed right-4 bottom-4 z-20 shadow-md" onClick={() => setOpen(true)}>
          <MessageCircle />
          Mock chat
        </Button>
      )}
      {mobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="w-full gap-0 sm:max-w-sm" showCloseButton={false}>
            <SheetTitle className="sr-only">Mock chat</SheetTitle>
            <SheetDescription className="sr-only">Private mock conversation in your personal workspace</SheetDescription>
            <Chat onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : (
        open && (
          <aside aria-label="Mock chat" className="h-svh w-96 shrink-0 border-l bg-background">
            <Chat onClose={() => setOpen(false)} />
          </aside>
        )
      )}
    </>
  )
}

function Chat({onClose}: {onClose: () => void}) {
  const agent = useFlueAgent({url: '/api/chat/current'})
  const [input, setInput] = useState('')
  const busy = agent.status === 'submitted' || agent.status === 'streaming'
  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">Mock chat</h2>
          <p className="text-xs text-muted-foreground">Private · Personal workspace</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close chat" onClick={onClose}>
          <X />
        </Button>
      </header>
      <p className="border-b bg-muted/40 p-3 text-xs text-muted-foreground">
        Demo only: deterministic model mock, real Flue runtime and local sandbox. No AI provider calls or financial actions.
      </p>
      <MessageScroller.Provider autoScroll defaultScrollPosition="end">
        <MessageScroller.Root className="min-h-0 flex-1">
          <MessageScroller.Viewport className="h-full overflow-y-auto">
            <MessageScroller.Content className="space-y-4 p-4" aria-live="polite">
              {!agent.historyReady && !agent.error && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
              {agent.historyReady && agent.messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Send a message to run the fixed sandbox check. Your conversation is saved here.
                </p>
              )}
              {agent.messages
                .filter(message => message.display === 'visible' && message.role !== 'system')
                .map(message => (
                  <MessageScroller.Item key={message.id} messageId={message.id}>
                    <article className="space-y-1 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">{message.role === 'user' ? 'You' : 'Mock assistant'}</p>
                      {message.parts.map((part, index) =>
                        part.type === 'text' ? (
                          <p key={index} className="whitespace-pre-wrap break-words">
                            {part.text}
                          </p>
                        ) : part.type === 'dynamic-tool' ? (
                          <p key={index} className="text-xs text-muted-foreground">
                            Fixed sandbox check
                            {part.state === 'output-available' ? ' complete' : '…'}
                          </p>
                        ) : null,
                      )}
                      {agent.failedSends.some(send => send.id === message.id) && (
                        <p className="text-xs text-destructive">Not sent. Your message is still in the input below.</p>
                      )}
                    </article>
                  </MessageScroller.Item>
                ))}
            </MessageScroller.Content>
          </MessageScroller.Viewport>
        </MessageScroller.Root>
      </MessageScroller.Provider>
      <div className="space-y-2 border-t p-3">
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            Running mock sandbox check…
          </p>
        )}
        {agent.error && (
          <div role="alert" className="text-sm text-destructive">
            Chat could not connect or finish.{' '}
            <Button variant="ghost" onClick={() => agent.refresh()}>
              Reconnect
            </Button>
          </div>
        )}
        <form
          className="space-y-2"
          onSubmit={async event => {
            event.preventDefault()
            const message = input.trim()
            if (!message || busy) return
            setInput('')
            try {
              await agent.sendMessage(message)
            } catch {
              setInput(message)
            }
          }}
        >
          <Textarea
            aria-label="Message"
            placeholder="Try the mock sandbox check…"
            maxLength={4000}
            value={input}
            onChange={event => setInput(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={!input.trim() || busy || !agent.historyReady || agent.status === 'connecting'}>
            Send
          </Button>
        </form>
      </div>
    </section>
  )
}

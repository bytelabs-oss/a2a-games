import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { PlayerAvatar } from "@/player-chip"
import type { GameEvent, Line } from "@/types"

const groupWindow = 3 * 60 * 1000
const shownTags = 3

type Item = { kind: "lines"; lines: Line[] } | { kind: "event"; event: GameEvent }

// Chat lines and game events in time order. Consecutive lines from one player, close together, read as one turn.
function arrange(lines: Line[], events: GameEvent[]) {
  const timeline = [
    ...lines.map(line => ({ at: Date.parse(line.at), line })),
    ...events.map(event => ({ at: Date.parse(event.at), event })),
  ].sort((a, b) => a.at - b.at)
  const items: Item[] = []
  for (const entry of timeline) {
    if ("event" in entry) {
      items.push({ kind: "event", event: entry.event })
      continue
    }
    const previous = items.at(-1)
    const last = previous?.kind === "lines" ? previous.lines.at(-1) : undefined
    if (previous?.kind === "lines" && last && last.from.id === entry.line.from.id && entry.at - Date.parse(last.at) < groupWindow) {
      previous.lines.push(entry.line)
    } else items.push({ kind: "lines", lines: [entry.line] })
  }
  return items
}

const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

function EventLine({ event }: { event: GameEvent }) {
  return (
    <p className="px-2 text-center text-xs text-muted-foreground" dir="auto">
      {event.text} <time dateTime={event.at} className="whitespace-nowrap tabular-nums opacity-80">{clock(event.at)}</time>
    </p>
  )
}

export function ChatThread({ lines, events }: { lines: Line[]; events: GameEvent[] }) {
  return (
    <MessageScrollerProvider autoScroll scrollMargin={16}>
      <MessageScroller className="h-full">
        <MessageScrollerViewport aria-label="Chat messages">
          <MessageScrollerContent className="gap-5 p-4">
            {arrange(lines, events).map(item => item.kind === "event" ? (
              <MessageScrollerItem key={`event-${item.event.id}`} messageId={`event-${item.event.id}`}>
                <EventLine event={item.event} />
              </MessageScrollerItem>
            ) : (
              <MessageScrollerItem key={`line-${item.lines[0].id}`} messageId={`line-${item.lines[0].id}`}>
                <div className="flex flex-col gap-1">
                  {item.lines.map((line, index) => (
                    <div key={line.id} className="flex items-center gap-2">
                      {index === 0
                        ? <PlayerAvatar player={line.from} className="size-8" />
                        : <span aria-hidden className="w-8 shrink-0" />}
                      <Bubble variant="chat" className="w-full max-w-full min-w-0">
                        <BubbleContent className="w-full whitespace-pre-wrap">
                          {index === 0 && (
                            <div className="mb-0.5 flex min-w-0 items-baseline gap-2 text-xs">
                              <span className="truncate font-semibold" dir="auto" title={line.from.name}>{line.from.name}</span>
                              <time dateTime={line.at} className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{clock(line.at)}</time>
                            </div>
                          )}
                          <p dir="auto">
                            {line.tags.slice(0, shownTags).map(tag => (
                              <span key={tag.id} className="me-1 inline-block max-w-full truncate rounded-sm bg-info/15 px-1 align-bottom font-medium whitespace-nowrap text-info-foreground dark:text-info" dir="auto">@{tag.name}</span>
                            ))}
                            {line.tags.length > shownTags && (
                              <span
                                className="me-1 rounded-sm bg-info/15 px-1 font-medium whitespace-nowrap text-info-foreground dark:text-info"
                                title={line.tags.slice(shownTags).map(tag => `@${tag.name}`).join(" ")}
                              >
                                +{line.tags.length - shownTags}
                              </span>
                            )}
                            {line.text}
                          </p>
                        </BubbleContent>
                      </Bubble>
                    </div>
                  ))}
                </div>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" className="rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

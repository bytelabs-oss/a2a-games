import { useEffect, useRef, useState } from "react"
import type { GameEvent, Line, Snapshot } from "@/types"

export type Connection = "connecting" | "live" | "lost"

function merge<T extends { id: number }>(current: T[], incoming: T[]) {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

// Live listeners: each new chat line and event, as it arrives, and each sound to play.
export type Listeners = { sound: (name: string) => void; chat: (line: Line) => void; event: (event: GameEvent) => void }

export function useShell(listeners: Listeners) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [events, setEvents] = useState<GameEvent[]>([])
  const [connection, setConnection] = useState<Connection>("connecting")
  const listen = useRef(listeners)
  listen.current = listeners

  useEffect(() => {
    const stream = new EventSource("/events")
    stream.addEventListener("open", async () => {
      setConnection("live")
      const [chat, log] = await Promise.all([fetch("/read?since=0"), fetch("/log?since=0")])
      if (chat.ok) {
        const { lines: history } = await chat.json()
        setLines(current => merge(current, history))
      }
      if (log.ok) {
        const { events: history } = await log.json()
        setEvents(current => merge(current, history))
      }
    })
    stream.addEventListener("state", event => setSnapshot(JSON.parse(event.data)))
    stream.addEventListener("chat", event => {
      const line: Line = JSON.parse(event.data)
      setLines(current => merge(current, [line]))
      listen.current.chat(line)
    })
    stream.addEventListener("event", event => {
      const item: GameEvent = JSON.parse(event.data)
      setEvents(current => merge(current, [item]))
      listen.current.event(item)
    })
    stream.addEventListener("sound", event => listen.current.sound(JSON.parse(event.data).name))
    stream.addEventListener("error", () => setConnection("lost"))
    return () => stream.close()
  }, [])

  return { snapshot, lines, events, connection }
}

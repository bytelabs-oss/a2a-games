import { useEffect, useRef, useState, type RefObject } from "react"
import type { GameEvent, GameSettingValues, GameStatus, Line, Player } from "@/types"

type SceneContext = {
  view: unknown
  status: GameStatus | null
  players: Player[]
  settings: GameSettingValues
  play: (name: string) => void
}
export type Mounted = {
  update?: (next: Omit<SceneContext, "play">) => void
  chat?: (line: Line) => void
  event?: (event: GameEvent) => void
  unmount?: () => void
}
type Mount = (element: HTMLElement, context: SceneContext) => Mounted | void

// `mounted` holds what the scene's mount returned, so the page can pass it live chat lines and events.
export function Scene({ src, view, status, players, settings, play, mounted }: { src: string; mounted: RefObject<Mounted | null> } & SceneContext) {
  const element = useRef<HTMLDivElement>(null)
  const latest = useRef({ view, status, players, settings, play })
  latest.current = { view, status, players, settings, play }
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    import(/* @vite-ignore */ src)
      .then(({ default: mount }: { default: Mount }) => {
        if (cancelled || !element.current) return
        mounted.current = mount(element.current, latest.current) || {}
      })
      .catch(reason => setError(String(reason)))
    return () => {
      cancelled = true
      mounted.current?.unmount?.()
      mounted.current = null
      element.current?.replaceChildren()
    }
  }, [src])

  useEffect(() => {
    mounted.current?.update?.({ view, status, players, settings })
  }, [view, status, players, settings])

  if (error) return <p className="m-auto max-w-md p-6 text-sm text-destructive">The game scene failed to load: {error}</p>
  return <div ref={element} className="relative size-full" />
}

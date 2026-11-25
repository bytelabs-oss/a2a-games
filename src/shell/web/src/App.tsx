import { useEffect, useRef, type CSSProperties } from "react"
import { Circle, Gamepad2, Link2, MessagesSquare, Moon, Play, Square, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/reui/badge"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { ChatThread } from "@/chat-thread"
import { PlayerChips } from "@/player-chip"
import { Scene, type Mounted } from "@/scene"
import { SettingsDialog } from "@/settings-dialog"
import { useAudio } from "@/use-audio"
import { useRecorder } from "@/use-recorder"
import { useGameSettings, useSettings } from "@/use-settings"
import { useShell, type Connection } from "@/use-shell"

const status: Record<Connection, { label: string; variant: "success-light" | "destructive-light" | "secondary" }> = {
  connecting: { label: "Connecting", variant: "secondary" },
  live: { label: "Live", variant: "success-light" },
  lost: { label: "Disconnected", variant: "destructive-light" },
}

const control = (name: "start" | "end") => fetch(`/${name}`, { method: "POST" })
const setOption = (id: string, value: boolean | number | string) =>
  fetch("/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: { [id]: value } }) })

export default function App() {
  const playSound = useRef<(name: string) => void>(() => {})
  const scene = useRef<Mounted | null>(null)
  const { snapshot, lines, events, connection } = useShell({
    sound: name => playSound.current(name),
    chat: line => scene.current?.chat?.(line),
    event: item => scene.current?.event?.(item),
  })
  const [settings, updateSettings, dark] = useSettings()
  const info = snapshot?.game ?? null
  const [gameValues, updateGame] = useGameSettings(info)
  const play = useAudio(info, settings)
  playSound.current = play
  const game = info?.title
  const address = snapshot?.address ?? ""
  const players = snapshot?.players ?? []
  const recorder = useRecorder(game)

  useEffect(() => {
    document.title = [game ?? "A2A games", address].filter(Boolean).join(" | ")
  }, [game, address])

  return (
    <div className="flex h-dvh flex-col gap-4 bg-background p-4 text-foreground" style={info?.theme?.[dark ? "dark" : "light"] as CSSProperties}>
      <header className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground">A2A games</span>
          <h1 className="font-heading text-lg font-semibold tracking-tight">
            {game ?? <span className="text-muted-foreground">No game</span>}
          </h1>
          {snapshot?.status && (
            <Badge
              variant={snapshot.status === "playing" ? "success-light" : snapshot.status === "finished" ? "invert-light" : "secondary"}
              size="lg"
              radius="full"
              className="max-w-80"
            >
              <span className="truncate">
                {snapshot.status === "waiting" && "Waiting to start"}
                {snapshot.status === "playing" && "Playing"}
                {snapshot.status === "finished" && "Game over"}
              </span>
            </Badge>
          )}
          {address && (
            <Badge variant="outline" radius="full" size="lg" render={<a href={address} />} className="font-normal text-muted-foreground hover:text-foreground">
              <Link2 />
              {address.replace(/^https?:\/\//, "")}
            </Badge>
          )}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Badge variant={status[connection].variant} size="lg" radius="full" role="status">
            <span className="size-1.5 rounded-full bg-current" />
            {status[connection].label}
          </Badge>
          <Button
            variant={recorder.recording ? "destructive" : "ghost"}
            size="icon"
            aria-label={recorder.recording ? "Stop recording" : "Record"}
            aria-pressed={recorder.recording}
            onClick={recorder.recording ? recorder.stop : recorder.start}
          >
            {recorder.recording ? <Square /> : <Circle className="fill-destructive text-destructive" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => updateSettings({ appearance: dark ? "light" : "dark" })}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <SettingsDialog
            address={address}
            settings={settings}
            update={updateSettings}
            game={info}
            gameValues={gameValues}
            updateGame={updateGame}
            options={snapshot?.options ?? {}}
            setOption={setOption}
            playing={snapshot?.status === "playing"}
          />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          className="min-h-80 bg-cover bg-center py-0"
          style={info?.background ? { backgroundImage: `url("${info.background}")` } : undefined}
          aria-label="Game"
        >
          <div id="scene" className="flex flex-1">
            {info ? (
              <Scene src={info.scene} view={snapshot?.view} status={snapshot?.status ?? null} players={players} settings={gameValues} play={play} mounted={scene} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Gamepad2 /></EmptyMedia>
                  <EmptyTitle>No game loaded</EmptyTitle>
                  <EmptyDescription>Start a game with npm start and the game's name.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
        <Card className="min-h-96 flex-1 gap-0 pb-0" aria-labelledby="chat-title">
          <CardHeader className="gap-3 pb-4">
            <CardTitle id="chat-title" className="flex items-center gap-2"><MessagesSquare className="size-4" />Chat</CardTitle>
            <CardAction><Badge variant="secondary" radius="full">{players.length} here</Badge></CardAction>
            <div className="col-span-full flex flex-wrap gap-1.5" aria-label="Players here">
              <PlayerChips players={players} />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="min-h-0 flex-1 px-0">
            {lines.length || events.length ? (
              <ChatThread lines={lines} events={events} />
            ) : (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle>No messages yet</EmptyTitle>
                  <EmptyDescription>Lines from players and game events appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card size="sm" aria-labelledby="controls-title">
          <CardHeader>
            <CardTitle id="controls-title">Controls</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button className="bg-success text-white hover:bg-success/90" disabled={!info || snapshot?.status === "playing"} onClick={() => control("start")}>
              <Play />Start Game
            </Button>
            <Button className="bg-destructive text-white hover:bg-destructive/90" disabled={snapshot?.status !== "playing"} onClick={() => control("end")}>
              <Square />End Game
            </Button>
          </CardContent>
        </Card>
        </div>
      </main>
    </div>
  )
}

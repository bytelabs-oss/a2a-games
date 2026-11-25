import { Badge } from "@/components/reui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Player } from "@/types"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function hue(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

// The first letter of the name, so "🦊 Fox" gives "F"; a name with no letters keeps its first whole character.
function initial(name: string) {
  const parts = [...graphemes.segment(name.trim())].map(part => part.segment)
  return (parts.find(part => /\p{L}/u.test(part)) ?? parts[0] ?? "?").toLocaleUpperCase()
}

export function PlayerAvatar({ player, className }: { player: Player; className?: string }) {
  const h = hue(player.id)
  return (
    <Avatar className={cn("shrink-0", className)}>
      <AvatarFallback
        className="text-[0.65rem] font-semibold"
        style={{ background: `oklch(0.42 0.12 ${h})`, color: `oklch(0.95 0.03 ${h})` }}
      >
        {initial(player.name)}
      </AvatarFallback>
    </Avatar>
  )
}

// Green is ready, yellow is connected but not ready, grey is disconnected.
function presence(player: Player) {
  if (!player.connected) return { label: "Disconnected", color: "bg-muted-foreground/50" }
  if (player.ready) return { label: "Ready", color: "bg-success" }
  return { label: "Not ready", color: "bg-warning" }
}

export function PlayerChip({ player, className }: { player: Player; className?: string }) {
  const { label, color } = presence(player)
  return (
    <Badge variant="outline" radius="full" size="lg" className={cn("relative max-w-48 overflow-visible ps-0.5", className)} title={`${player.name}: ${label}`}>
      <PlayerAvatar player={player} className="size-4" />
      <span className="truncate" dir="auto">{player.name}</span>
      <span className={cn("absolute -end-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background", color)} role="img" aria-label={label} />
    </Badge>
  )
}

const shown = 6

export function PlayerChips({ players }: { players: Player[] }) {
  if (!players.length) return <span className="text-sm text-muted-foreground">Nobody here yet</span>
  const rest = players.length - shown
  return (
    <>
      {players.slice(0, shown).map(player => <PlayerChip key={player.id} player={player} />)}
      {rest > 0 && (
        <Popover>
          <PopoverTrigger render={<Badge variant="secondary" radius="full" size="lg" render={<button type="button" />} />}>
            +{rest} more
          </PopoverTrigger>
          <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <div className="flex flex-wrap gap-1.5">
              {players.map(player => <PlayerChip key={player.id} player={player} />)}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}

import { useState } from "react"
import { Check, Copy, Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { GameInfo, GameSetting, GameSettingValues } from "@/types"
import type { Appearance, Settings } from "@/use-settings"

const appearances = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function Toggle({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="min-w-0 leading-snug [overflow-wrap:anywhere]">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="shrink-0" />
    </div>
  )
}

function Range({ label, value, onChange, disabled, min = 0, max = 100, step = 1, unit = "" }: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={label}
        value={[value]}
        onValueChange={next => onChange(Array.isArray(next) ? next[0] : next)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
      />
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{value}{unit}</span>
    </div>
  )
}

// A sound setting is off and cannot be changed when the game has nothing to play for it.
function Volume({ id, label, on, volume, onToggle, onVolume, available }: {
  id: string
  label: string
  on: boolean
  volume: number
  onToggle: (on: boolean) => void
  onVolume: (volume: number) => void
  available: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <Toggle id={id} label={label} checked={available && on} onChange={onToggle} disabled={!available} />
      <Range label={`${label} volume`} value={volume} onChange={onVolume} disabled={!available || !on} unit="%" />
    </div>
  )
}

export function GameControl({ setting, value, onChange, disabled }: {
  setting: GameSetting
  value: boolean | number | string | undefined
  onChange: (value: boolean | number | string) => void
  disabled?: boolean
}) {
  const id = `game-${setting.id}`
  if (setting.type === "switch") return <Toggle id={id} label={setting.label} checked={Boolean(value ?? setting.default)} onChange={onChange} disabled={disabled} />
  if (setting.type === "slider") {
    return (
      <div className="flex flex-col gap-3">
        <Label className="leading-snug [overflow-wrap:anywhere]">{setting.label}</Label>
        <Range label={setting.label} value={Number(value ?? setting.default)} onChange={onChange} min={setting.min} max={setting.max} step={setting.step} disabled={disabled} />
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="min-w-0 leading-snug [overflow-wrap:anywhere]">{setting.label}</Label>
      <Select items={setting.options} value={String(value ?? setting.default)} onValueChange={next => next !== null && onChange(next)} disabled={disabled}>
        <SelectTrigger className="w-40 shrink-0 [&>span]:truncate" aria-label={setting.label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {setting.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function General({ address, settings, update, game }: { address: string; settings: Settings; update: (change: Partial<Settings>) => void; game: GameInfo | null }) {
  const hasMusic = Boolean(game?.music)
  const hasSounds = Object.keys(game?.sounds ?? {}).length > 0
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <Label>Appearance</Label>
        <Select
          items={appearances}
          value={settings.appearance}
          onValueChange={appearance => appearance && update({ appearance: appearance as Appearance })}
        >
          <SelectTrigger className="min-w-36" aria-label="Appearance"><SelectValue /></SelectTrigger>
          <SelectContent>
            {appearances.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <Volume
        id="music"
        label="Music"
        on={settings.music}
        volume={settings.musicVolume}
        onToggle={music => update({ music })}
        onVolume={musicVolume => update({ musicVolume })}
        available={hasMusic}
      />
      <Volume
        id="sounds"
        label="Sound effects"
        on={settings.sounds}
        volume={settings.soundsVolume}
        onToggle={sounds => update({ sounds })}
        onVolume={soundsVolume => update({ soundsVolume })}
        available={hasSounds}
      />
      <Separator />
      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Game address</Label>
        <div className="flex gap-2">
          <Input id="address" value={address} readOnly onFocus={event => event.target.select()} />
          <Button variant="outline" size="icon" onClick={copy} aria-label="Copy address">
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
    </div>
  )
}

// The Game tab holds the game's options, which apply to the whole game and are set before it starts, and its own
// settings for this page.
export function SettingsDialog({ address, settings, update, game, gameValues, updateGame, options, setOption, playing }: {
  address: string
  settings: Settings
  update: (change: Partial<Settings>) => void
  game: GameInfo | null
  gameValues: GameSettingValues
  updateGame: (change: GameSettingValues) => void
  options: GameSettingValues
  setOption: (id: string, value: boolean | number | string) => void
  playing: boolean
}) {
  const general = <General address={address} settings={settings} update={update} game={game} />
  const gameSettings = game?.settings ?? []
  const gameOptions = game?.options ?? []

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Settings" />}>
        <SettingsIcon />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved in this browser.</DialogDescription>
        </DialogHeader>
        {(gameSettings.length || gameOptions.length) && game ? (
          <Tabs defaultValue="general" className="gap-5">
            <TabsList className="w-full">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="game">Game</TabsTrigger>
            </TabsList>
            <TabsContent value="general">{general}</TabsContent>
            <TabsContent value="game" className="flex flex-col gap-5">
              {gameOptions.map(option => (
                <GameControl
                  key={option.id}
                  setting={option}
                  value={options[option.id]}
                  onChange={value => setOption(option.id, value)}
                  disabled={playing}
                />
              ))}
              {gameSettings.map(setting => (
                <GameControl
                  key={setting.id}
                  setting={setting}
                  value={gameValues[setting.id]}
                  onChange={value => updateGame({ [setting.id]: value })}
                />
              ))}
            </TabsContent>
          </Tabs>
        ) : general}
      </DialogContent>
    </Dialog>
  )
}

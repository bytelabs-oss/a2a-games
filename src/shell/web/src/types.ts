export type Player = { id: string; name: string; ready?: boolean; connected?: boolean }

export type Line = {
  id: number
  from: Player
  text: string
  to: string[]
  tags: Player[]
  at: string
}

export type GameSetting =
  | { id: string; label: string; type: "switch"; default: boolean }
  | { id: string; label: string; type: "slider"; default: number; min?: number; max?: number; step?: number }
  | { id: string; label: string; type: "choice"; default: string; options: { value: string; label: string }[] }

export type GameSettingValues = Record<string, boolean | number | string>

export type GameInfo = {
  title: string
  theme: { light?: Record<string, string>; dark?: Record<string, string> } | null
  options: GameSetting[]
  settings: GameSetting[]
  background: string | null
  music: string | null
  sounds: Record<string, string>
  scene: string
}

export type GameEvent = { id: number; text: string; by: string | null; at: string; headline?: true; to?: string[]; data?: unknown }

export type GameStatus = "waiting" | "playing" | "finished"

export type Snapshot = {
  game: GameInfo | null
  status: GameStatus | null
  options: GameSettingValues
  players: Player[]
  view: unknown
  address: string
}

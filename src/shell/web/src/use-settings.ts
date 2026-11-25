import { useEffect, useState } from "react"
import type { GameInfo, GameSettingValues } from "@/types"

export type Appearance = "system" | "light" | "dark"

export type Settings = {
  appearance: Appearance
  music: boolean
  musicVolume: number
  sounds: boolean
  soundsVolume: number
}

const key = "a2a-games-settings"
const defaults: Settings = { appearance: "system", music: true, musicVolume: 60, sounds: true, soundsVolume: 80 }

function load<T extends object>(storageKey: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") }
  } catch {
    return fallback
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(() => load(key, defaults))
  const [dark, setDark] = useState(true)
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(settings))
  }, [settings])
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const isDark = settings.appearance === "dark" || (settings.appearance === "system" && query.matches)
      document.documentElement.classList.toggle("dark", isDark)
      setDark(isDark)
    }
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [settings.appearance])
  const update = (change: Partial<Settings>) => setSettings(current => ({ ...current, ...change }))
  return [settings, update, dark] as const
}

export function useGameSettings(game: GameInfo | null) {
  const storageKey = game ? `${key}:${game.title}` : null
  const defaultsFor = () => Object.fromEntries((game?.settings ?? []).map(setting => [setting.id, setting.default])) as GameSettingValues
  const [values, setValues] = useState<GameSettingValues>({})
  useEffect(() => {
    setValues(storageKey ? load(storageKey, defaultsFor()) : {})
    // The game's settings list only changes when a different game loads.
  }, [storageKey])
  const update = (change: GameSettingValues) =>
    setValues(current => {
      const next = { ...current, ...change }
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  return [values, update] as const
}

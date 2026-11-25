import { useCallback, useEffect, useRef } from "react"
import type { GameInfo } from "@/types"
import type { Settings } from "@/use-settings"

export function useAudio(game: GameInfo | null, settings: Settings) {
  const music = useRef<HTMLAudioElement | null>(null)
  const current = useRef(settings)
  current.current = settings

  useEffect(() => {
    if (!game?.music) return
    const audio = new Audio(game.music)
    audio.loop = true
    music.current = audio
    return () => {
      audio.pause()
      music.current = null
    }
  }, [game?.music])

  useEffect(() => {
    const audio = music.current
    if (!audio) return
    audio.volume = settings.musicVolume / 100
    if (settings.music) {
      // Browsers block audio until the person interacts with the page; retry on the first click.
      const start = () => audio.play().catch(() => {})
      start()
      window.addEventListener("pointerdown", start, { once: true })
      return () => window.removeEventListener("pointerdown", start)
    }
    audio.pause()
  }, [settings.music, settings.musicVolume, game?.music])

  return useCallback((name: string) => {
    const file = game?.sounds[name]
    if (!file || !current.current.sounds) return
    const audio = new Audio(file)
    audio.volume = current.current.soundsVolume / 100
    audio.play().catch(() => {})
  }, [game])
}

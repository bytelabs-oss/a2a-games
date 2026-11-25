import { useCallback, useRef, useState } from "react"

const mimeType = "video/webm;codecs=vp9,opus"
// Highest rate the tab is drawn at; the browser sends fewer frames when less changes.
const frameRate = 60
// A one-second slice keeps a long recording from building up as one block in memory.
const sliceMs = 1000

/** Records this tab, picture and sound, and saves it as a webm named for the game and the instant recording began. */
export function useRecorder(game: string | undefined) {
  const recorder = useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = useState(false)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions)
    const startedAt = new Date().toISOString()
    const parts: Blob[] = []
    const media = new MediaRecorder(stream, { mimeType })
    media.ondataavailable = event => parts.push(event.data)
    media.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      const link = document.createElement("a")
      link.href = URL.createObjectURL(new Blob(parts, { type: "video/webm" }))
      link.download = `${(game ?? "game").toLowerCase().replace(/\W+/g, "-")}-${startedAt.replaceAll(":", "-")}.webm`
      link.click()
      URL.revokeObjectURL(link.href)
      recorder.current = null
      setRecording(false)
    }
    // Stopping the share from the browser's own bar ends the recording too.
    stream.getVideoTracks()[0].addEventListener("ended", () => media.state !== "inactive" && media.stop())
    media.start(sliceMs)
    recorder.current = media
    setRecording(true)
  }, [game])

  const stop = useCallback(() => recorder.current?.stop(), [])

  return { recording, start, stop }
}

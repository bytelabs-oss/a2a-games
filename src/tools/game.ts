import { EventSourceParserStream } from "eventsource-parser/stream";
import type { GameEvent } from "./turn.ts";

export class ToolError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// What the game answers; each route's fields are as README.md's HTTP API lists them.
export type Answer = Record<string, unknown> & { events?: GameEvent[] };

interface Session {
  address: string;
  controller: AbortController;
  key?: string;
  player?: { id: string; name: string };
}

// One player's connection to one game server. The shell shows the player as connected
// while the /events stream is open. Only /leave removes the player.
export class GameSession {
  current: (Session & { player: { id: string; name: string } }) | null = null;
  joining: Promise<Answer> | null = null;
  // Called with each game event from the stream and this player's id.
  onEvent: (event: GameEvent, me: string) => void = () => {};

  async request(session: Session, path: string, body?: object, signal?: AbortSignal): Promise<Answer> {
    const headers: Record<string, string> = {};
    if (session.key) headers.Authorization = `Bearer ${session.key}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${session.address}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: "error",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new ToolError("cancelled", `The /${path} request was cancelled or the game connection closed.`);
      throw new ToolError("unreachable", `Could not reach the game at ${session.address}.`);
    }
    const data = (await response.json().catch(() => ({}))) as Answer;
    if (!response.ok) throw new ToolError("game_error", typeof data.error === "string" ? data.error : `The game answered HTTP ${response.status}.`, response.status);
    return data;
  }

  // Tool calls may run in parallel. Only joining needs a guard: one player per session,
  // and a leave that arrives mid-join applies once the join settles.
  join(args: { address: string; name: string }, signal?: AbortSignal) {
    if (this.current || this.joining) throw new ToolError("already_joined", "Leave the current game before joining another.");
    this.joining = this.connect(args, signal).finally(() => {
      this.joining = null;
    });
    return this.joining;
  }

  async connect({ address, name }: { address: string; name: string }, signal?: AbortSignal) {
    const url = new URL(address);
    const session: Session = { address: url.origin + url.pathname.replace(/\/$/, ""), controller: new AbortController() };
    const { key, ...joined } = await this.request(session, "join", { name }, signal);
    const player = joined.player as { id: string; name: string };
    const current = { ...session, key: key as string, player };
    this.current = current;
    try {
      await this.open(current, signal);
      return joined;
    } catch {
      this.current = null;
      current.controller.abort();
      await this.request(current, "leave", {}).catch(() => {});
      throw new ToolError("presence_failed", "The game did not open the presence connection.");
    }
  }

  async open(session: Session & { player: { id: string } }, signal?: AbortSignal) {
    const response = await fetch(`${session.address}/events`, {
      headers: { Authorization: `Bearer ${session.key}` },
      signal: signal ? AbortSignal.any([session.controller.signal, signal]) : session.controller.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) throw new Error();
    response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeTo(new WritableStream({ write: ({ event, data }) => { if (event === "event") this.onEvent(JSON.parse(data), session.player.id); } }))
      .catch(() => {})
      .finally(() => this.reopen(session));
  }

  // A stream that drops while this session is still in the game is reopened.
  // If it can't be, the session is forgotten.
  reopen(session: Session & { player: { id: string } }) {
    if (this.current !== session) return;
    this.open(session).catch(() => {
      if (this.current === session) this.current = null;
    });
  }

  call(path: string, body: object | undefined, signal: AbortSignal) {
    const session = this.current;
    if (!session) throw new ToolError("not_joined", "Join a game first.");
    return this.request(session, path, body, AbortSignal.any([session.controller.signal, signal]));
  }

  async leave(signal?: AbortSignal) {
    await this.joining?.catch(() => {});
    const session = this.current;
    if (!session) return { ok: true };
    this.current = null;
    try {
      return await this.request(session, "leave", {}, signal);
    } finally {
      session.controller.abort();
    }
  }
}

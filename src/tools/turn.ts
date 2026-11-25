// When the agent hears of game events: after each tool the session is told of events it has
// not been given, and an idle session is woken once for each new set of announcements. Game events never hold a turn.

// A game event as the shell records it: by is the id of the player whose move caused it.
export interface GameEvent {
  id: number;
  text: string;
  by: string | null;
  // An announcement of the game's, and a reply to this player's own steps: the events an idle session is woken for.
  headline?: true;
  reply?: true;
}

// A session is idle once its turn-end hook let it stop, or after two minutes without a tool call, since an
// interrupted turn never reports its end.
const QUIET_MS = 2 * 60 * 1000;
let lastActive = 0;
let turnOver = false;
let given = 0;
let unseen: GameEvent[] = [];
let knocked = "";
// Events handed over after the session's latest tool call. If that call ended the turn, as Copilot's task_complete
// does, the agent never read them, so the turn's end hands them over again by waking the session.
let lastHanded: GameEvent[] = [];

export function active() {
  lastActive = Date.now();
  turnOver = false;
  lastHanded = [];
}

export function ended() {
  turnOver = true;
  if (!lastHanded.length) return;
  unseen = [...lastHanded, ...unseen.filter((event) => !lastHanded.includes(event))];
  lastHanded = [];
  knocked = "";
}

// Events a hook handed over after a tool call: given, and handed over again at the turn's end when that tool ends it.
export function handed(events: GameEvent[], endsTurn: boolean) {
  gave(events);
  lastHanded = endsTurn ? events : [];
}

export function reset() {
  given = 0;
  unseen = [];
  knocked = "";
  lastHanded = [];
}

// An event from the game's stream. The player's own events reach it in its act result.
export function heard(event: GameEvent, me: string) {
  if (event.by !== me && event.id > given) unseen.push(event);
}

// Events the agent has been given, in a tool result or by a hook.
export function gave(events: GameEvent[]) {
  for (const { id } of events) given = Math.max(given, id);
  unseen = unseen.filter((event) => event.id > given);
}

export const waiting = () => unseen.length > 0;

// Wakes an idle session with the announcements and replies it has not been given. Other events wait for its next tool
// call. Active is set before knocking, so the same set is knocked for once.
export function watch(knock: (announced: GameEvent[]) => void) {
  setInterval(() => {
    const announced = unseen.filter((event) => event.headline || event.reply);
    const ids = announced.map((event) => event.id).join();
    const idle = turnOver || Date.now() - lastActive > QUIET_MS;
    if (!ids || !idle || ids === knocked) return;
    knocked = ids;
    active();
    knock(announced);
  }, 1000).unref();
}

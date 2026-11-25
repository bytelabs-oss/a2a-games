// The game interface README.md documents: what a game exports for the shell to run it, and what its hooks return.
// State is the game's own; the shell only holds it and hands it back.

export interface PlayerRef {
  id: string;
  name: string;
}

// An event a hook reports: a public sentence, or one marked as a headline, limited to some players' agents, or carrying
// data, the game's own details of what happened for its scene and agents.
export type EventEntry = string | { text: string; headline?: boolean; to?: string[]; data?: unknown };

// What a hook returns. ok: false refuses a join, a start or a step, with message saying why.
export interface Outcome {
  ok?: boolean;
  message?: string;
  events?: EventEntry[];
  sound?: string;
}

// A setting's value: on or off, a number, or a choice's value.
export type SettingValue = boolean | number | string;

export interface Setting {
  id: string;
  label: string;
  type: 'switch' | 'slider' | 'choice';
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface Game<State = unknown> {
  title: string;
  rules?: string;
  actions?: { name: string; description: string }[];
  create(): State;
  join?(state: State, player: PlayerRef): Outcome | null | void;
  leave?(state: State, player: PlayerRef): Outcome | null | void;
  ready?(state: State, player: PlayerRef): Outcome | null | void;
  // options holds the value of each of the game's options.
  start?(state: State, options: Record<string, SettingValue>): Outcome | null | void;
  end?(state: State): Outcome | null | void;
  // A step that takes time returns a promise, which the shell waits for before the next step, while the player is
  // already answered.
  act(state: State, player: PlayerRef, step: string): Outcome | null | void | Promise<Outcome | null | void>;
  // Ends the player's step under way where it is, settling its promise, when they stop.
  stop?(state: State, player: PlayerRef): void;
  view(state: State, playerId: string | null): unknown;
  tick?(state: State, seconds: number): Outcome | null | void;
  tickSeconds?: number;
  // Choices about the game itself, made on the page before it starts and the same for everyone.
  options?: Setting[];
  // Choices about how one viewer's page shows the game.
  settings?: Setting[];
  theme?: { light?: Record<string, string>; dark?: Record<string, string> };
  background?: string;
  music?: string;
  sounds?: Record<string, string>;
  scene?: string;
}

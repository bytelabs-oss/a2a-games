// The page's view of Bomb, which game.ts builds and the scene draws, and what the shell gives a scene. Types only;
// they are erased before the code runs.

export type Module = 'wires' | 'symbols' | 'gauges';
// The manual's pages: one per module, and the index that says which letter's rules apply.
export type Page = Module | 'index';
export type WireColor = 'red' | 'blue' | 'yellow' | 'white' | 'black' | 'green';
export type Symbol = 'star' | 'moon' | 'sun' | 'eye' | 'key' | 'crown' | 'anchor' | 'bell' | 'feather' | 'flame' | 'droplet' | 'snowflake';

export interface Bomb {
  serial: string;
  batteries: number;
  // When the bomb goes off, in epoch milliseconds; null while it is not counting down.
  endsAt: number | null;
  // Seconds left when the clock stopped, shown once endsAt is null.
  left: number;
  strikes: number;
  maxStrikes: number;
  wires: { colors: WireColor[]; cut: boolean[]; solved: boolean };
  // pressed is how many of the four have been pressed in the right order so far.
  symbols: { shown: Symbol[]; pressed: number; solved: boolean };
  gauges: { readings: number[]; solved: boolean };
}

export interface PageView {
  phase: 'lobby' | 'armed' | 'defused' | 'exploded';
  defuser: { id: string; name: string } | null;
  experts: { id: string; name: string; pages: Page[] }[];
  // null until the bomb is armed.
  bomb: Bomb | null;
  bar: { text: string };
}

export interface Player {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface SceneContext {
  view: PageView | null;
  status: 'waiting' | 'playing' | 'finished' | null;
  players: Player[];
  settings: Record<string, unknown>;
  play?: (name: string) => void;
}

export interface ChatLine {
  from: { id: string; name: string };
  text: string;
}

export interface GameEvent {
  text: string;
  headline?: boolean;
}

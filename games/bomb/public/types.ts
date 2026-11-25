// The page's view of Bomb, which game.ts builds and the scene draws, and what the shell gives a scene. Types only;
// they are erased before the code runs.
import type { Page, Role, Symbol, WireColor } from '../rules.ts';

export type { Page, Role, Symbol, WireColor };

// The bomb as the page draws it. endsAt is when it goes off, in epoch milliseconds, while it counts down; left is the
// seconds left once it has stopped.
export interface Bomb {
  serial: string;
  batteries: number;
  endsAt: number | null;
  left: number;
  strikes: number;
  maxStrikes: number;
  wires: { colors: WireColor[]; cut: boolean[]; solved: boolean };
  // pressed is how many of the buttons have been pressed in the right order so far.
  symbols: { shown: Symbol[]; pressed: number; solved: boolean };
  gauges: { readings: number[]; solved: boolean };
}

export interface PageView {
  phase: 'lobby' | 'armed' | 'defused' | 'exploded';
  // role is null until the roles are dealt; pages are an expert's share of the manual.
  players: { id: string; name: string; role: Role | null; pages: Page[] }[];
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

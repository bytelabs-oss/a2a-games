// The page's view of Mafia, which game.ts builds and the scene draws, and what the shell gives a scene. Types only;
// they are erased before the code runs.
import type { Role } from '../rules.ts';
import type { PlayerRef } from '../../../src/shell/types.ts';

export interface PageView {
  day: number;
  // The page only needs day or night, for its lighting and the sun or moon.
  phase: 'day' | 'night';
  narrator: PlayerRef | null;
  // In seat order. role is null until the roles are dealt.
  players: { id: string; name: string; role: Role | null; eliminated: boolean }[];
  // The status line over the table, and when its timer runs out, in epoch milliseconds.
  bar: { text: string; endsAt?: number | null };
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

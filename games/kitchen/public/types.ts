// The kitchen's types: the places and names of things, the events, and the views built from the game's state. What the
// things themselves are lives in things.ts. Types only; they are erased before the code runs.
import type { dishes } from './kitchen.ts';
import type { models } from './layout.ts';
import type { CrateKind, ItemKind, ItemView, PlateableKind } from './things.ts';
import type { SoundName } from './kitchen.ts';

export type Seconds = number;
// A cell of the floor plan: x across from the left, y down from the back wall.
export interface Cell {
  x: number;
  y: number;
}
export type Direction = 'down' | 'up' | 'left' | 'right';

// Stations stand in the world and never move; chefs work at them. Scenery is the rest of the room and the dining room.
export type StationKind = 'counter' | 'board' | 'stove' | 'delivery' | 'sink' | 'plates' | 'bin' | 'extinguisher_hook' | 'crate';
export type SceneryKind = 'floor' | 'wall' | 'window' | 'orderWindow' | 'diningFloor' | 'diningTable' | 'chair';

// The steps a chef keeps at for a while.
export type StepName = 'cut' | 'wash' | 'spray' | 'shoo';
export type DishName = keyof typeof dishes;
export type ModelName = keyof typeof models;

// A station's place in the floor plan, with the direction of the floor in front of it. A piece with no floor beside
// it, such as a corner counter, is part of the room but not a station.
export interface Piece extends Cell {
  kind: StationKind;
  // The food a crate gives.
  food?: CrateKind;
  facing: Direction;
  reachable: boolean;
}
export interface Place extends Piece {
  id: string;
}

// How service runs: a new order every `every` seconds while fewer than `open` are open, each missed order losing
// `missedPenalty` points, for the number of minutes the game's option sets.
export interface ServiceRules {
  orders: { every: Seconds; open: number; missedPenalty: number };
  minutes: { default: number; min: number; max: number };
  // A rat climbs onto a station with food every so often: the game's option sets the seconds between rats on average,
  // and each gap is random within `spread` of that, as a share of it.
  rats: { default: Seconds; min: Seconds; max: Seconds; spread: number };
}

// How fast chefs walk, in cells a second, and the cell each seat starts on. There are as many seats as start cells.
export interface ChefRules {
  speed: number;
  starts: Cell[];
}

export interface DishRules {
  name: string;
  // The ready foods on its plate.
  foods: PlateableKind[];
  points: number;
  // How long an order for the dish stays open.
  seconds: Seconds;
}

// An order is open for its dish's seconds, and expires when none are left.
export interface Order {
  id: string;
  dish: DishName;
  seconds: Seconds;
  left: Seconds;
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────

// What can happen in the kitchen, with the details the scene and the chefs need. station is the id of the station it
// happened at; chef is the name of the chef who did it.
export type KitchenEvent =
  | { type: 'serviceStarted' }
  | { type: 'serviceEnded'; score: number; stars: number }
  | { type: 'orderPlaced'; order: string; dish: DishName }
  | { type: 'orderServed'; order: string; dish: DishName; station: string; chef: string; points: number }
  | { type: 'orderMissed'; order: string; dish: DishName; penalty: number }
  | { type: 'fireStarted'; station: string }
  | { type: 'fireSpread'; from: string; station: string }
  | { type: 'fireOut'; station: string; chef: string }
  | { type: 'ratArrived'; station: string }
  | { type: 'ratShooed'; station: string; chef: string }
  | { type: 'ratAte'; station: string }
  | { type: 'foodCooked'; station: string; food: ItemKind }
  | { type: 'foodBurnt'; station: string; food: ItemKind };
export type KitchenEventType = KitchenEvent['type'];

// How each type of event is announced: its sentence, and whether it shows as a banner.
export type EventRules = {
  [Type in KitchenEventType]: { headline: boolean; text: (event: Extract<KitchenEvent, { type: Type }>) => string; sound?: SoundName };
};

// ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Phase = 'lobby' | 'service' | 'over';

export interface ChefView extends Cell {
  id: string;
  name: string;
  seat: number;
  facing: Direction;
  // The step the chef is working at, if any.
  working: StepName | null;
  // The station the chef is at, which no other chef can be at.
  at: string | null;
  hands: ItemView[];
}

// How far something at a station has gone toward what comes next: fill when the view was made, growing by `rate` a
// second while it moves on, and whether what comes next is bad.
export interface ProgressView {
  fill: number;
  rate: number;
  warning: boolean;
}

// What is on a station: the items on it or a stack of plates, any fire or rat, and how far what happens there has gone.
// The game also gives the station's cell, for chefs to plan walks by; the scene places stations from the floor plan.
export interface StationView extends Cell {
  items?: ItemView[];
  stack?: { kind: 'Plate' | 'DirtyPlate'; count: number };
  fire?: true;
  rat?: true;
  progress?: ProgressView;
}

// The page's view, which the scene draws. A chef's view is the same, with `you`.
export interface PageView {
  phase: Phase;
  score?: number;
  // The seconds of service left.
  left?: Seconds;
  orders?: Order[];
  chefs?: ChefView[];
  stations?: Record<string, StationView>;
}

export interface ChefOwnView extends PageView {
  you: ChefView;
}

// What the shell gives a scene, as README.md describes.
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
  // The game's own details: a KitchenEvent for the kitchen's events.
  data?: unknown;
}

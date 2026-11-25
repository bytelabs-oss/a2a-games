// The kitchen's layout and menu: the floor plan and its stations, the dishes, how service runs, and how each event is
// announced. What the things in it are lives in things.ts. The rules play with these and the scene draws them, so both
// import this file.
import type {
  ChefRules, Direction, DishRules, EventRules, KitchenEvent, Piece, Place, ServiceRules, StationKind,
} from './types.ts';
import { article, words, type CrateKind } from './things.ts';

// One character per cell, rows from the back wall to the front. '.' is floor; other characters are in tiles or crates.
export const floorPlan: readonly string[] = [
  '#BBF#FPP##',
  'l........S',
  't........E',
  'h..###...D',
  'o........#',
  'b........#',
  'm........X',
];

export const tiles: Partial<Record<string, StationKind>> = { '#': 'counter', B: 'board', F: 'stove', P: 'delivery', S: 'sink', D: 'plates', X: 'bin', E: 'extinguisher_hook' };
export const crates: Partial<Record<string, CrateKind>> = { l: 'Lettuce', t: 'Tomato', h: 'Cheese', o: 'Onion', b: 'Bun', m: 'Steak' };

// Grid steps, in the order a station looks for the floor it is worked from: the camera side first.
export const directions: Record<Direction, readonly [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const directionNames = Object.keys(directions) as Direction[];

const isFloor = (x: number, y: number) => floorPlan[y]?.[x] === '.';

// Every counter, station and crate in the plan, with the direction of the floor in front of it. A piece with no
// floor beside it, such as a corner, is part of the room but not a station.
export const pieces: Piece[] = floorPlan.flatMap((row, y) => [...row].flatMap((tile, x) => {
  const food = crates[tile];
  const kind = tiles[tile] ?? (food ? 'crate' : null);
  if (!kind) return [];
  const facing = directionNames.find(name => isFloor(x + directions[name][0], y + directions[name][1]));
  return [{ kind, food, x, y, facing: facing ?? 'down', reachable: Boolean(facing) }];
}));

// The stations chefs work at, each with an id: its kind, or its food for a crate, numbered when there are several.
const reachable = pieces.filter(piece => piece.reachable);
const baseName = (piece: Piece) => (piece.food ? `${piece.food.toLowerCase()}_crate` : piece.kind);
export const stations: Place[] = reachable.map(piece => {
  const same = reachable.filter(other => baseName(other) === baseName(piece));
  return { ...piece, id: same.length > 1 ? `${baseName(piece)}_${same.indexOf(piece) + 1}` : baseName(piece) };
});

// Each dish on the menu.
export const dishes = {
  salad: { name: 'Salad', foods: ['CutLettuce', 'CutTomato', 'CutOnion'], points: 20, seconds: 180 },
  burger: { name: 'Burger', foods: ['Bun', 'CookedPatty', 'CutLettuce'], points: 30, seconds: 270 },
  cheeseburger: { name: 'Cheeseburger', foods: ['Bun', 'CookedPatty', 'CutCheese'], points: 30, seconds: 270 },
  deluxe: { name: 'Deluxe burger', foods: ['Bun', 'CookedPatty', 'CutCheese', 'CutLettuce', 'CutTomato'], points: 50, seconds: 330 },
  onionburger: { name: 'Onion burger', foods: ['Bun', 'CookedPatty', 'CutOnion'], points: 30, seconds: 270 },
} satisfies Record<string, DishRules>;

export const service: ServiceRules = {
  orders: { every: 30, open: 3, missedPenalty: 10 },
  minutes: { default: 5, min: 2, max: 10 },
  rats: { default: 45, min: 15, max: 120, spread: 1 / 3 },
};

// The kitchen owns this many plates.
export const plateCount = 4;

export const chefRules: ChefRules = { speed: 2, starts: [{ x: 2, y: 5 }, { x: 4, y: 5 }, { x: 6, y: 5 }, { x: 8, y: 5 }] };

// The scores for one, two and three stars.
export const starScores: readonly number[] = [100, 220, 360];

// The music that loops through the game, and each sound by what it sounds like: files in public/, with their packs'
// licenses beside them.
export const music = 'audio/loop-town/loopcity.ogg';
export const sounds = {
  bell: 'audio/kenney-impact-sounds/impactBell_heavy_000.ogg',
  clang: 'audio/kenney-impact-sounds/impactMetal_heavy_000.ogg',
  cheer: 'audio/kenney-interface-sounds/confirmation_002.ogg',
  buzz: 'audio/kenney-interface-sounds/error_006.ogg',
  scratch: 'audio/kenney-interface-sounds/scratch_002.ogg',
  pan: 'audio/kenney-rpg-audio/metalPot1.ogg',
} as const;
export type SoundName = keyof typeof sounds;

// How each type of event is announced to every chef and the page, and the sound it makes. Sentences say what happened,
// never what to do.
export const events: EventRules = {
  serviceStarted: { headline: true, text: () => 'Service starts.', sound: 'bell' },
  serviceEnded: { headline: true, text: ({ score, stars }) => `Service is over: ${score} points, ${stars} of ${starScores.length} stars.`, sound: 'bell' },
  orderPlaced: { headline: false, text: ({ order, dish }) => `Order ${order}: ${dishes[dish].name}.`, sound: 'bell' },
  orderServed: { headline: true, text: ({ chef, dish, points }) => `${chef} served the ${dishes[dish].name}. +${points}`, sound: 'cheer' },
  orderMissed: { headline: true, text: ({ order, dish, penalty }) => `Order ${order} for the ${dishes[dish].name} ran out. -${penalty}`, sound: 'buzz' },
  fireStarted: { headline: true, text: ({ station }) => `Fire at ${station}!`, sound: 'clang' },
  fireSpread: { headline: true, text: ({ from, station }) => `The fire spread from ${from} to ${station}!` },
  fireOut: { headline: false, text: ({ chef, station }) => `${chef} put out the fire at ${station}.` },
  ratArrived: { headline: true, text: ({ station }) => `A rat climbed onto ${station}.`, sound: 'scratch' },
  ratShooed: { headline: false, text: ({ chef, station }) => `${chef} shooed the rat off ${station}.` },
  ratAte: { headline: true, text: ({ station }) => `The rat ate the food on ${station}.` },
  foodCooked: { headline: false, text: ({ food, station }) => `The ${words(food)} on ${station} is ready.`, sound: 'pan' },
  foodBurnt: { headline: true, text: ({ food, station }) => `The food on ${station} burnt: it is ${article(words(food))}.` },
};

// The shell event for a kitchen event: its sentence, whether it is a banner, and the event itself as its data.
export function announce(event: KitchenEvent) {
  // The table's entry for an event's type takes events of that type.
  const rule = events[event.type] as { headline: boolean; text: (event: KitchenEvent) => string };
  return { text: rule.text(event), headline: rule.headline, data: event };
}

// The sound for what happened: the first of the events that makes one. The shell plays one sound per update.
export function soundOf(happened: KitchenEvent[]): SoundName | undefined {
  return happened.map(event => events[event.type].sound).find(sound => sound !== undefined);
}

// Whether an event's data is a kitchen event.
export const isKitchenEvent = (data: unknown): data is KitchenEvent =>
  typeof data === 'object' && data !== null && 'type' in data && typeof data.type === 'string' && Object.hasOwn(events, data.type);


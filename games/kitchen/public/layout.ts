// Everything the kitchen scene places, and where. The scene reads this; it holds no layout numbers of its own.
import * as THREE from 'three';
import { chefRules } from './kitchen.ts';
import type { Direction, KitchenEventType, ModelName, SceneryKind, StationKind, StepName } from './types.ts';
import type { CrateKind, ItemKind, PlateableKind } from './things.ts';

// A point or size in the scene, [x, y, z].
type Vec3 = readonly [number, number, number];

// Every model the scene loads, by name, as a path under models/.
export const models = {
  barbarian: 'adventurers/Barbarian.glb',
  knight: 'adventurers/Knight.glb',
  mage: 'adventurers/Mage.glb',
  rogue: 'adventurers/Rogue_Hooded.glb',
  floor: 'dungeon/floor_tile_small.gltf.glb',
  wall: 'restaurant/wall.gltf',
  wallWindow: 'restaurant/wall_window_closed.gltf',
  orderWindow: 'restaurant/wall_orderwindow.gltf',
  counter: 'restaurant/kitchencounter_straight_A.gltf',
  drawers: 'restaurant/kitchencounter_straight_B.gltf',
  sink: 'restaurant/kitchencounter_sink.gltf',
  stove: 'restaurant/stove_single.gltf',
  pan: 'restaurant/pan_A.gltf',
  board: 'restaurant/cuttingboard.gltf',
  knife: 'restaurant/knife.gltf',
  lettuceCrate: 'restaurant/crate_lettuce.gltf',
  tomatoCrate: 'restaurant/crate_tomatoes.gltf',
  cheeseCrate: 'restaurant/crate_cheese.gltf',
  onionCrate: 'restaurant/crate_onions.gltf',
  bunCrate: 'restaurant/crate_buns.gltf',
  steakCrate: 'restaurant/crate_steak.gltf',
  plate: 'restaurant/plate.gltf',
  dirtyPlate: 'restaurant/plate_dirty.gltf',
  lettuce: 'restaurant/food_ingredient_lettuce.gltf',
  lettuceSlice: 'restaurant/food_ingredient_lettuce_slice.gltf',
  tomato: 'restaurant/food_ingredient_tomato.gltf',
  tomatoSlice: 'restaurant/food_ingredient_tomato_slice.gltf',
  cheese: 'restaurant/food_ingredient_cheese.gltf',
  cheeseSlice: 'restaurant/food_ingredient_cheese_slice.gltf',
  onion: 'restaurant/food_ingredient_onion.gltf',
  onionRings: 'restaurant/food_ingredient_onion_rings.gltf',
  bun: 'restaurant/food_ingredient_bun.gltf',
  bunBottom: 'restaurant/food_ingredient_bun_bottom.gltf',
  bunTop: 'restaurant/food_ingredient_bun_top.gltf',
  steak: 'restaurant/food_ingredient_steak.gltf',
  patty: 'restaurant/food_ingredient_burger_uncooked.gltf',
  pattyCooked: 'restaurant/food_ingredient_burger_cooked.gltf',
  pattyBurnt: 'restaurant/food_ingredient_burger_trash.gltf',
  woodFloor: 'dungeon/floor_wood_large.gltf.glb',
  table: 'restaurant/table_round_A_decorated.gltf',
  chair: 'restaurant/chair_A.gltf',
  bin: 'restaurant/crate.gltf',
} satisfies Record<string, string>;

// The pack is built on a two-unit grid: a counter or a floor tile fills one cell, a wall piece two.
export const grid = { cell: 2, wallPiece: 4 };

// The room: walls along the back and both sides, open toward the camera like a cutaway. The back wall's pieces run
// left to right, two cells each; the order window stands behind the delivery belt. The side walls cover sideRows rows.
// The model for each kind of scenery.
export const sceneryModels: Record<SceneryKind, ModelName> = {
  floor: 'floor',
  wall: 'wall',
  window: 'wallWindow',
  orderWindow: 'orderWindow',
  diningFloor: 'woodFloor',
  diningTable: 'table',
  chair: 'chair',
};

export const room: { backWall: readonly SceneryKind[]; sideRows: number } = {
  backWall: ['wall', 'window', 'wall', 'orderWindow', 'wall'],
  sideRows: 6,
};

// The dining room around the kitchen: a wooden floor of four-unit tiles reaching floorReach from the centre, just
// below the kitchen floor, and round tables, each at [x, z] with a chair on either side, chairDistance away.
export const dining: { floorReach: number; floorLevel: number; tables: readonly (readonly [number, number])[]; chairDistance: number } = {
  floorReach: 32,
  floorLevel: -0.06,
  tables: [[-15, -2], [-15, 5], [15, -2], [15, 5], [-9, 12], [0, 12], [9, 12]],
  chairDistance: 2.1,
};

// The delivery belt: one dark belt across the delivery counters, inset from their edges, with one row of gold
// chevrons, arrowsDeep of them, running toward the order window under a sign on the back wall. One chevron spans the
// belt's width on a canvas of arrowCanvas pixels, lineWidth thick. The sign's text is drawn in the overlay's font on
// a canvas of canvasSize pixels.
export const delivery = {
  belt: { inset: 0.1, height: 0.08, base: 1, color: '#35323d', arrow: '#f7c843', arrowsDeep: 2, arrowCanvas: [256, 64], lineWidth: 12, speed: 0.5 },
  sign: { text: 'DELIVER', color: '#c64f38', textColor: '#fffaf2', font: '600 62px Fredoka', canvasSize: [512, 128], size: [3.2, 0.8, 0.12], height: 3.5 },
} as const;

// How each kind of station is built: its model, any tools on it as [model, x, y, z, turn], and the height food sits at.
// A crate's model is its food's.
interface StationLook {
  model?: ModelName;
  tools?: readonly (readonly [ModelName, number, number, number, number])[];
  top: number;
  mat?: boolean;
}
export const stationLooks: Record<StationKind, StationLook> = {
  counter: { model: 'counter', top: 1 },
  // Plates on the delivery counters ride on the belt.
  delivery: { model: 'counter', top: delivery.belt.base + delivery.belt.height },
  plates: { model: 'counter', top: 1 },
  board: { model: 'drawers', tools: [['board', 0, 1, 0, 0], ['knife', 0.62, 1.15, 0.1, Math.PI / 2]], top: 1.15 },
  // The pan sits centred on the burner with its handle to the side; food cooks on the pan's floor.
  stove: { model: 'stove', tools: [['pan', 0, 1.21, 0, Math.PI / 2]], top: 1.25 },
  sink: { model: 'sink', top: 1 },
  // The bin is the pack's empty crate; what goes in it is gone.
  bin: { model: 'bin', top: 0.8 },
  // The extinguisher hangs on a counter with a red mat; it stands on the mat.
  extinguisher_hook: { model: 'counter', top: 1.025, mat: true },
  crate: { top: 1 },
};

// While food cooks on a stove it sizzles, hopping this high this fast.
export const sizzle = { height: 0.05, speed: 18 };

// The turn that faces a piece or a chef toward each grid direction; the models face +z.
export const turns: Record<Direction, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };

// The model for each kind of item the packs have. The extinguisher is built from shapes (props.ts).
export const itemModels: Record<Exclude<ItemKind, 'Extinguisher'>, ModelName> = {
  Lettuce: 'lettuce', CutLettuce: 'lettuceSlice',
  Tomato: 'tomato', CutTomato: 'tomatoSlice',
  Cheese: 'cheese', CutCheese: 'cheeseSlice',
  Onion: 'onion', CutOnion: 'onionRings',
  Bun: 'bun',
  Steak: 'steak', Patty: 'patty', CookedPatty: 'pattyCooked', BurntPatty: 'pattyBurnt',
  Plate: 'plate', DirtyPlate: 'dirtyPlate',
};

// The model for each crate, by the food it gives.
export const crateModels: Record<CrateKind, ModelName> = {
  Lettuce: 'lettuceCrate', Tomato: 'tomatoCrate', Cheese: 'cheeseCrate', Onion: 'onionCrate', Bun: 'bunCrate', Steak: 'steakCrate',
};

// Food on its own, on a station or in a chef's hands, is scaled down to fit this footprint, so a whole lettuce sits
// on a counter or in a pan the same size as a tomato. Food on a plate is sized by plating instead.
export const looseFoodSize = 0.75;

// A plate's food stacks from the bottom in this order, each layer on the one below. A bun opens around the rest.
export const plating: { layers: readonly { food: PlateableKind; model?: ModelName }[]; base: number; scale: number } = {
  layers: [
    { food: 'Bun', model: 'bunBottom' },
    { food: 'CookedPatty' },
    { food: 'CutCheese' },
    { food: 'CutOnion' },
    { food: 'CutTomato' },
    { food: 'CutLettuce' },
    { food: 'Bun', model: 'bunTop' },
  ],
  // The plate's rim is this high; food on a plate is shown at this scale.
  base: 0.06,
  scale: 0.85,
};

// Where a stack of plates stands, and each plate a plate's height, step, above the last: clean ones on the plates
// counter, dirty ones in the sink's basin. at is [x, y, z] from the middle of the station's top; the basin's floor is
// 0.3 below the counter top.
export const plateStacks: { at: Record<'Plate' | 'DirtyPlate', Vec3>; step: number } = {
  at: { Plate: [0, 0, 0], DirtyPlate: [0, -0.3, -0.11] },
  step: 0.1,
};

// Chefs, by seat, and how they move. The character models carry weapons, shields and capes; a chef shows none.
export const chefs = {
  characters: ['barbarian', 'knight', 'mage', 'rogue'],
  // Each seat's colour, for the ring at the chef's feet and their name tag.
  colors: ['#e4572e', '#3a86ff', '#2bb39a', '#e56fb5'],
  ring: { inner: 0.45, outer: 0.6, lift: 0.02 },
  // Every chef wears a white chef's hat on their head bone: a band, and a puff squashed to a dome on top of it.
  hat: { color: '#fffaf2', band: { radius: 0.36, height: 0.32 }, puff: { radius: 0.5, squash: 0.75 }, lift: 0.55 },
  gear: {
    barbarian: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Cape', 'Barbarian_Hat'],
    knight: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Knight_Helmet', 'Knight_Cape'],
    mage: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
    rogue: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Rogue_Cape'],
  },
  scale: 1.05,
  // Walking speed in units a second, the rules' cells a second across a cell's width, and how long one clip blends into
  // the next.
  speed: chefRules.speed * grid.cell,
  blend: 0.2,
  // What a chef holds is carried in front of them, at this point in their own space and at this scale.
  // More than one item in hand stands each `gap` above the last.
  carry: { at: new THREE.Vector3(0, 0.95, 0.75), scale: 0.6, gap: 0.5 },
  // A chef cutting holds the pack's knife in their right hand: the pack's handslot.r bone, whose dot three.js drops.
  knife: { slot: 'handslotr', turn: Math.PI, scale: 0.8 },
  // The pack's clip for each thing a chef does. Every chef starts its loop at a different point.
  clips: { idle: 'Idle', walk: 'Walking_A', cheer: 'Cheer' },
  // The clip a chef plays while working at each step.
  working: { cut: '1H_Melee_Attack_Chop', wash: 'Interact', spray: 'Interact', shoo: 'Interact' } satisfies Record<StepName, string>,
  // Names and bubbles sit this far above each head bone, in model units.
  headroom: 1.1,
} as const;

// Flames over a burning station: three cones, orange, yellow, orange, that flicker together in height.
export const flames = {
  cones: [[-0.4, 0.65, '#f07830'], [0, 0.95, '#f7c843'], [0.4, 0.65, '#f07830']],
  radius: 0.32,
  height: 1.5,
  lift: 0.1,
  flicker: { speed: 12, amount: 0.12 },
} as const;

// The word that pops up over the station an event happened at, starting lift above its top.
export const toasts: { words: Partial<Record<KitchenEventType, string>>; lift: number } = {
  words: { fireStarted: 'fire!', fireSpread: 'fire!', ratArrived: 'rat!', ratAte: 'eaten!' },
  lift: 0.6,
};

// What no pack has, built from simple shapes as the original kitchen built them. Positions are [x, y, z].
export const props = {
  // A grey rat with pink ears, nose and tail, sitting at `at` from the middle of the station's top, turned by
  // `turn`, nibbling: hopping `nibble.height` at `nibble.speed`.
  rat: {
    at: [0.45, 0, 0.3],
    turn: -0.8,
    grey: '#7d7686',
    pink: '#f2a7b8',
    body: { radius: 0.28, scale: [1, 0.8, 1.5], at: [0, 0.22, 0] },
    head: { radius: 0.17, at: [0, 0.3, 0.42] },
    ears: { radius: 0.08, at: [[-0.1, 0.45, 0.4], [0.1, 0.45, 0.4]] },
    nose: { radius: 0.04, at: [0, 0.3, 0.6] },
    tail: { radii: [0.02, 0.03], length: 0.7, at: [0, 0.15, -0.6], tilt: Math.PI / 2.6 },
    nibble: { speed: 12, height: 0.05 },
  },
  // A red bottle with a black cap and nozzle.
  extinguisher: {
    red: '#d62828',
    dark: '#2b2830',
    bottle: { radius: 0.22, height: 0.7 },
    cap: { radii: [0.1, 0.12], height: 0.15, at: [0, 0.78, 0] },
    nozzle: { size: [0.35, 0.07, 0.07], at: [0.15, 0.86, 0] },
  },
  // The red mat the extinguisher stands on.
  mat: { size: [1.2, 0.05, 1.2], color: '#e4572e', at: [0, 1, 0] },
  // Soap foam filling the sink's basin while a plate is washed: white clumps at [x, y, z, radius] from the middle of
  // the sink's top, bobbing bob.height at bob.speed, and a bubble rising from each of the first rising.count clumps,
  // rising.height up at rising.speed and shrinking away as it goes.
  foam: {
    color: '#ffffff',
    opacity: 0.9,
    clumps: [[-0.4, 0, -0.35, 0.2], [0.1, 0.03, -0.4, 0.24], [0.42, 0, -0.2, 0.2], [-0.15, 0.04, -0.05, 0.25], [0.3, 0.02, 0.2, 0.2], [-0.45, 0, 0.2, 0.18], [0, 0, 0.3, 0.17]],
    bob: { height: 0.03, speed: 3 },
    rising: { count: 4, radius: 0.08, height: 1.2, speed: 0.5 },
  },
} as const;

// A station's progress bar sits this high above the top it holds food on.
export const progressHeight = 1;

// The pictures on the order tickets: each dish and each ingredient rendered once, this many pixels square, seen
// from the house camera's pitch.
export const icons = { size: 160, fieldOfView: 30 };

// Under each ingredient on a ticket, a mark for how it is made: cut or cooked. A food that comes ready has no mark.
export const preparationMarks: Record<'cut' | 'cook', string> = { cut: 'marks/knife.svg', cook: 'marks/pan.svg' };

// Items on one worktop stand this far apart, side by side.
export const itemSpacing = 0.7;

export const lights = {
  sky: { color: '#fff4e6', ground: '#6b5a4a', intensity: 1.6 },
  sun: { color: '#ffe8c8', intensity: 2.2, position: new THREE.Vector3(5, 16, 9), reach: 14, shadowSize: 2048, normalBias: 0.035 },
  background: '#463b4c',
  exposure: 0.95,
};

// The house camera every game uses, with Mafia's values: a front view 35 degrees down through a narrow lens from far
// away, so models keep their shape. frameRadius is how much of the scene around the target stays in frame.
export const houseCamera = {
  fieldOfView: 22,
  pitch: THREE.MathUtils.degToRad(35),
  yaw: 0,
  target: new THREE.Vector3(0, 1.8, -1.6),
  frameRadius: 10.2,
};

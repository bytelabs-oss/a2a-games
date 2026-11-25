// Everything the Mafia scene places, and where. The scene reads this; it holds no layout numbers of its own.
import * as THREE from 'three';

// Every model the scene loads, by name, as a path under models/.
export const models = {
  barbarian: 'adventurers/Barbarian.glb',
  hooded: 'adventurers/Rogue_Hooded.glb',
  knight: 'adventurers/Knight.glb',
  mage: 'adventurers/Mage.glb',
  chair: 'furniture/chair_A_wood.gltf',
  armchair: 'furniture/armchair.gltf',
  rug: 'furniture/rug_oval_A.gltf',
  shelf: 'furniture/shelf_B_large_decorated.gltf',
  lamp: 'furniture/lamp_standing.gltf',
  book: 'furniture/book_single.gltf',
  candles: 'dungeon/candle_triple.gltf.glb',
  table: 'restaurant/table_round_A.gltf',
  wall: 'restaurant/wall.gltf',
  wallWindow: 'restaurant/wall_window_open.gltf',
  wallDoor: 'restaurant/wall_doorway.gltf',
  floor: 'dungeon/floor_wood_large.gltf.glb',
  grass: 'medieval/hex_grass.gltf',
  homeA: 'medieval/building_home_A_red.gltf',
  homeB: 'medieval/building_home_B_red.gltf',
  tavern: 'medieval/building_tavern_red.gltf',
  church: 'medieval/building_church_red.gltf',
  market: 'medieval/building_market_red.gltf',
  well: 'medieval/building_well_red.gltf',
  windmill: 'medieval/building_windmill_red.gltf',
  blacksmith: 'medieval/building_blacksmith_red.gltf',
  treesSmallA: 'medieval/trees_A_small.gltf',
  treesSmallB: 'medieval/trees_B_small.gltf',
  treesMedium: 'medieval/trees_B_medium.gltf',
  treesLarge: 'medieval/trees_A_large.gltf',
  treeA: 'medieval/tree_single_A.gltf',
  treeB: 'medieval/tree_single_B.gltf',
  rockSmall: 'medieval/rock_single_C.gltf',
  rock: 'medieval/rock_single_A.gltf',
  hillSmall: 'medieval/hill_single_A.gltf',
  hill: 'medieval/hills_A_trees.gltf',
} satisfies Record<string, string>;

// The meeting room: walls on three sides, open toward the camera like a cutaway.
export const room = {
  // Wall and floor pieces are four units square.
  piece: 4,
  walls: [
    { facing: 0, kinds: ['wall', 'wallWindow', 'wallDoor', 'wallWindow', 'wall'] },
    { facing: Math.PI / 2, kinds: ['wall', 'wallWindow', 'wall', 'wallWindow', 'wall'] },
    { facing: -Math.PI / 2, kinds: ['wall', 'wallWindow', 'wall', 'wallWindow', 'wall'] },
  ],
  // Furniture against the east half of the room, as [model, x, z, facing]; each piece is mirrored to the west.
  furniture: [['shelf', 6, -9.5, 0], ['lamp', 8.8, -8.8, 0], ['shelf', 9.5, 2, -Math.PI / 2]],
  // The table top is one unit high and 1.5 across in the pack; at this scale, 1.8 high and 2.7 across.
  table: { center: new THREE.Vector3(0, 0, 1.5), scale: 1.8, rugScale: 3.2, top: 1.8 },
  // A candle stands in the middle of the table, and a book lies in front of each seat, this far from the centre.
  centrepiece: { model: 'candles', scale: 1.5 },
  place: { model: 'book', scale: 1.6, radius: 2.1 },
  narrator: { position: new THREE.Vector3(0, 0, -7.5), facing: 0 },
} as const;

// The village around the room: a grass field, and rings of models on the arc facing away from the camera.
export const village = {
  // Just below the room's floor, so the floor sits on the field.
  groundLevel: -0.02,
  groundRadius: 60,
  openArc: THREE.MathUtils.degToRad(120),
  rings: [
    // The hexagon pack is built at board scale; its scale brings it up to the characters' size.
    { radius: 13, scale: 3, models: ['treesSmallA', 'rockSmall', 'treesSmallB', 'hillSmall', 'treesSmallA', 'treesSmallB', 'rockSmall', 'treesSmallA', 'hillSmall', 'treesSmallB', 'rockSmall'] },
    { radius: 17, scale: 4, models: ['homeA', 'blacksmith', 'homeB', 'church', 'tavern', 'market', 'homeA', 'well', 'homeB', 'windmill'] },
    { radius: 27, scale: 4, models: ['treesLarge', 'hill', 'treesMedium', 'treeA', 'rock', 'treesLarge', 'treeB', 'hill', 'treesMedium', 'treeA', 'rock', 'treesLarge'] },
  ],
} as const;

// The sun by day is the moon by night: the same light, cooler and dimmer, while the candle over the table burns brighter.
export const lights = {
  sun: { position: new THREE.Vector3(6, 14, 8), reach: 14, shadowSize: 2048, normalBias: 0.035 },
  candle: { color: '#ffb45c', height: 3.2, distance: 9 },
  day: {
    sky: { color: '#d6e4ee', ground: '#7a6450', intensity: 1.4 },
    sun: { color: '#ffe2b8', intensity: 2.4 },
    candle: 6,
    background: '#a9cde3',
    exposure: 0.9,
  },
  night: {
    sky: { color: '#3a4a78', ground: '#1c1712', intensity: 0.45 },
    sun: { color: '#9fb4ff', intensity: 0.7 },
    candle: 22,
    background: '#141b33',
    exposure: 0.9,
  },
} as const;

// The house camera for every game: a front view 35 degrees down through a narrow lens from far away,
// so models keep their shape. frameRadius is how much of the scene around the target stays in frame.
export const houseCamera = {
  fieldOfView: 22,
  pitch: THREE.MathUtils.degToRad(35),
  yaw: 0,
  target: new THREE.Vector3(0, 1.8, -1.6),
  frameRadius: 10.2,
};

export const seating = {
  radius: 3.7,
  scale: 1.15,
  // The pack's seated clip puts the hips behind the character's origin.
  anchor: new THREE.Vector3(0, 0.02, 0.397),
  // Names and bubbles sit this far above each head bone, in model units.
  headroom: 1.1,
  // The eyes sit this far above the head bone, in model units.
  eyes: 0.45,
  // Everyone plays the pack's seated idle, each from a different point in the loop and at a slightly different
  // speed, so the table never moves in step. Speeds range over 1 ± speedSpread / 2.
  idle: { clip: 'Sit_Chair_Idle', speedSpread: 0.3 },
} as const;

// The character models carry every weapon, shield and cape; an outfit shows only the gear it names.
export const gear = {
  barbarian: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Cape', 'Barbarian_Hat'],
  hooded: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Rogue_Cape'],
  knight: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Knight_Helmet', 'Knight_Cape'],
  mage: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
} as const;

// What each role looks like. A player whose role the page does not know is shown as a villager.
export const outfits = {
  villager: { character: 'barbarian', wear: [] },
  mafia: { character: 'hooded', wear: ['Knife'] },
  detective: { character: 'knight', wear: ['Knight_Helmet'] },
  doctor: { character: 'mage', wear: ['Spellbook_open'] },
  narrator: { character: 'mage', wear: ['Mage_Hat', 'Mage_Cape'] },
} as const;

// An eliminated player lies where their chair stood, in the pack's death pose, faded.
export const eliminated = { clip: 'Death_A_Pose', opacity: 0.35 } as const;

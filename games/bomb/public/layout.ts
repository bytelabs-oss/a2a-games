// Everything the Bomb scene places, and where. The scene reads this; it holds no layout numbers of its own.
import * as THREE from 'three';
import type { Symbol, WireColor } from './types.ts';

// Every model the scene loads, by name, as a path under models/. All KayKit: the bunker from Prototype Bits, the city
// around it from City Builder Bits, the furniture from Furniture Bits and the people from the Adventurers.
export const models = {
  mage: 'adventurers/Mage.glb',
  hooded: 'adventurers/Rogue_Hooded.glb',
  chair: 'furniture/chair_A_wood.gltf',
  book: 'furniture/book_single.gltf',
  floor: 'prototype/Floor.gltf',
  wall: 'prototype/Wall.gltf',
  wallTarget: 'prototype/Wall_Target.gltf',
  wallDecorated: 'prototype/Wall_Decorated.gltf',
  wallWindow: 'prototype/Wall_Window_Closed.gltf',
  wallDoor: 'prototype/Wall_Doorway.gltf',
  door: 'prototype/Door_B.gltf',
  bombTable: 'prototype/table_medium.gltf',
  manualTable: 'restaurant/table_round_A.gltf',
  bombCase: 'prototype/Box_C.gltf',
  boxes: 'prototype/Box_B.gltf',
  box: 'prototype/Box_A.gltf',
  palletLoaded: 'prototype/Pallet_Small_Decorated_A.gltf',
  palletStacked: 'prototype/Pallet_Small_Decorated_B.gltf',
  pavement: 'city/base.gltf',
  buildingA: 'city/building_A.gltf',
  buildingB: 'city/building_B.gltf',
  buildingC: 'city/building_C.gltf',
  buildingD: 'city/building_D.gltf',
  buildingE: 'city/building_E.gltf',
  buildingF: 'city/building_F.gltf',
  buildingG: 'city/building_G.gltf',
  buildingH: 'city/building_H.gltf',
  police: 'city/car_police.gltf',
  sedan: 'city/car_sedan.gltf',
  taxi: 'city/car_taxi.gltf',
  hatchback: 'city/car_hatchback.gltf',
  streetLight: 'city/streetlight.gltf',
  trafficLight: 'city/trafficlight_B.gltf',
  hydrant: 'city/firehydrant.gltf',
  bush: 'city/bush.gltf',
  waterTower: 'city/watertower.gltf',
} satisfies Record<string, string>;

// The bunker: concrete walls on three sides, open toward the camera like a cutaway. Pieces are four units square.
export const bunker = {
  piece: 4,
  walls: [
    { facing: 0, kinds: ['wallTarget', 'wall', 'wallDoor', 'wallDecorated'] },
    { facing: Math.PI / 2, kinds: ['wall', 'wallWindow', 'wall', 'wall'] },
    { facing: -Math.PI / 2, kinds: ['wall', 'wall', 'wallWindow', 'wall'] },
  ],
  // The door stands in the back wall's doorway. The pack's door hangs from its left edge.
  door: new THREE.Vector3(1.2, 0, -7.75),
  // Stores along the walls, as [model, x, z, facing].
  stores: [
    ['palletStacked', -6.5, -6.2, 0], ['palletLoaded', -6.4, -3.8, Math.PI / 2], ['box', -4.6, -6.9, 0.2], ['boxes', -4.3, -6, 0.4],
    ['palletLoaded', 6.4, -6.2, 0], ['box', 4.5, -6.9, -0.3], ['boxes', 6.5, -3.1, 0.3],
  ],
  // The bomb is a case on a work table: the pack's case is 0.8 by 0.4 by 0.6, and at this scale twice that; the defuser stands behind it, facing the camera.
  bomb: { table: new THREE.Vector3(-3.6, 0, 0.6), top: 0.8, caseScale: 2, caseSize: new THREE.Vector3(1.6, 0.8, 1.2), defuser: new THREE.Vector3(-3.6, 0, -0.75) },
  // The experts sit around a round table, as in Mafia, each with a manual in front of them. The table top is one
  // unit high and 1.5 across in the pack; at this scale, 1.5 high and 2.25 across.
  manuals: {
    table: new THREE.Vector3(3.6, 0, -1.4),
    scale: 1.5,
    top: 1.5,
    radius: 2.7,
    book: { radius: 1.6, scale: 1.4 },
  },
} as const;

// The city around the bunker: a pavement field, and rings of models on the arc facing away from the camera. The city
// pack is built at board scale; its scale brings it up to the people's size.
export const city = {
  groundLevel: -0.02,
  groundRadius: 70,
  openArc: THREE.MathUtils.degToRad(120),
  rings: [
    { radius: 12, scale: 4.5, models: ['streetLight', 'police', 'hydrant', 'bush', 'taxi', 'trafficLight', 'police', 'bush', 'sedan', 'streetLight', 'hatchback', 'hydrant'] },
    { radius: 19, scale: 4.5, models: ['buildingA', 'buildingE', 'buildingC', 'buildingH', 'buildingB', 'buildingG', 'buildingD', 'buildingF', 'buildingA', 'buildingC'] },
    { radius: 30, scale: 5, models: ['buildingH', 'buildingG', 'waterTower', 'buildingD', 'buildingC', 'buildingH', 'buildingG', 'waterTower', 'buildingD', 'buildingC', 'buildingH', 'buildingG'] },
  ],
} as const;

// Daylight over the city, and a red alarm light over the bomb that flashes on each strike and pulses in the last
// minute.
export const lights = {
  background: '#a9cde3',
  exposure: 0.95,
  sky: { color: '#d6e4ee', ground: '#6f6a64', intensity: 1.4 },
  sun: { color: '#ffe2b8', intensity: 2.4, position: new THREE.Vector3(6, 14, 8), reach: 14, shadowSize: 2048, normalBias: 0.035 },
  alarm: { color: '#ff2a1a', intensity: 18, distance: 7, height: 2.6, lastSeconds: 60 },
} as const;

// The house camera for every game: a front view 35 degrees down through a narrow lens from far away,
// so models keep their shape. frameRadius is how much of the scene around the target stays in frame.
export const houseCamera = {
  fieldOfView: 22,
  pitch: THREE.MathUtils.degToRad(35),
  yaw: 0,
  target: new THREE.Vector3(0, 1.4, -1.6),
  frameRadius: 9.6,
};

export const people = {
  scale: 1.15,
  // The pack's seated clip puts the hips behind the character's origin.
  seatAnchor: new THREE.Vector3(0, 0.02, 0.397),
  // Names and bubbles sit this far above each head bone, in model units.
  headroom: 1.1,
  // Each person's clip in each phase. Looping clips start at different points so no two move in step; the
  // last-pose clips hold their pose.
  clips: {
    defuser: { lobby: 'Unarmed_Idle', armed: 'Interact', defused: 'Cheer', exploded: 'Death_A_Pose' },
    expert: { lobby: 'Sit_Chair_Idle', armed: 'Sit_Chair_Idle', defused: 'Cheer', exploded: 'Death_B_Pose' },
  },
  speedSpread: 0.3,
  // Every character carries the pack's medieval weapons, hats and capes; none of them is shown.
  gear: {
    hooded: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Rogue_Cape'],
    mage: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
  },
  // Each character's texture is an atlas of 8 by 4 colour swatches, and every part of the model takes its colour
  // from one swatch. An outfit repaints swatches with swatches from any character's atlas, as [[column, row],
  // [character, column, row]], so every colour stays one the pack's artist made.
  // The defuser is the hooded rogue in a hazmat suit: hood, tunic, sleeves and trousers painted yellow, belts and
  // gloves dark. The experts are the mage and the hooded rogue in turn, their robes and cloaks painted lab-coat
  // white. The role icons on their labels say who is who.
  defuser: {
    character: 'hooded',
    wear: [],
    outfit: [
      [[0, 1], ['mage', 0, 3]], [[1, 1], ['mage', 0, 3]], [[3, 0], ['mage', 0, 3]], [[5, 2], ['mage', 0, 3]], [[3, 2], ['mage', 0, 3]],
      [[5, 0], ['hooded', 2, 0]], [[6, 0], ['hooded', 2, 0]],
    ],
  },
  experts: [
    { character: 'mage', wear: [], outfit: [[[0, 1], ['mage', 0, 2]]] },
    { character: 'hooded', wear: [], outfit: [[[0, 1], ['mage', 0, 2]], [[1, 1], ['mage', 0, 2]]] },
    { character: 'mage', wear: [], outfit: [[[0, 1], ['mage', 0, 2]]] },
    { character: 'hooded', wear: [], outfit: [[[0, 1], ['mage', 0, 2]], [[1, 1], ['mage', 0, 2]]] },
  ],
} as const;

// The live bomb face on the case's front: a canvas this many pixels across and high, drawn as the bomb changes.
export const device = { width: 512, height: 256, inset: 0.05, standoff: 0.04 };

// The bomb's face, drawn on the page: the colour of each wire, and each symbol's picture under marks/lucide.
export const wireColors: Record<WireColor, string> = {
  red: '#d8402f', blue: '#3a6fd8', yellow: '#e8c33a', white: '#ece6da', black: '#26221f', green: '#3e9a4c',
};
export const mark = (name: Symbol | 'bomb' | 'book-open') => new URL(`marks/lucide/${name}.svg`, import.meta.url).href;
// Gauge readings run from 0 to 99; the dial's needle sweeps this many degrees either side of straight up.
export const gaugeSweep = 135;

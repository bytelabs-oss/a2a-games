// The parts of the scene that never change: the kitchen floor, walls, counters, stations and crates, and the dining
// room around them.
import * as THREE from 'three';
import { place, type Assets } from './assets.ts';
import { makeMat } from './props.ts';
import { floorPlan, pieces } from './kitchen.ts';
import { grid, room, stationLooks, crateModels, sceneryModels, turns, dining } from './layout.ts';
import type { ModelName } from './types.ts';

const width = floorPlan[0].length;
const depth = floorPlan.length;

// The middle of a grid cell, at floor level. The plan is centred on the origin.
export function cellPosition(x: number, y: number) {
  return new THREE.Vector3((x - (width - 1) / 2) * grid.cell, 0, (y - (depth - 1) / 2) * grid.cell);
}

export function buildWorld(scene: THREE.Scene, assets: Assets) {
  floorPlan.forEach((row, y) => [...row].forEach((_, x) => place(assets, sceneryModels.floor, scene, cellPosition(x, y))));
  buildWalls(scene, assets);
  buildDining(scene, assets);
  for (const { kind, food, x, y, facing } of pieces) {
    const piece = new THREE.Group();
    piece.position.copy(cellPosition(x, y));
    piece.rotation.y = turns[facing];
    scene.add(piece);
    const { model, tools = [], mat } = stationLooks[kind];
    const pieceModel = model ?? (food && crateModels[food]);
    if (pieceModel) place(assets, pieceModel, piece, new THREE.Vector3());
    if (mat) piece.add(makeMat());
    for (const [tool, toolX, toolY, toolZ, turn] of tools) place(assets, tool, piece, new THREE.Vector3(toolX, toolY, toolZ), turn);
  }
}

// The walls stand just outside the plan, their inner faces flush with its back and side edges, so no counter or
// crate runs into them. A piece's depth comes from its model.
function buildWalls(scene: THREE.Scene, assets: Assets) {
  const back = -depth * grid.cell / 2;
  const side = width * grid.cell / 2;
  const half = (model: ModelName) => new THREE.Box3().setFromObject(assets[model].scene).getSize(new THREE.Vector3()).z / 2;
  room.backWall.forEach((kind, index) => {
    const model = sceneryModels[kind];
    place(assets, model, scene, new THREE.Vector3((index + 0.5) * grid.wallPiece - side, 0, back - half(model)));
  });
  const sidePieces = room.sideRows * grid.cell / grid.wallPiece;
  for (let index = 0; index < sidePieces; index++) {
    const z = back + (index + 0.5) * grid.wallPiece;
    place(assets, sceneryModels.wall, scene, new THREE.Vector3(-side - half(sceneryModels.wall), 0, z), Math.PI / 2);
    place(assets, sceneryModels.wall, scene, new THREE.Vector3(side + half(sceneryModels.wall), 0, z), -Math.PI / 2);
  }
}

// The wooden floor fills the square floorReach around the centre; each table has a chair facing it on either side.
function buildDining(scene: THREE.Scene, assets: Assets) {
  for (let x = -dining.floorReach; x < dining.floorReach; x += grid.wallPiece) {
    for (let z = -dining.floorReach; z < dining.floorReach; z += grid.wallPiece) {
      place(assets, sceneryModels.diningFloor, scene, new THREE.Vector3(x + grid.wallPiece / 2, dining.floorLevel, z + grid.wallPiece / 2));
    }
  }
  for (const [x, z] of dining.tables) {
    place(assets, sceneryModels.diningTable, scene, new THREE.Vector3(x, 0, z));
    for (const side of [-1, 1]) place(assets, sceneryModels.chair, scene, new THREE.Vector3(x + side * dining.chairDistance, 0, z), -side * Math.PI / 2);
  }
}

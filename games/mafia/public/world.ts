// The parts of the scene that never change during a game: the grass field, the village around it and the room.
import * as THREE from 'three';
import { place, type Assets } from './assets.ts';
import { room, village, houseCamera } from './layout.ts';

export function buildWorld(scene: THREE.Scene, assets: Assets) {
  buildGround(scene, assets);
  buildVillage(scene, assets);
  buildRoom(scene, assets);
}

// One flat field painted with the grass of the hexagon pack's texture: every vertex samples the texture where the
// grass tile's top face does, so the field has the pack's colour without hexagon seams.
function buildGround(scene: THREE.Scene, assets: Assets) {
  let grass: THREE.Mesh | undefined;
  assets.grass.scene.traverse(node => { if (node instanceof THREE.Mesh) grass = node; });
  if (!grass) throw new Error('The grass model has no mesh.');
  const { position, uv } = grass.geometry.attributes;
  let top = 0;
  for (let index = 1; index < position.count; index++) if (position.getY(index) > position.getY(top)) top = index;
  const field = new THREE.CircleGeometry(village.groundRadius, 64).rotateX(-Math.PI / 2);
  const sample = [uv.getX(top), uv.getY(top)];
  field.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: field.attributes.position.count }, () => sample).flat(), 2));
  const ground = new THREE.Mesh(field, grass.material);
  ground.position.y = village.groundLevel;
  ground.receiveShadow = true;
  scene.add(ground);
}

// Each ring spreads its models evenly along the arc that faces away from the camera, each turned toward the room.
function buildVillage(scene: THREE.Scene, assets: Assets) {
  const start = houseCamera.yaw + village.openArc / 2;
  const arc = Math.PI * 2 - village.openArc;
  for (const { radius, scale, models } of village.rings) {
    models.forEach((model, index) => {
      const angle = start + arc * index / (models.length - 1);
      place(assets, model, scene, new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(radius), angle + Math.PI, scale);
    });
  }
}

// Every wall has the same number of pieces, so the room is square and its walls stand half its width from the centre.
function buildRoom(scene: THREE.Scene, assets: Assets) {
  const half = room.walls[0].kinds.length * room.piece / 2;
  for (let x = -half + room.piece / 2; x < half; x += room.piece) {
    for (let z = -half + room.piece / 2; z < half; z += room.piece) place(assets, 'floor', scene, new THREE.Vector3(x, 0, z));
  }
  for (const { facing, kinds } of room.walls) {
    const side = new THREE.Group();
    side.rotation.y = facing;
    scene.add(side);
    kinds.forEach((kind, index) => place(assets, kind, side, new THREE.Vector3((index + 0.5) * room.piece - half, 0, -half)));
  }
  for (const [model, x, z, facing] of room.furniture) {
    place(assets, model, scene, new THREE.Vector3(x, 0, z), facing);
    place(assets, model, scene, new THREE.Vector3(-x, 0, z), -facing);
  }
  place(assets, 'rug', scene, room.table.center, 0, room.table.rugScale);
  place(assets, 'table', scene, room.table.center, 0, room.table.scale);
  place(assets, room.centrepiece.model, scene, room.table.center.clone().setY(room.table.top), 0, room.centrepiece.scale);
}

// The parts of the scene that never change during a game: the pavement, the city around the bunker, and the bunker
// with its stores, the bomb's table and case, and the experts' round table.
import * as THREE from 'three';
import { place, type Assets } from './assets.ts';
import { bunker, city, houseCamera } from './layout.ts';

export function buildWorld(scene: THREE.Scene, assets: Assets) {
  buildGround(scene, assets);
  buildCity(scene, assets);
  buildBunker(scene, assets);
}

// One flat field painted with the pavement of the city pack's texture: every vertex samples the texture where the
// pavement tile's top face does, so the field has the pack's colour without tile seams.
function buildGround(scene: THREE.Scene, assets: Assets) {
  let pavement: THREE.Mesh | undefined;
  assets.pavement.scene.traverse(node => { if (node instanceof THREE.Mesh) pavement = node; });
  if (!pavement) throw new Error('The pavement model has no mesh.');
  const { position, uv } = pavement.geometry.attributes;
  let top = 0;
  for (let index = 1; index < position.count; index++) if (position.getY(index) > position.getY(top)) top = index;
  const field = new THREE.CircleGeometry(city.groundRadius, 64).rotateX(-Math.PI / 2);
  const sample = [uv.getX(top), uv.getY(top)];
  field.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: field.attributes.position.count }, () => sample).flat(), 2));
  const ground = new THREE.Mesh(field, pavement.material);
  ground.position.y = city.groundLevel;
  ground.receiveShadow = true;
  scene.add(ground);
}

// Each ring spreads its models evenly along the arc that faces away from the camera, each turned toward the bunker.
function buildCity(scene: THREE.Scene, assets: Assets) {
  const start = houseCamera.yaw + city.openArc / 2;
  const arc = Math.PI * 2 - city.openArc;
  for (const { radius, scale, models } of city.rings) {
    models.forEach((model, index) => {
      const angle = start + arc * index / (models.length - 1);
      place(assets, model, scene, new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(radius), angle + Math.PI, scale);
    });
  }
}

// Every wall has the same number of pieces, so the bunker is square and its walls stand half its width from the centre.
function buildBunker(scene: THREE.Scene, assets: Assets) {
  const half = bunker.walls[0].kinds.length * bunker.piece / 2;
  for (let x = -half + bunker.piece / 2; x < half; x += bunker.piece) {
    for (let z = -half + bunker.piece / 2; z < half; z += bunker.piece) place(assets, 'floor', scene, new THREE.Vector3(x, 0, z));
  }
  for (const { facing, kinds } of bunker.walls) {
    const side = new THREE.Group();
    side.rotation.y = facing;
    scene.add(side);
    kinds.forEach((kind, index) => place(assets, kind, side, new THREE.Vector3((index + 0.5) * bunker.piece - half, 0, -half)));
  }
  place(assets, 'door', scene, bunker.door);
  for (const [model, x, z, facing] of bunker.stores) place(assets, model, scene, new THREE.Vector3(x, 0, z), facing);
  const { table, top, caseScale } = bunker.bomb;
  place(assets, 'bombTable', scene, table);
  place(assets, 'bombCase', scene, table.clone().setY(top), 0, caseScale);
  place(assets, 'manualTable', scene, bunker.manuals.table, 0, bunker.manuals.scale);
}

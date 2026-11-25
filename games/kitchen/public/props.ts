// What no pack has, built from simple shapes as the original kitchen built them: the rat, the extinguisher, the
// red mat it stands on and the sink's soap foam. The shapes and colours are made once and shared by every copy;
// disposeProps frees them.
import * as THREE from 'three';
import { props } from './layout.ts';

type Vec3 = readonly [number, number, number];

const { rat, extinguisher, mat, foam } = props;
const paint = (color: string) => new THREE.MeshLambertMaterial({ color });
const materials = {
  grey: paint(rat.grey),
  pink: paint(rat.pink),
  red: paint(extinguisher.red),
  dark: paint(extinguisher.dark),
  mat: paint(mat.color),
  foam: new THREE.MeshLambertMaterial({ color: foam.color, transparent: true, opacity: foam.opacity }),
};
const shapes = {
  ratBody: new THREE.SphereGeometry(rat.body.radius, 12, 10).scale(...rat.body.scale),
  ratHead: new THREE.SphereGeometry(rat.head.radius, 12, 10),
  ratEar: new THREE.SphereGeometry(rat.ears.radius, 8, 6),
  ratNose: new THREE.SphereGeometry(rat.nose.radius, 6, 4),
  ratTail: new THREE.CylinderGeometry(...rat.tail.radii, rat.tail.length, 6).rotateX(rat.tail.tilt),
  bottle: new THREE.CylinderGeometry(extinguisher.bottle.radius, extinguisher.bottle.radius, extinguisher.bottle.height, 16).translate(0, extinguisher.bottle.height / 2, 0),
  cap: new THREE.CylinderGeometry(...extinguisher.cap.radii, extinguisher.cap.height, 12),
  nozzle: new THREE.BoxGeometry(...extinguisher.nozzle.size),
  mat: new THREE.BoxGeometry(...mat.size),
  bubble: new THREE.SphereGeometry(1, 12, 10),
};

function part(shape: keyof typeof shapes, material: keyof typeof materials, at: Vec3) {
  const mesh = new THREE.Mesh(shapes[shape], materials[material]);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function makeRat() {
  return new THREE.Group().add(
    part('ratBody', 'grey', rat.body.at),
    part('ratHead', 'grey', rat.head.at),
    ...rat.ears.at.map(at => part('ratEar', 'pink', at)),
    part('ratNose', 'pink', rat.nose.at),
    part('ratTail', 'pink', rat.tail.at),
  );
}

export function makeExtinguisher() {
  return new THREE.Group().add(
    part('bottle', 'red', [0, 0, 0]),
    part('cap', 'dark', extinguisher.cap.at),
    part('nozzle', 'dark', extinguisher.nozzle.at),
  );
}

export const makeMat = () => part('mat', 'mat', mat.at);

// The foam's clumps and its rising bubbles, in one group, each with where it rests and its size; animateFoam moves
// them.
interface Bubble {
  mesh: THREE.Mesh;
  y: number;
  radius: number;
}
export interface Foam {
  group: THREE.Group;
  clumps: Bubble[];
  rising: Bubble[];
}

export function makeFoam(): Foam {
  const bubble = ([x, y, z]: Vec3, radius: number): Bubble => {
    const mesh = new THREE.Mesh(shapes.bubble, materials.foam);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(radius);
    return { mesh, y, radius };
  };
  const clumps = foam.clumps.map(([x, y, z, radius]) => bubble([x, y, z], radius));
  const rising = foam.clumps.slice(0, foam.rising.count).map(([x, y, z]) => bubble([x, y, z], foam.rising.radius));
  return { group: new THREE.Group().add(...[...clumps, ...rising].map(each => each.mesh)), clumps, rising };
}

// Each clump bobs at its own point in the loop; each rising bubble climbs, shrinking, and starts again.
export function animateFoam({ clumps, rising }: Foam, time: number) {
  clumps.forEach((clump, index) => {
    clump.mesh.position.y = clump.y + Math.sin(time * foam.bob.speed + index) * foam.bob.height;
  });
  rising.forEach((bubble, index) => {
    const along = (time * foam.rising.speed + index / rising.length) % 1;
    bubble.mesh.position.y = bubble.y + along * foam.rising.height;
    bubble.mesh.scale.setScalar(Math.max(bubble.radius * (1 - along), Number.EPSILON));
  });
}

export function disposeProps() {
  for (const resource of [...Object.values(shapes), ...Object.values(materials)]) resource.dispose();
}

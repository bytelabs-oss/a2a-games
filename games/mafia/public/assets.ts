// Loading the scene's models once, placing copies of them, and freeing them when the scene goes away.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { models } from './layout.ts';
export type ModelName = keyof typeof models;

export type Assets = Record<ModelName, GLTF>;

export async function loadAssets(): Promise<Assets> {
  const loader = new GLTFLoader();
  const url = (file: string) => new URL(`models/${file}`, import.meta.url).href;
  const loaded = await Promise.all(Object.entries(models).map(async ([name, file]) => [name, await loader.loadAsync(url(file))]));
  return Object.fromEntries(loaded) as Assets;
}

// Adds a copy of a model to parent, turned to facing and scaled evenly. Every mesh casts and receives shadows.
export function place(assets: Assets, model: ModelName, parent: THREE.Object3D, position: THREE.Vector3, facing = 0, scale = 1): THREE.Object3D {
  const object = clone(assets[model].scene);
  object.position.copy(position);
  object.rotation.y = facing;
  object.scale.setScalar(scale);
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = true;
  });
  parent.add(object);
  return object;
}

// The part of a model with this name. The packs name every part the scene uses, so a missing one is a mistake.
export function part(model: THREE.Object3D, name: string): THREE.Object3D {
  const found = model.getObjectByName(name);
  if (!found) throw new Error(`The model has no part called ${name}.`);
  return found;
}

export function disposeAssets(assets: Assets) {
  const resources = new Set<{ dispose(): void }>();
  for (const { scene } of Object.values(assets)) {
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      resources.add(node.geometry);
      for (const material of [node.material].flat()) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
      }
    });
  }
  for (const resource of resources) resource.dispose();
}

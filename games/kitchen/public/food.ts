// Builds the model for an item a chef can hold or leave on a station, from its view: a food, a plate with the food on
// it, or the extinguisher.
import * as THREE from 'three';
import { place, type Assets } from './assets.ts';
import { itemModels, plating, looseFoodSize } from './layout.ts';
import { makeExtinguisher } from './props.ts';
import type { ItemView } from './things.ts';

export function makeItem(assets: Assets, item: ItemView): THREE.Object3D {
  if (item.kind === 'Extinguisher') return makeExtinguisher();
  const group = new THREE.Group();
  const model = place(assets, itemModels[item.kind], group, new THREE.Vector3());
  if (item.kind !== 'Plate') {
    // Loose food is sized to fit a fixed footprint; a dirty plate keeps its own size.
    if (item.kind !== 'DirtyPlate') {
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(Math.min(1, looseFoodSize / Math.max(size.x, size.z)));
    }
    return group;
  }
  let height = plating.base;
  for (const { food, model: layerModel } of plating.layers.filter(layer => item.foods?.includes(layer.food))) {
    const layer = place(assets, layerModel ?? itemModels[food], group, new THREE.Vector3(0, height, 0), 0, plating.scale);
    height = new THREE.Box3().setFromObject(layer).max.y;
  }
  return group;
}

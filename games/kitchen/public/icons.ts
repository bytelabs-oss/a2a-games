// Pictures for the order tickets: every dish, plated, and every ingredient at the stage it goes on a plate, rendered
// once from the models as images the page can show.
import * as THREE from 'three';
import { dishes } from './kitchen.ts';
import { icons, lights, houseCamera } from './layout.ts';
import { makeItem } from './food.ts';
import type { Assets } from './assets.ts';
import type { DishName } from './types.ts';
import type { PlateableKind } from './things.ts';

// Each picture is a data URL.
export interface Pictures {
  dishes: Record<DishName, string>;
  foods: Record<PlateableKind, string>;
}

export function renderIcons(assets: Assets): Pictures {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(icons.size, icons.size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lights.exposure;
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(lights.sun.color, lights.sun.intensity);
  sun.position.copy(lights.sun.position);
  scene.add(new THREE.HemisphereLight(lights.sky.color, lights.sky.ground, lights.sky.intensity), sun);
  const camera = new THREE.PerspectiveCamera(icons.fieldOfView, 1, 0.1, 100);
  const bounds = new THREE.Sphere();

  // Frames the model's bounding sphere from the house camera's angle and returns the picture as a data URL.
  function picture(model: THREE.Object3D) {
    scene.add(model);
    new THREE.Box3().setFromObject(model).getBoundingSphere(bounds);
    const distance = bounds.radius / Math.sin(THREE.MathUtils.degToRad(icons.fieldOfView / 2));
    camera.position.setFromSphericalCoords(distance, Math.PI / 2 - houseCamera.pitch, houseCamera.yaw).add(bounds.center);
    camera.lookAt(bounds.center);
    renderer.render(scene, camera);
    scene.remove(model);
    return renderer.domElement.toDataURL();
  }

  const result = {
    dishes: Object.fromEntries(Object.entries(dishes).map(([id, dish]) => [id, picture(makeItem(assets, { kind: 'Plate', foods: dish.foods }))])),
    foods: Object.fromEntries([...new Set(Object.values(dishes).flatMap(dish => dish.foods))].map(food => [food, picture(makeItem(assets, { kind: food }))])),
  } as Pictures;
  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}

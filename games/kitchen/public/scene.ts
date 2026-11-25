// The kitchen scene: the renderer, camera and lights, the world, stations and chefs built from the models, and the
// page layer over them. The shell calls mount with the game area, and update, chat and event as the game goes on.
import * as THREE from 'three';
import { lights, houseCamera, chefs as look } from './layout.ts';
import { loadAssets, disposeAssets, type Assets } from './assets.ts';
import { buildWorld } from './world.ts';
import { createStations } from './stations.ts';
import { buildDelivery } from './delivery.ts';
import { createCast } from './cast.ts';
import { createOverlay } from './overlay.ts';
import { renderIcons } from './icons.ts';
import { disposeProps } from './props.ts';
import { preview } from './preview.ts';
import { isKitchenEvent, starScores } from './kitchen.ts';
import type { ChatLine, GameEvent, PageView, SceneContext } from './types.ts';

// What mount returns, as the shell calls it; ready settles once the models are loaded and the scene is built.
export interface MountedScene {
  ready: Promise<void>;
  update(next: SceneContext): void;
  chat(line: ChatLine): void;
  event(event: GameEvent): void;
  unmount(): void;
}

// Higher pixel ratios cost far more GPU time than they add on this soft, low-poly look.
const maxPixelRatio = 1.5;

export default function mount(element: HTMLElement, context: SceneContext): MountedScene {
  let current = context;
  let assets: Assets | undefined;
  let stations: ReturnType<typeof createStations> | undefined;
  let belt: ReturnType<typeof buildDelivery> | undefined;
  let cast: ReturnType<typeof createCast> | undefined;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(lights.background);
  const camera = new THREE.PerspectiveCamera(houseCamera.fieldOfView, 1, 1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lights.exposure;
  renderer.domElement.className = 'kitchen-canvas';
  renderer.domElement.setAttribute('aria-label', 'A kitchen with chefs working at counters, stoves, boards and a sink.');
  element.append(renderer.domElement);
  const overlay = createOverlay(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const sky = new THREE.HemisphereLight(lights.sky.color, lights.sky.ground, lights.sky.intensity);
  const sun = new THREE.DirectionalLight(lights.sun.color, lights.sun.intensity);
  sun.position.copy(lights.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(lights.sun.shadowSize);
  Object.assign(sun.shadow.camera, { left: -lights.sun.reach, right: lights.sun.reach, top: lights.sun.reach, bottom: -lights.sun.reach });
  sun.shadow.normalBias = lights.sun.normalBias;
  scene.add(sky, sun);

  function show() {
    const view: Partial<PageView> = current.view ?? {};
    overlay.show(view);
    overlay.chefs(view.chefs);
    stations?.draw(view);
    // Once service is over, the chefs cheer if they earned a star.
    cast?.draw(view.chefs, view.phase === 'over' && (view.score ?? 0) >= starScores[0]);
  }
  show();

  function resize() {
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const verticalHalf = THREE.MathUtils.degToRad(houseCamera.fieldOfView / 2);
    const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
    const distance = houseCamera.frameRadius / Math.sin(Math.min(verticalHalf, horizontalHalf));
    camera.position.setFromSphericalCoords(distance, Math.PI / 2 - houseCamera.pitch, houseCamera.yaw).add(houseCamera.target);
    camera.lookAt(houseCamera.target);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  resize();

  // Where a point in the scene lands on screen, in pixels.
  function project(point: THREE.Vector3) {
    const { x, y } = point.clone().project(camera);
    return { x: (x + 1) * element.clientWidth / 2, y: (1 - y) * element.clientHeight / 2 };
  }
  const namePoint = (head: THREE.Object3D) => head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, look.headroom * look.scale, 0));

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(time => {
    timer.update(time);
    if (!reducedMotion.matches) {
      cast?.animate(timer.getDelta());
      stations?.animate(timer.getElapsed());
      belt?.animate(timer.getElapsed());
    }
    renderer.render(scene, camera);
    overlay.frame(project, (cast?.heads() ?? []).map(({ id, head }) => ({ id, point: namePoint(head) })), current.settings.names !== false);
  });

  let unmounted = false;
  const ready = loadAssets()
    .then(loaded => {
      assets = loaded;
      if (unmounted) return disposeAssets(assets);
      buildWorld(scene, assets);
      belt = buildDelivery(scene);
      stations = createStations(scene, assets);
      cast = createCast(scene, assets);
      overlay.pictures(renderIcons(assets));
      show();
    })
    .catch(error => console.error('The kitchen scene could not load its models:', error));

  const mounted: MountedScene = {
    ready,
    update(next) {
      current = next;
      show();
    },
    chat(line) {
      overlay.say(line.from.id, line.text);
    },
    event(event) {
      if (event.headline) overlay.announce(event.text);
      if (isKitchenEvent(event.data)) overlay.happened(event.data);
    },
    unmount() {
      unmounted = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      timer.dispose();
      cast?.clear();
      stations?.clear();
      belt?.dispose();
      overlay.clear();
      if (assets) disposeAssets(assets);
      disposeProps();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
  return new URLSearchParams(location.search).has('preview') ? preview(element, mounted, context) : mounted;
}

// The Mafia scene: the renderer, camera and lights, the world and cast built from the models, and the page layer
// over them. The shell calls mount with the game area, and update, chat and event as the game goes on.
import * as THREE from 'three';
import { lights, houseCamera, seating, room } from './layout.ts';
import { loadAssets, disposeAssets } from './assets.ts';
import { buildWorld } from './world.ts';
import { createCast } from './cast.ts';
import { createOverlay } from './overlay.ts';
import { preview } from './preview.ts';
import type { Assets } from './assets.ts';
import type { Person } from './cast.ts';
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
  let cast: ReturnType<typeof createCast> | undefined;
  let people: Person[] = [];

  const scene = new THREE.Scene();
  const background = new THREE.Color();
  scene.background = background;
  const camera = new THREE.PerspectiveCamera(houseCamera.fieldOfView, 1, 1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = 'mafia-canvas';
  renderer.domElement.setAttribute('aria-label', 'Villagers seated around a table in a village room, with the narrator in an armchair.');
  element.append(renderer.domElement);
  const overlay = createOverlay(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const skylight = new THREE.HemisphereLight();
  const sunlight = new THREE.DirectionalLight();
  sunlight.position.copy(lights.sun.position);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.setScalar(lights.sun.shadowSize);
  Object.assign(sunlight.shadow.camera, { left: -lights.sun.reach, right: lights.sun.reach, top: lights.sun.reach, bottom: -lights.sun.reach });
  sunlight.shadow.normalBias = lights.sun.normalBias;
  const candle = new THREE.PointLight(lights.candle.color, 0, lights.candle.distance);
  candle.position.set(room.table.center.x, lights.candle.height, room.table.center.z);
  scene.add(skylight, sunlight, candle);

  // Day or night lighting from the page's view; anything but night is lit as day.
  function light(phase: PageView['phase'] | undefined) {
    const setting = phase === 'night' ? lights.night : lights.day;
    skylight.color.set(setting.sky.color);
    skylight.groundColor.set(setting.sky.ground);
    skylight.intensity = setting.sky.intensity;
    sunlight.color.set(setting.sun.color);
    sunlight.intensity = setting.sun.intensity;
    candle.intensity = setting.candle;
    background.set(setting.background);
    renderer.toneMappingExposure = setting.exposure;
  }

  function show() {
    overlay.clock(current.view ?? undefined);
    overlay.timer(current.view?.bar);
    light(current.view?.phase);
    const drawn = cast?.draw(current.view ?? undefined);
    if (!drawn) return;
    people = drawn;
    overlay.clear();
    for (const person of people) overlay.add(person);
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

  // Where a point a given height above someone's head bone lands on screen, in pixels.
  const point = new THREE.Vector3();
  function onScreen(head: THREE.Object3D, height: number) {
    head.getWorldPosition(point).setY(point.y + height * seating.scale).project(camera);
    return { x: (point.x + 1) * element.clientWidth / 2, y: (1 - point.y) * element.clientHeight / 2 };
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(time => {
    timer.update(time);
    if (!reducedMotion.matches) cast?.animate(timer.getDelta());
    renderer.render(scene, camera);
    overlay.countdown();
    for (const { id, head } of people) {
      overlay.place(id, onScreen(head, seating.headroom), onScreen(head, seating.eyes), current.settings.names !== false);
    }
  });

  let unmounted = false;
  const ready = loadAssets()
    .then(loaded => {
      assets = loaded;
      if (unmounted) return disposeAssets(assets);
      buildWorld(scene, assets);
      cast = createCast(scene, assets);
      show();
    })
    .catch(error => console.error('The Mafia scene could not load its models:', error));

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
    },
    unmount() {
      unmounted = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      timer.dispose();
      cast?.clear();
      // The ground is built here rather than loaded, so the loaded models' cleanup does not cover it.
      scene.traverse(node => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
      if (assets) disposeAssets(assets);
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
  return new URLSearchParams(location.search).has('preview') ? preview(element, mounted, context) : mounted;
}

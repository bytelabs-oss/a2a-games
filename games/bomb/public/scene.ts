// The Bomb scene: the renderer, camera and lights, the bunker and cast built from the models, and the page layer
// over them. The shell calls mount with the game area, and update, chat and event as the game goes on.
import * as THREE from 'three';
import { lights, houseCamera, people as peopleLayout, bunker } from './layout.ts';
import { loadAssets, disposeAssets } from './assets.ts';
import { buildWorld } from './world.ts';
import { createCast } from './cast.ts';
import { createOverlay } from './overlay.ts';
import { createDevice } from './device.ts';
import { preview } from './preview.ts';
import type { Assets } from './assets.ts';
import type { Person } from './cast.ts';
import type { ChatLine, GameEvent, SceneContext } from './types.ts';

// What mount returns, as the shell calls it; ready settles once the models are loaded and the scene is built.
export interface MountedScene {
  ready: Promise<void>;
  update(next: SceneContext): void;
  chat(line: ChatLine): void;
  event(event: GameEvent): void;
  // For the preview: switching states drops banners still queued from the last one.
  clearHeadlines(): void;
  unmount(): void;
}

// Higher pixel ratios cost far more GPU time than they add on this soft, low-poly look.
const maxPixelRatio = 1.5;
// A strike flashes the alarm light for this long, in seconds.
const strikeFlash = 1.2;

export default function mount(element: HTMLElement, context: SceneContext): MountedScene {
  let current = context;
  let assets: Assets | undefined;
  let cast: ReturnType<typeof createCast> | undefined;
  let people: Person[] = [];
  let strikes = context.view?.bomb?.strikes ?? 0;
  let flash = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(lights.background);
  const camera = new THREE.PerspectiveCamera(houseCamera.fieldOfView, 1, 1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lights.exposure;
  renderer.domElement.className = 'bomb-canvas';
  renderer.domElement.setAttribute('aria-label', 'A concrete bunker in the middle of the city: the defuser stands over the bomb on a work table, and the experts sit around a table with their manuals.');
  element.append(renderer.domElement);
  const overlay = createOverlay(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const skylight = new THREE.HemisphereLight(lights.sky.color, lights.sky.ground, lights.sky.intensity);
  const sunlight = new THREE.DirectionalLight(lights.sun.color, lights.sun.intensity);
  sunlight.position.copy(lights.sun.position);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.setScalar(lights.sun.shadowSize);
  Object.assign(sunlight.shadow.camera, { left: -lights.sun.reach, right: lights.sun.reach, top: lights.sun.reach, bottom: -lights.sun.reach });
  sunlight.shadow.normalBias = lights.sun.normalBias;
  const alarm = new THREE.PointLight(lights.alarm.color, 0, lights.alarm.distance);
  alarm.position.copy(bunker.bomb.table).setY(lights.alarm.height);
  scene.add(skylight, sunlight, alarm);
  const device = createDevice(scene);

  function show() {
    overlay.show(current.view ?? undefined);
    const bomb = current.view?.bomb;
    if (bomb && bomb.strikes > strikes) flash = strikeFlash;
    strikes = bomb?.strikes ?? 0;
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
    head.getWorldPosition(point).setY(point.y + height * peopleLayout.scale).project(camera);
    return { x: (point.x + 1) * element.clientWidth / 2, y: (1 - point.y) * element.clientHeight / 2 };
  }

  // The alarm flashes after a strike and pulses once a second in the last minute.
  function lightAlarm(seconds: number, left: number | null, time: number) {
    flash = Math.max(0, flash - seconds);
    const pulse = left !== null && left <= lights.alarm.lastSeconds ? (Math.sin(time / 1000 * Math.PI * 2) + 1) / 2 : 0;
    const strike = flash > 0 ? Math.abs(Math.sin(flash * Math.PI * 4)) : 0;
    alarm.intensity = lights.alarm.intensity * Math.max(pulse * 0.6, strike);
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(time => {
    timer.update(time);
    const seconds = timer.getDelta();
    if (!reducedMotion.matches) cast?.animate(seconds);
    const left = overlay.countdown(lights.alarm.lastSeconds);
    lightAlarm(seconds, left, time);
    device.draw(current.view?.bomb ?? null, left);
    renderer.render(scene, camera);
    for (const { id, head } of people) overlay.place(id, onScreen(head, peopleLayout.headroom), current.settings.names !== false);
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
    .catch(error => console.error('The Bomb scene could not load its models:', error));

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
    clearHeadlines() {
      overlay.clearHeadlines();
    },
    unmount() {
      unmounted = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      timer.dispose();
      cast?.clear();
      device.dispose();
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

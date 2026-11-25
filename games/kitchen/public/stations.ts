// What sits on the stations: the food or plate left on each, sizzling while it cooks, the stacks of clean and dirty
// plates, soap foam in a sink being washed at, fires and rats.
// Redrawn whenever that part of the page's view changes.
import * as THREE from 'three';
import { place, type Assets } from './assets.ts';
import { stations } from './kitchen.ts';
import { itemSpacing, stationLooks, turns, itemModels, plateStacks, flames as look, props, progressHeight, toasts, sizzle } from './layout.ts';
import { cellPosition } from './world.ts';
import { makeItem } from './food.ts';
import { makeRat, makeFoam, animateFoam, type Foam } from './props.ts';
import type { ModelName, PageView, Place } from './types.ts';

type Vec3 = readonly [number, number, number];

const top = (station: Place) => cellPosition(station.x, station.y).setY(stationLooks[station.kind].top);

// Where each station's progress bar goes, and where a word pops up over it, by station id.
const above = (point: THREE.Vector3, height: number) => point.add(new THREE.Vector3(0, height, 0));
export const progressPositions = new Map(stations.map(station => [station.id, above(top(station), progressHeight)]));
export const toastPositions = new Map(stations.map(station => [station.id, above(top(station), toasts.lift)]));

export function createStations(scene: THREE.Scene, assets: Assets) {
  const contents = new THREE.Group();
  scene.add(contents);
  const flameGeometry = new THREE.ConeGeometry(look.radius, look.height, 6);
  const flameMaterials = new Map(look.cones.map(([, , color]) => [color, new THREE.MeshBasicMaterial({ color })]));
  const fires: THREE.Group[] = [];
  const sizzling: THREE.Object3D[] = [];
  const rats: { rat: THREE.Group; top: number }[] = [];
  const foams: Foam[] = [];
  let drawnKey = '';

  // at is [x, y, z] from the middle of the station's top, turned with the station.
  function stack(model: ModelName, station: Place, at: Vec3, count: number) {
    const base = top(station).add(new THREE.Vector3(...at).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turns[station.facing]));
    for (let index = 0; index < count; index++) place(assets, model, contents, base.clone().setY(base.y + index * plateStacks.step));
  }

  function lather(station: Place) {
    const foam = makeFoam();
    foam.group.position.copy(top(station));
    foam.group.rotation.y = turns[station.facing];
    contents.add(foam.group);
    foams.push(foam);
  }

  function burn(station: Place) {
    const flames = new THREE.Group();
    flames.position.copy(top(station)).setY(top(station).y + look.lift);
    for (const [x, y, color] of look.cones) flames.add(new THREE.Mesh(flameGeometry, flameMaterials.get(color)).translateX(x).translateY(y));
    contents.add(flames);
    fires.push(flames);
  }

  // A rat sits beside the food, turned a little toward it.
  function scurry(station: Place) {
    const rat = makeRat();
    rat.position.copy(top(station)).add(new THREE.Vector3(...props.rat.at));
    rat.rotation.y = props.rat.turn;
    contents.add(rat);
    rats.push({ rat, top: rat.position.y });
  }

  return {
    // Draws what the view has on each station.
    draw({ stations: state = {} }: Pick<PageView, 'stations'>) {
      const key = JSON.stringify(state);
      if (key === drawnKey) return;
      drawnKey = key;
      contents.clear();
      fires.length = sizzling.length = rats.length = foams.length = 0;
      for (const station of stations) {
        const { items = [], stack: plates, fire: burning, rat: pest, progress } = state[station.id] ?? {};
        const moving = Boolean(progress?.rate);
        // Items on a worktop stand side by side along it, centred.
        items.forEach((item, index) => {
          const model = makeItem(assets, item);
          const along = new THREE.Vector3((index - (items.length - 1) / 2) * itemSpacing, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, turns[station.facing]);
          model.position.copy(top(station)).add(along);
          model.rotation.y = turns[station.facing];
          contents.add(model);
          // Food on a stove sizzles while the heat works on it.
          if (station.kind === 'stove' && moving) sizzling.push(model);
        });
        if (burning) burn(station);
        if (pest) scurry(station);
        if (plates) stack(itemModels[plates.kind], station, plateStacks.at[plates.kind], plates.count);
        // Soap foam fills a sink while a plate in it is washed.
        if (station.kind === 'sink' && moving) lather(station);
      }
    },
    // Every fire's flames flicker in height together, food cooking on a stove hops as it sizzles, rats nibble, and
    // foam bubbles.
    animate(time: number) {
      const height = 1 + Math.sin(time * look.flicker.speed) * look.flicker.amount;
      for (const flames of fires) flames.scale.y = height;
      const hop = Math.abs(Math.sin(time * sizzle.speed)) * sizzle.height;
      for (const food of sizzling) food.position.y = stationLooks.stove.top + hop;
      const nibble = Math.abs(Math.sin(time * props.rat.nibble.speed)) * props.rat.nibble.height;
      for (const { rat, top: rest } of rats) rat.position.y = rest + nibble;
      for (const foam of foams) animateFoam(foam, time);
    },
    clear() {
      contents.clear();
      for (const resource of [flameGeometry, ...flameMaterials.values()]) resource.dispose();
    },
  };
}

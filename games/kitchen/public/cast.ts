// The chefs: one character per seat in a chef's hat, with a ring in their colour at their feet, walking to the cell
// the page's view puts them in, playing the clip for the step they are working at, holding a knife while they cut, and
// carrying what they hold in front of them.
import * as THREE from 'three';
import { place, part, type Assets } from './assets.ts';
import { chefs as look, turns } from './layout.ts';
import { cellPosition } from './world.ts';
import { makeItem } from './food.ts';
import type { ChefView, StepName } from './types.ts';

// A chef plays a clip for moving, standing or cheering, or for the step they are working at.
type Clip = keyof typeof look.clips | StepName;

interface Chef {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<Clip, THREE.AnimationAction>;
  knife: THREE.Object3D;
  head: THREE.Object3D;
  clip: Clip;
  held: THREE.Group;
  heldKey: string;
  target: THREE.Vector3;
  facing: number;
  working: ChefView['working'];
  cheering: boolean;
}

// Spreads seat numbers evenly over [0, 1), so chefs never share an idle phase.
const spread = (index: number) => (index * 0.618034) % 1;

export function createCast(scene: THREE.Scene, assets: Assets) {
  const chefs = new Map<string, Chef>();
  const { hat, ring } = look;
  const hatMaterial = new THREE.MeshStandardMaterial({ color: hat.color, flatShading: true });
  const band = new THREE.CylinderGeometry(hat.band.radius, hat.band.radius, hat.band.height, 12).translate(0, hat.band.height / 2, 0);
  const puff = new THREE.SphereGeometry(hat.puff.radius, 12, 8).scale(1, hat.puff.squash, 1).translate(0, hat.band.height, 0);
  const ringGeometry = new THREE.RingGeometry(ring.inner, ring.outer, 32).rotateX(-Math.PI / 2);
  const ringMaterials = look.colors.map(color => new THREE.MeshBasicMaterial({ color }));

  function wearHat(head: THREE.Object3D) {
    const crown = new THREE.Group();
    crown.position.y = hat.lift;
    crown.add(new THREE.Mesh(band, hatMaterial), new THREE.Mesh(puff, hatMaterial));
    crown.traverse(node => { node.castShadow = true; });
    head.add(crown);
  }

  function add({ id, seat, x, y, facing }: ChefView): Chef {
    const character = look.characters[seat];
    const group = new THREE.Group();
    group.position.copy(cellPosition(x, y));
    scene.add(group);
    const body = place(assets, character, group, new THREE.Vector3(), 0, look.scale);
    for (const gear of look.gear[character]) part(body, gear).visible = false;
    const head = part(body, 'head');
    wearHat(head);
    const knife = place(assets, 'knife', part(body, look.knife.slot), new THREE.Vector3(), look.knife.turn, look.knife.scale);
    knife.visible = false;
    group.add(new THREE.Mesh(ringGeometry, ringMaterials[seat]).translateY(ring.lift));
    const mixer = new THREE.AnimationMixer(body);
    const clip = (name: string) => {
      const found = THREE.AnimationClip.findByName(assets[character].animations, name);
      if (!found) throw new Error(`${character} has no ${name} clip.`);
      return mixer.clipAction(found);
    };
    const clips = { ...look.clips, ...look.working };
    const actions = Object.fromEntries(Object.entries(clips).map(([name, clipName]) => [name, clip(clipName)])) as Record<Clip, THREE.AnimationAction>;
    const held = new THREE.Group();
    held.position.copy(look.carry.at);
    held.scale.setScalar(look.carry.scale);
    group.add(held);
    const chef: Chef = {
      group, mixer, actions, knife, head, clip: 'idle', held, heldKey: '[]',
      target: group.position.clone(), facing: turns[facing], working: null, cheering: false,
    };
    actions.idle.play().time = spread(seat) * actions.idle.getClip().duration;
    chefs.set(id, chef);
    return chef;
  }

  function remove(id: string) {
    const chef = chefs.get(id);
    if (!chef) return;
    chef.mixer.stopAllAction();
    chef.group.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    });
    chef.group.removeFromParent();
    chefs.delete(id);
  }

  return {
    // Brings the chefs in line with the view's chefs, {id, seat, x, y, facing, working, hands}. cheering makes
    // every chef standing still cheer.
    draw(list: ChefView[] = [], cheering = false) {
      for (const id of chefs.keys()) if (!list.some(chef => chef.id === id)) remove(id);
      for (const view of list) {
        const chef = chefs.get(view.id) ?? add(view);
        Object.assign(chef, { target: cellPosition(view.x, view.y), facing: turns[view.facing], working: view.working, cheering });
        const heldKey = JSON.stringify(view.hands);
        if (heldKey === chef.heldKey) continue;
        chef.heldKey = heldKey;
        chef.held.clear();
        view.hands.forEach((item, index) => chef.held.add(makeItem(assets, item).translateY(index * look.carry.gap)));
      }
    },
    // Walks each chef toward their cell, facing the way they go, then turns them as the view says and plays the
    // clip for the step they are working at.
    animate(seconds: number) {
      for (const chef of chefs.values()) {
        const way = chef.target.clone().sub(chef.group.position);
        const moving = way.length() > 0;
        if (moving) {
          chef.group.rotation.y = Math.atan2(way.x, way.z);
          chef.group.position.add(way.clampLength(0, look.speed * seconds));
        } else chef.group.rotation.y = chef.facing;
        const clip: Clip = moving ? 'walk' : chef.working ?? (chef.cheering ? 'cheer' : 'idle');
        if (clip !== chef.clip) {
          chef.actions[clip].reset().play().crossFadeFrom(chef.actions[chef.clip], look.blend);
          chef.clip = clip;
          chef.knife.visible = clip === 'cut';
        }
        chef.mixer.update(seconds);
      }
    },
    // Each chef's id and head bone, for placing their name and bubble.
    heads() {
      return [...chefs].map(([id, { head }]) => ({ id, head }));
    },
    clear() {
      for (const id of [...chefs.keys()]) remove(id);
      for (const resource of [hatMaterial, band, puff, ringGeometry, ...ringMaterials]) resource.dispose();
    },
  };
}

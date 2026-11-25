// The people in the scene: players around the table, each dressed for their role with a book in front of them,
// and the narrator in the armchair. Rebuilt whenever the seats, roles or eliminations in the page's view change.
import * as THREE from 'three';
import { place, part, type Assets } from './assets.ts';
import { room, seating, gear, outfits, eliminated } from './layout.ts';
import type { PageView } from './types.ts';

// Someone at the table, and the head bone their name and bubble follow.
export interface Person {
  id: string;
  name: string;
  role: PageView['players'][number]['role'];
  out: boolean;
  head: THREE.Object3D;
}

// Spreads seat numbers evenly over [0, 1), so neighbours never share an idle phase.
const spread = (index: number) => (index * 0.618034) % 1;

export function createCast(scene: THREE.Scene, assets: Assets) {
  const actors = new THREE.Group();
  scene.add(actors);
  const mixers: THREE.AnimationMixer[] = [];
  const fadedMaterials: THREE.Material[] = [];
  let drawnKey = '';

  // A seat is a piece of furniture with a character on it, both facing the group's +z. An eliminated player has
  // no chair: they lie where it stood, faded, in the death pose.
  function seat(index: number, position: THREE.Vector3, facing: number, furniture: 'chair' | 'armchair', role: keyof typeof outfits, out: boolean) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = facing;
    actors.add(group);
    if (!out) place(assets, furniture, group, new THREE.Vector3(), 0, seating.scale);
    const { character, wear } = outfits[role];
    const anchor = out ? new THREE.Vector3() : seating.anchor.clone().multiplyScalar(seating.scale);
    const body = place(assets, character, group, anchor, 0, seating.scale);
    for (const name of gear[character]) part(body, name).visible = (wear as readonly string[]).includes(name);
    const mixer = new THREE.AnimationMixer(body);
    mixers.push(mixer);
    if (out) {
      body.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.material = Object.assign((node.material as THREE.Material).clone(), { transparent: true, opacity: eliminated.opacity });
        node.castShadow = false;
        fadedMaterials.push(node.material);
      });
      mixer.clipAction(clipOf(character, eliminated.clip)).play();
    } else {
      const clip = clipOf(character, seating.idle.clip);
      const idle = mixer.clipAction(clip).play();
      idle.time = spread(index) * clip.duration;
      idle.timeScale = 1 + (spread(index + 1) - 0.5) * seating.idle.speedSpread;
    }
    mixer.update(0);
    return part(body, 'head');
  }

  function clipOf(character: keyof typeof gear, name: string) {
    const clip = THREE.AnimationClip.findByName(assets[character].animations, name);
    if (!clip) throw new Error(`${character} has no ${name} clip.`);
    return clip;
  }

  function clear() {
    for (const mixer of mixers) mixer.stopAllAction();
    mixers.length = 0;
    for (const material of fadedMaterials.splice(0)) material.dispose();
    actors.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    });
    actors.clear();
  }

  return {
    // Seats everyone in the page's view: its players in seat order as {id, name, role, eliminated}, and its narrator.
    // Returns the people as {id, name, role, out, head}, or null when nothing changed. role is null until dealt.
    draw(view: Partial<PageView> = {}): Person[] | null {
      const players = view.players ?? [];
      const key = JSON.stringify([players, view.narrator]);
      if (key === drawnKey) return null;
      drawnKey = key;
      clear();
      const people = players.map(({ id, name, role, eliminated: out }, index) => {
        // Seats spread evenly from the camera side. With an even count one would land at the far side, right in front
        // of the narrator's armchair, so the ring turns half a step to keep that side clear.
        const step = Math.PI * 2 / players.length;
        const angle = index * step + (players.length % 2 ? 0 : step / 2);
        const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const head = seat(index, direction.clone().multiplyScalar(seating.radius).add(room.table.center), angle + Math.PI, 'chair', role ?? 'villager', out);
        // The book model stands upright in the pack; tipping it onto its back lays it on the table.
        if (!out) {
          const book = direction.clone().multiplyScalar(room.place.radius).add(room.table.center).setY(room.table.top);
          place(assets, room.place.model, actors, book, angle + Math.PI, room.place.scale).rotateX(-Math.PI / 2);
        }
        return { id, name, role, out, head };
      });
      if (view.narrator) {
        const head = seat(players.length, room.narrator.position, room.narrator.facing, 'armchair', 'narrator', false);
        people.push({ ...view.narrator, role: null, out: false, head });
      }
      return people;
    },
    animate(seconds: number) {
      for (const mixer of mixers) mixer.update(seconds);
    },
    clear,
  };
}

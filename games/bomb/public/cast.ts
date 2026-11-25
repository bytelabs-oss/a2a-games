// The people in the scene: the defuser standing over the bomb, and the experts seated around the round table, each
// with a manual in front of them. Before the roles are dealt, everyone sits at the table. Rebuilt whenever the players or the phase in the page's view change.
import * as THREE from 'three';
import { place, part, type Assets } from './assets.ts';
import { bunker, people } from './layout.ts';
import type { PageView, Role } from './types.ts';

// Someone in the bunker, and the head bone their name and bubble follow.
export interface Person {
  id: string;
  name: string;
  role: Role | null;
  head: THREE.Object3D;
}

type Character = keyof typeof people.gear;
type Look = {
  character: Character;
  wear: readonly string[];
  outfit: readonly (readonly [readonly [number, number], readonly [Character, number, number]])[];
};

// The pack's atlases are 8 swatches across and 4 down.
const atlasGrid = { columns: 8, rows: 4 };

// Spreads indexes evenly over [0, 1), so neighbours never share an idle phase.
const spread = (index: number) => (index * 0.618034) % 1;

export function createCast(scene: THREE.Scene, assets: Assets) {
  const actors = new THREE.Group();
  scene.add(actors);
  const mixers: THREE.AnimationMixer[] = [];
  let drawnKey = '';
  // One repainted material per outfit, shared by everyone who wears it.
  const outfits = new Map<string, THREE.MeshStandardMaterial>();

  function materialOf(character: Character) {
    let found: THREE.MeshStandardMaterial | undefined;
    assets[character].scene.traverse(node => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial && node.material.map) found ??= node.material;
    });
    if (!found?.map) throw new Error(`${character} has no textured material.`);
    return found as THREE.MeshStandardMaterial & { map: THREE.Texture };
  }

  function dressed(look: Look) {
    const key = JSON.stringify([look.character, look.outfit]);
    const made = outfits.get(key);
    if (made) return made;
    const base = materialOf(look.character);
    const image = base.map.image as CanvasImageSource & { width: number; height: number };
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas to repaint an outfit on.');
    context.drawImage(image, 0, 0);
    const width = image.width / atlasGrid.columns;
    const height = image.height / atlasGrid.rows;
    for (const [[column, row], [from, fromColumn, fromRow]] of look.outfit) {
      context.drawImage(materialOf(from).map.image as CanvasImageSource, fromColumn * width, fromRow * height, width, height, column * width, row * height, width, height);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.flipY = base.map.flipY;
    map.colorSpace = base.map.colorSpace;
    const material = Object.assign(base.clone(), { map });
    outfits.set(key, material);
    return material;
  }

  function body(index: number, look: Look, parent: THREE.Object3D, at: THREE.Vector3, clipName: string) {
    const model = place(assets, look.character, parent, at, 0, people.scale);
    for (const name of people.gear[look.character]) part(model, name).visible = look.wear.includes(name);
    if (look.outfit.length) {
      const material = dressed(look);
      model.traverse(node => {
        if (node instanceof THREE.Mesh) node.material = material;
      });
    }
    const mixer = new THREE.AnimationMixer(model);
    mixers.push(mixer);
    const clip = THREE.AnimationClip.findByName(assets[look.character].animations, clipName);
    if (!clip) throw new Error(`${look.character} has no ${clipName} clip.`);
    const action = mixer.clipAction(clip).play();
    action.time = spread(index) * clip.duration;
    action.timeScale = 1 + (spread(index + 1) - 0.5) * people.speedSpread;
    mixer.update(0);
    return part(model, 'head');
  }

  function clear() {
    for (const mixer of mixers) mixer.stopAllAction();
    mixers.length = 0;
    actors.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    });
    actors.clear();
  }

  function dispose() {
    clear();
    for (const material of outfits.values()) {
      material.map?.dispose();
      material.dispose();
    }
    outfits.clear();
  }

  return {
    // Places the defuser at the bomb and everyone else around the table: the experts once the roles are dealt, and
    // every player before. Returns the people, or null when nothing changed.
    draw(view: Partial<PageView> = {}): Person[] | null {
      const phase = view.phase ?? 'lobby';
      const players = view.players ?? [];
      const key = JSON.stringify([phase, players.map(({ id, name, role }) => [id, name, role])]);
      if (key === drawnKey) return null;
      drawnKey = key;
      clear();
      const drawn: Person[] = [];
      const defuser = players.find(player => player.role === 'defuser');
      if (defuser) {
        const head = body(0, people.defuser, actors, bunker.bomb.defuser, people.clips.defuser[phase]);
        drawn.push({ id: defuser.id, name: defuser.name, role: 'defuser', head });
      }
      const seated = players.filter(player => player.role !== 'defuser').slice(0, people.experts.length);
      const { table, radius, book, top } = bunker.manuals;
      seated.forEach(({ id, name, role }, index) => {
        // Seats spread evenly around the table from the camera side. With an even count one would sit straight in
        // front of the table, hiding it, so the ring turns half a step.
        const step = Math.PI * 2 / seated.length;
        const angle = index * step + (seated.length % 2 ? 0 : step / 2);
        const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const group = new THREE.Group();
        group.position.copy(direction.clone().multiplyScalar(radius).add(table));
        group.rotation.y = angle + Math.PI;
        actors.add(group);
        const clip = people.clips.expert[phase];
        const sitting = clip.startsWith('Sit_');
        if (sitting) place(assets, 'chair', group, new THREE.Vector3(), 0, people.scale);
        const at = sitting ? people.seatAnchor.clone().multiplyScalar(people.scale) : new THREE.Vector3();
        const head = body(index + 1, people.experts[index], group, at, clip);
        // The book model stands upright in the pack; tipping it onto its back lays it on the table.
        const manual = direction.clone().multiplyScalar(book.radius).add(table).setY(top);
        place(assets, 'book', actors, manual, angle + Math.PI, book.scale).rotateX(-Math.PI / 2);
        drawn.push({ id, name, role, head });
      });
      return drawn;
    },
    animate(seconds: number) {
      for (const mixer of mixers) mixer.update(seconds);
    },
    clear: dispose,
  };
}

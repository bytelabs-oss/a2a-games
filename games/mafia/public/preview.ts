// A dev-only switch for looking at the scene in each state, with demo data and with the worst data the shell
// accepts: names are one word of up to 50 characters, chat lines and events up to 300. Open the page with
// ?preview to show it. It feeds the scene through the same update, chat and event calls the shell uses, with
// page views shaped like the ones game.ts builds.
import type { Role } from '../rules.ts';
import type { ChatLine, PageView, SceneContext } from './types.ts';
import type { MountedScene } from './scene.ts';

// A state to show: its view, chat lines by seat, a line from the narrator, and headlines.
interface PreviewState {
  view: PageView;
  chat?: [number, string][];
  narration?: string;
  headlines?: string[];
}
const narrator = { id: 'narrator', name: 'Narrator' };
const names = ['Alder', 'Birch', 'Clover', 'Finch', 'Hazel', 'Moss', 'Reed', 'Wren'];
const roles: Role[] = ['mafia', 'villager', 'doctor', 'villager', 'mafia', 'detective', 'villager', 'villager'];
const soon = (seconds: number) => Date.now() + seconds * 1000;

// Seats for a page view: roles are null until dealt; out lists the seats that are eliminated.
const seat = (list: string[], { dealt = true, out = [] as number[] } = {}): PageView['players'] => list.map((name, index) => ({
  id: `p${index}`, name, role: dealt ? roles[index] ?? null : null, eliminated: out.includes(index),
}));

// Exactly 300 characters, the longest line the shell takes.
const longest = 'I have been watching everyone since the first night and I am sure of three things: the doctor saved me, '
  + 'the detective is hiding behind a quiet vote, and whoever keeps asking us to wait another round is buying time '
  + 'for the mafia. I vote: we question Finch, before another one of us is gone by sunrise.';
const longNames = [
  'Wolfeschlegelsteinhausenbergerdorffvoralternwarenge',
  'Jo',
  'Aleksandra-Wiśniewska-Kowalczyk',
  'عائشة',
  '🦊Fox',
  'Bartholomew_Fitzgerald_Northwind_Industries_Holdi',
  'X',
  'Nguyễn-Thị-Minh-Khai',
].map(name => [...name].slice(0, 50).join(''));

const states: Record<string, () => PreviewState> = {
  Lobby: () => ({ view: { day: 0, phase: 'day', narrator, players: seat(names.slice(0, 6), { dealt: false }), bar: { text: 'Waiting for Narrator to start · 4 of 6 ready' } } }),
  Talk: () => ({
    view: { day: 1, phase: 'day', narrator, players: seat(names, { dealt: false }), bar: { text: 'Hazel has the floor', endsAt: soon(45) } },
    chat: [[4, 'I was home all night, I swear.']],
    narration: 'The sun rises on a quiet village. Not everyone made it through the night.',
  }),
  Night: () => ({ view: { day: 2, phase: 'night', narrator, players: seat(names), bar: { text: 'Night 2 · the mafia, doctor and detective are choosing', endsAt: soon(90) } } }),
  Vote: () => ({
    view: { day: 3, phase: 'day', narrator, players: seat(names, { out: [2, 7] }), bar: { text: 'Vote · 4 of 6 voted', endsAt: soon(60) } },
    headlines: ['Wren was eliminated in the night. Wren was a villager.', 'The vote is open.'],
  }),
  'Worst case': () => ({
    view: { day: 128, phase: 'night', narrator, players: seat(longNames, { out: [3, 6] }), bar: { text: `${longNames[0]}'s turn · floor or pass`, endsAt: soon(45) } },
    chat: [[0, longest], [1, longest], [5, longest], [4, 'ok']],
    headlines: [longest],
  }),
  Over: () => ({
    view: { day: 4, phase: 'day', narrator, players: seat(names, { out: [0, 2, 4, 7] }), bar: { text: 'The game is over' } },
    headlines: ['The village wins. No mafia remain.'],
  }),
  Empty: () => ({ view: { day: 0, phase: 'day', narrator: null, players: [], bar: { text: 'Waiting for a narrator · 0 of 0 ready' } } }),
};

export function preview(element: HTMLElement, scene: MountedScene, context: SceneContext): MountedScene {
  let settings = context.settings;
  let shown = states.Lobby();
  const show = (name: string) => {
    shown = states[name]();
    const players = shown.view.players;
    scene.update({ ...context, settings, status: 'playing', view: shown.view });
    for (const [index, text] of shown.chat ?? []) {
      const from: ChatLine['from'] | undefined = players[index];
      if (from) scene.chat({ from, text });
    }
    if (shown.narration) scene.chat({ from: narrator, text: shown.narration });
    for (const text of shown.headlines ?? []) scene.event({ text, headline: true });
    for (const button of bar.children) button.setAttribute('aria-pressed', String(button.textContent === name));
  };
  const bar = Object.assign(document.createElement('div'), { className: 'mafia-preview' });
  for (const name of Object.keys(states)) {
    bar.append(Object.assign(document.createElement('button'), { type: 'button', textContent: name, onclick: () => show(name) }));
  }
  element.append(bar);
  scene.ready.then(() => show('Talk'));
  return {
    ...scene,
    update(next: SceneContext) {
      settings = next.settings;
      scene.update({ ...next, view: shown.view });
    },
    unmount() {
      bar.remove();
      scene.unmount();
    },
  };
}

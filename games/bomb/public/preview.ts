// A dev-only switch for looking at the scene in each state, with demo data and with the worst data the shell
// accepts: names are one word of up to 50 characters, chat lines and events up to 300. Open the page with
// ?preview to show it. It feeds the scene through the same update, chat and event calls the shell uses, with
// page views shaped like the ones game.ts will build.
import type { Bomb, ChatLine, Page, PageView, SceneContext } from './types.ts';
import type { MountedScene } from './scene.ts';

interface PreviewState {
  view: PageView;
  // Chat lines by player, in the order of the view's players.
  chat?: [number, string][];
  headlines?: string[];
}

const soon = (seconds: number) => Date.now() + seconds * 1000;
const names = ['Rook', 'Ash', 'Briar', 'Cove', 'Dune'];
const dealt: Page[][] = [['index'], ['wires'], ['symbols'], ['gauges']];
// Players for a page view: the first is the defuser once dealt, the rest experts with their pages.
const players = (list: string[], { roles = true } = {}): PageView['players'] => list.map((name, index) => ({
  id: `p${index}`, name, role: roles ? (index ? 'expert' : 'defuser') : null, pages: roles && index ? dealt[(index - 1) % dealt.length] : [],
}));

const bomb = (overrides: Partial<Bomb> = {}): Bomb => ({
  serial: 'K3P7R2',
  batteries: 3,
  endsAt: soon(272),
  left: 272,
  strikes: 1,
  maxStrikes: 3,
  wires: { colors: ['red', 'blue', 'yellow', 'white', 'black'], cut: [false, false, true, false, false], solved: true },
  symbols: { shown: ['star', 'eye', 'anchor', 'flame'], pressed: 2, solved: false },
  gauges: { readings: [47, 12, 81], solved: false },
  ...overrides,
});

// Exactly 300 characters, the longest line the shell takes.
const longest = 'Wire four is the white one, and the serial ends in an even digit, so by the index we are on letter B, '
  + 'which says cut the last wire that is not black unless there are more than two batteries, and there are three, '
  + 'so do NOT cut the black one. Cut wire four, the white one, then tell me what symbols you can see.';
const longNames = ['Wolfeschlegelsteinhausenbergerdorffvoralternwarenge', 'Jo', 'عائشة', '🦊Fox', 'Bartholomew_Fitzgerald_Northwind_Industries_Holdi']
  .map(name => [...name].slice(0, 50).join(''));

const states: Record<string, () => PreviewState> = {
  Lobby: () => ({ view: { phase: 'lobby', players: players(names.slice(0, 4), { roles: false }), bomb: null, bar: { text: 'Waiting for everyone to be ready · 2 of 4 ready' } } }),
  Armed: () => ({
    view: { phase: 'armed', players: players(names.slice(0, 4)), bomb: bomb(), bar: { text: 'Rook is defusing · 1 of 3 modules solved' } },
    chat: [[0, 'Four symbols: star, eye, anchor, flame. Which first?'], [3, 'Letter B. Gauges go to 40 to 54.']],
  }),
  'Last minute': () => ({
    view: {
      phase: 'armed', players: players(names), bar: { text: 'Rook is defusing · 2 of 3 modules solved' },
      bomb: bomb({ endsAt: soon(48), left: 48, strikes: 2, symbols: { shown: ['star', 'eye', 'anchor', 'flame'], pressed: 4, solved: true }, gauges: { readings: [47, 52, 81], solved: false } }),
    },
    chat: [[2, 'Turn gauge 3 twice. Not gauge 1, it is already in the band!']],
    headlines: ['Strike two. 30 seconds off the clock.'],
  }),
  Defused: () => ({
    view: {
      phase: 'defused', players: players(names.slice(0, 4)), bar: { text: 'Defused with 1:37 left' },
      bomb: bomb({ endsAt: null, left: 97, symbols: { shown: ['star', 'eye', 'anchor', 'flame'], pressed: 4, solved: true }, gauges: { readings: [47, 52, 51], solved: true } }),
    },
    headlines: ['The bomb is defused with 1:37 left.'],
  }),
  Exploded: () => ({
    view: { phase: 'exploded', players: players(names.slice(0, 3)), bomb: bomb({ endsAt: null, left: 0, strikes: 3 }), bar: { text: 'The bomb went off' } },
    headlines: ['The bomb went off.'],
  }),
  'Worst case': () => ({
    view: {
      phase: 'armed', players: players(longNames), bar: { text: `${longNames[0]} is defusing · 0 of 3 modules solved` },
      bomb: bomb({
        serial: 'Z9Z9Z9', batteries: 4, strikes: 2,
        wires: { colors: ['red', 'blue', 'yellow', 'white', 'black', 'green'], cut: [true, false, false, true, false, false], solved: false },
        symbols: { shown: ['snowflake', 'feather', 'droplet', 'crown'], pressed: 0, solved: false },
        gauges: { readings: [0, 99, 50], solved: false },
      }),
    },
    chat: [[0, longest], [1, longest], [2, 'ok'], [4, longest]],
    headlines: [longest],
  }),
  Empty: () => ({ view: { phase: 'lobby', players: [], bomb: null, bar: { text: 'Waiting for players' } } }),
};

export function preview(element: HTMLElement, scene: MountedScene, context: SceneContext): MountedScene {
  let settings = context.settings;
  let shown = states.Lobby();
  const show = (name: string) => {
    shown = states[name]();
    scene.clearHeadlines();
    scene.update({ ...context, settings, status: 'playing', view: shown.view });
    for (const [index, text] of shown.chat ?? []) {
      const from: ChatLine['from'] | undefined = shown.view.players[index];
      if (from) scene.chat({ from, text });
    }
    for (const text of shown.headlines ?? []) scene.event({ text, headline: true });
    for (const button of bar.children) button.setAttribute('aria-pressed', String(button.textContent === name));
  };
  const bar = Object.assign(document.createElement('div'), { className: 'bomb-preview' });
  for (const name of Object.keys(states)) {
    bar.append(Object.assign(document.createElement('button'), { type: 'button', textContent: name, onclick: () => show(name) }));
  }
  element.append(bar);
  scene.ready.then(() => show('Armed'));
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

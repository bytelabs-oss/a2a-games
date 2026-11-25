// A dev-only switch for looking at the scene in each state, with demo data and with the worst data the shell
// accepts: names are one word of up to 50 characters, chat lines and events up to 300. Open the page with
// ?preview to show it. It feeds the scene through the same update, chat and event calls the shell uses, with page
// views built from the same things the game uses.
import { announce, dishes, plateCount, stations } from './kitchen.ts';
import {
  Bun, chainOf, Cheese, CookedPatty, crateFoods, CutCheese, CutLettuce, CutOnion, CutTomato, DirtyPlate, Extinguisher, Fire, Item,
  Lettuce, Onion, Patty, Plate, seconds, Tomato, words, type PlateableKind,
} from './things.ts';
import type { MountedScene } from './scene.ts';
import type { ChefView, Direction, DishName, KitchenEvent, PageView, ProgressView, SceneContext, StationKind, StationView, StepName } from './types.ts';

// A state to show: one view with chat lines by seat and the kitchen events that led to it, or steps played in turn every
// `every` seconds, each a view, its events, and a note naming what it shows.
// A demo view gives what is on each station; the station's cell comes from the floor plan when it is shown.
type Shown = Omit<StationView, 'x' | 'y'>;
type DemoView = Omit<PageView, 'stations'> & { stations?: Record<string, Shown> };
type Step = { view: DemoView; events?: KitchenEvent[]; note?: string };
type PreviewState = (Step & { chat?: [number, string][] }) | { steps: Step[]; every: number };
// A chef's place in a demo view: [x, y, facing, working, the item in hand].
type Spot = [number, number, Direction, (StepName | null)?, (Item | null)?];
type Stations = Record<string, Shown>;

const names = ['Alder', 'Birch', 'Clover', 'Finch'];

// Chefs for a page view, in seats 0 to 3.
const chefs = (list: string[], spots: Spot[]): ChefView[] => spots.map(([x, y, facing, working = null, holding = null], seat) => ({
  id: `p${seat}`, name: list[seat] ?? '', seat, x, y, facing, working, at: null, hands: holding ? [holding.view()] : [],
}));
// A plate with foods on it.
function plate(...foods: PlateableKind[]): Item {
  const made = new Plate();
  const kinds: Record<PlateableKind, () => Plate['foods'][number]> = {
    CutLettuce: () => new CutLettuce(), CutTomato: () => new CutTomato(), CutCheese: () => new CutCheese(), CutOnion: () => new CutOnion(),
    Bun: () => new Bun(), CookedPatty: () => new CookedPatty(),
  };
  made.foods = foods.map(food => kinds[food]());
  return made;
}
// A station holding items.
const holding = (...items: Item[]): Shown => ({ items: items.map(item => item.view()) });
// Progress `done` of the way through something that takes `total` seconds, moving on unless stopped.
const progress = (done: number, total: number, { moving = true, warning = false } = {}): ProgressView =>
  ({ fill: done, rate: moving ? 1 / total : 0, warning });
const onHook: Stations = { extinguisher_hook: holding(new Extinguisher()) };
// Clean plates on the rack, and dirty ones at the sink, `washed` of the way through washing the top one.
const plates = (clean: number, dirty = 0, washed?: number): Stations => ({
  plates: { stack: { kind: 'Plate', count: clean } },
  ...(dirty && { sink: { stack: { kind: 'DirtyPlate', count: dirty }, ...(washed !== undefined && { progress: progress(washed, seconds.wash) }) } }),
});
const order = (id: string, dish: DishName, left: number) => ({ id, dish, seconds: dishes[dish].seconds, left });

// Every stage of every food from its crate, one stage at a time, each where it is made: the crate's food on a counter,
// what is cut on a board, what is cooked on a stove. Then a plate, dirty in the sink and clean on the rack. It is built
// from the thing classes, so a food or a stage added there shows here.
const madeAt: Record<'cut' | 'cook' | 'none', StationKind> = { none: 'counter', cut: 'board', cook: 'stove' };
const firstOf = (kind: StationKind) => stations.find(station => station.kind === kind)?.id ?? '';
function stageSteps(): Step[] {
  const steps: Step[] = [];
  for (const make of Object.values(crateFoods)) {
    const chain = chainOf(new make());
    const line = chain.map(link => words(link.thing.kind));
    chain.forEach(({ thing, by }, index) => {
      const shown: Shown = thing instanceof Fire ? { fire: true } : thing instanceof Item ? holding(thing) : {};
      steps.push({
        view: { phase: 'lobby', chefs: [], stations: { ...onHook, ...plates(plateCount), [firstOf(madeAt[by ?? 'none'])]: shown } },
        note: line.map((name, at) => (at === index ? `[${name}]` : name)).join(' → '),
      });
    });
  }
  const dirty = new DirtyPlate();
  const line = [dirty, dirty.wash()].map(thing => words(thing.kind));
  steps.push(
    { view: { phase: 'lobby', chefs: [], stations: { ...onHook, ...plates(0, 1) } }, note: `[${line[0]}] → ${line[1]}` },
    { view: { phase: 'lobby', chefs: [], stations: { ...onHook, ...plates(1) } }, note: `${line[0]} → [${line[1]}]` },
  );
  return steps;
}

// Every dish on the menu, plated, plus a half-made burger and an empty plate.
const dishShelf: Stations = {
  ...onHook,
  ...plates(2, 3),
  delivery_1: holding(plate(...dishes.salad.foods)),
  delivery_2: holding(plate(...dishes.burger.foods)),
  counter_3: holding(plate(...dishes.cheeseburger.foods)),
  counter_4: holding(plate(...dishes.deluxe.foods)),
  counter_5: holding(plate(...dishes.onionburger.foods)),
  counter_1: holding(plate('Bun', 'CookedPatty')),
  counter_2: holding(plate()),
};

// Exactly 300 characters, the longest line the shell takes.
const longest = 'Behind you! I am taking the cooked patty off stove two before it burns, then plating the deluxe burger '
  + 'for the order that is about to run out. Somebody please wash two plates at the sink, we are down to the last '
  + 'clean one, and keep an eye on stove one because the next patty goes on in about four seconds or so, okay?!';
const longNames = [
  'Wolfeschlegelsteinhausenbergerdorffvoralternwarenge',
  'Jo',
  'Aleksandra-Wiśniewska-Kowalczyk',
  'Nguyễn-Thị-Minh-Khai',
].map(name => [...name].slice(0, 50).join(''));
const lineUp: Spot[] = [[2, 5, 'down'], [4, 5, 'down'], [6, 5, 'down'], [8, 5, 'down']];
const stocked = (): Stations => ({ ...onHook, ...plates(plateCount) });

const states: Record<string, () => PreviewState> = {
  Empty: () => ({ view: { phase: 'lobby', chefs: [], stations: stocked() } }),
  Lobby: () => ({ view: { phase: 'lobby', chefs: chefs(names, lineUp), stations: stocked() } }),
  Service: () => ({
    view: {
      phase: 'service', score: 130, left: 192,
      orders: [order('o4', 'burger', 95), order('o5', 'salad', 40), order('o6', 'deluxe', 118)],
      chefs: chefs(names, [[1, 1, 'up', 'cut'], [4, 1, 'up', null, new Patty()], [8, 1, 'right', 'wash'], [6, 4, 'up', null, plate('Bun', 'CookedPatty')]]),
      stations: {
        ...onHook,
        ...plates(1, 1, 0.3),
        board_1: { ...holding(new Lettuce()), progress: progress(0.6, seconds.cut) },
        stove_1: { ...holding(new Patty()), progress: progress(0.25, seconds.cook) },
        stove_2: { ...holding(new CookedPatty()), progress: progress(0.55, seconds.burn, { warning: true }) },
        counter_4: holding(plate('CutLettuce', 'CutTomato')),
        counter_1: { ...holding(new CutTomato()), rat: true, progress: progress(0.2, seconds.ratEats) },
      },
    },
    chat: [[1, 'Patty going on stove one.'], [3, 'Burger needs lettuce, who has it?']],
  }),
  Stages: () => ({ every: 1.5, steps: stageSteps() }),
  Dishes: () => ({
    view: {
      phase: 'lobby', stations: dishShelf,
      chefs: chefs(names, [[2, 5, 'down', null, new Bun()], [4, 5, 'down', null, plate(...dishes.cheeseburger.foods)], [6, 5, 'down', null, new Tomato()], [8, 5, 'down', null, new CookedPatty()]]),
    },
  }),
  Fire: () => ({
    view: {
      phase: 'service', score: 60, left: 141,
      orders: [order('o2', 'cheeseburger', 22), order('o3', 'onionburger', 70)],
      chefs: chefs(names, [[4, 2, 'up'], [5, 1, 'up', null, new Extinguisher()], [8, 1, 'right', 'wash'], [1, 1, 'up', 'cut']]),
      stations: {
        ...plates(0, 2),
        stove_1: { fire: true },
        stove_2: { fire: true, progress: progress(0.4, seconds.spray, { moving: false }) },
        board_1: { ...holding(new Onion()), progress: progress(0.2, seconds.cut) },
        counter_4: { ...holding(plate('Bun', 'CookedPatty')), rat: true, progress: progress(0.2, seconds.ratEats) },
        counter_7: { ...holding(new CutTomato()), rat: true, progress: progress(0.55, seconds.ratEats) },
      },
    },
    events: [{ type: 'fireStarted', station: 'stove_2' }, { type: 'ratArrived', station: 'counter_4' }],
  }),
  // One chef carrying a tomato walks round the kitchen a cell at a time, as the game's views will move them.
  Walking: () => ({
    every: 0.5,
    steps: [[1, 5], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [6, 5], [5, 5], [4, 5], [3, 5], [2, 5]]
      .map(([x = 0, y = 0]) => ({ view: { phase: 'lobby', stations: stocked(), chefs: chefs(names, [[x, y, 'down', null, new Tomato()]]) } })),
  }),
  // A rat climbs onto a counter with a burger, its bar runs out, and it eats the burger; then again.
  'Rat eats': () => ({
    every: 2.5,
    steps: [
      {
        view: { phase: 'service', score: 60, left: 141, stations: { ...onHook, ...plates(3), counter_4: { ...holding(plate('Bun', 'CookedPatty')), rat: true, progress: progress(1 - 2.5 / seconds.ratEats, seconds.ratEats) } } },
        events: [{ type: 'ratArrived', station: 'counter_4' }],
      },
      { view: { phase: 'service', score: 60, left: 141, stations: { ...onHook, ...plates(3) } }, events: [{ type: 'ratAte', station: 'counter_4' }] },
    ],
  }),
  Over: () => ({
    view: { phase: 'over', score: 240, chefs: chefs(names, lineUp), stations: { ...onHook, ...plates(2, 2) } },
    events: [{ type: 'serviceEnded', score: 240, stars: 2 }],
  }),
  'Worst case': () => ({
    view: {
      phase: 'service', score: 1240, left: 3599,
      orders: (Object.keys(dishes) as DishName[]).map((dish, index) => order(`o${index + 120}`, dish, 10 + index * 25)),
      chefs: chefs(longNames, [[3, 4, 'up', null, plate(...dishes.deluxe.foods)], [4, 4, 'up'], [5, 4, 'up'], [4, 2, 'down', null, new Cheese()]]),
      stations: {
        ...onHook,
        ...plates(plateCount, plateCount),
        stove_1: { ...holding(new CookedPatty()), progress: progress(0.9, seconds.burn, { warning: true }) },
        stove_2: { fire: true },
        board_1: { ...holding(new Cheese()), progress: progress(1, seconds.cut) },
      },
    },
    chat: [[0, longest], [1, longest], [2, 'ok'], [3, longest]],
    events: [
      { type: 'orderServed', order: 'o123', dish: 'deluxe', station: 'delivery_1', chef: longNames[2] ?? '', points: dishes.deluxe.points },
      { type: 'fireStarted', station: 'stove_2' },
    ],
  }),
};

// A demo view as the game gives it, with each station's cell.
const placed = ({ stations: shown, ...rest }: DemoView): PageView => ({
  ...rest,
  ...(shown && { stations: Object.fromEntries(Object.entries(shown).map(([id, on]) => {
    const place = stations.find(station => station.id === id);
    if (!place) throw new Error(`The floor plan has no station called ${id}.`);
    return [id, { x: place.x, y: place.y, ...on }];
  })) }),
});

export function preview(element: HTMLElement, scene: MountedScene, context: SceneContext): MountedScene {
  let settings = context.settings;
  let view: PageView | null = null;
  let playing: ReturnType<typeof setInterval> | undefined;
  const update = () => scene.update({ ...context, settings, status: 'playing', view });
  // Shows a view, then its events, as the shell sends them.
  const play = (step: Step | undefined) => {
    if (!step) return;
    view = placed(step.view);
    update();
    for (const event of step.events ?? []) scene.event(announce(event));
    caption.textContent = step.note ?? '';
  };
  // A state is one view, or steps played in turn, every `every` seconds. Each step builds its view afresh, so its
  // times count from that moment.
  const show = (name: string) => {
    clearInterval(playing);
    const shown = states[name]();
    if ('steps' in shown) {
      let step = 0;
      const next = () => {
        const fresh = states[name]();
        if ('steps' in fresh) play(fresh.steps[step++ % fresh.steps.length]);
      };
      next();
      playing = setInterval(next, shown.every * 1000);
    } else {
      play(shown);
      for (const [seat, text] of shown.chat ?? []) {
        const from = shown.view.chefs?.[seat];
        if (from) scene.chat({ from, text });
      }
    }
    for (const button of bar.children) button.setAttribute('aria-pressed', String(button.textContent === name));
  };
  const bar = Object.assign(document.createElement('div'), { className: 'kitchen-preview' });
  for (const name of Object.keys(states)) {
    bar.append(Object.assign(document.createElement('button'), { type: 'button', textContent: name, onclick: () => show(name) }));
  }
  // What the step on screen shows, in step with it; a headline banner would queue behind the ones before.
  const caption = Object.assign(document.createElement('p'), { className: 'kitchen-preview-note' });
  element.append(bar, caption);
  scene.ready.then(() => show('Service'));
  return {
    ...scene,
    update(next: SceneContext) {
      settings = next.settings;
      update();
    },
    unmount() {
      clearInterval(playing);
      bar.remove();
      caption.remove();
      scene.unmount();
    },
  };
}

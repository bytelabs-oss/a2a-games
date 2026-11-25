// The kitchen's rules as a state machine. The phase is lobby, service or over; start and end are the one place a
// service begins and finishes. A step names a station or an order, and the station decides what the step does there
// (objects.ts). A step that takes time, walking or working, returns a promise that the tick settles when it is done.
import type { Outcome, PlayerRef, SettingValue } from '../../src/shell/types.ts';
import { announce, soundOf, chefRules, directions, dishes, floorPlan, plateCount, service, spots, starScores, stations as places } from './public/kitchen.ts';
import { DirtyPlate, Extinguisher, Plate, crateFoods, type Item } from './public/things.ts';
import type { Cell, ChefOwnView, ChefView, Direction, DishName, KitchenEvent, Order, PageView, Phase, Place, Seconds, StepName } from './public/types.ts';
import { Belt, Bin, Board, Counter, Crate, Hook, PlateRack, Sink, Station, Stove, viewOf, type Done, type Hands } from './objects.ts';

// What a chef is busy with: walking somewhere, or working a step at a station. arrive says what reaching the end of
// the walk comes to, and finish settles the step's promise.
type Task = { finish: (outcome: Outcome) => void } & ({ doing: 'walk'; arrive: () => Outcome } | { doing: StepName; station: Station });

// A chef is a pair of hands at a cell. They hold one item at a time.
export interface Chef extends Omit<ChefView, 'hands' | 'at'>, Hands {
  ready: boolean;
  // The cells still to walk, and the seconds until the chef steps onto the next.
  path: Cell[];
  stepIn: Seconds;
  task: Task | null;
  // The station the chef is at: the one they last walked to, until they walk away. Only one chef is at a station.
  at: Station | null;
}

export interface State {
  phase: Phase;
  minutes: number;
  // The seconds between rats on average, as the game's option sets.
  ratSeconds: Seconds;
  // The seconds of service left, while it runs.
  left: Seconds | null;
  score: number;
  chefs: Chef[];
  stations: Record<string, Station>;
  orders: Order[];
  ordersMade: number;
  // The seconds until the next order comes in and the next rat climbs up.
  orderIn: Seconds;
  ratIn: Seconds;
}

const opposite: Record<Direction, Direction> = { down: 'up', up: 'down', left: 'right', right: 'left' };
const directionNames = Object.keys(directions) as Direction[];
const isFloor = ({ x, y }: Cell) => floorPlan[y]?.[x] === '.';
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const step = ({ x, y }: Cell, direction: Direction): Cell => ({ x: x + directions[direction][0], y: y + directions[direction][1] });
// The floor cell a station is worked from.
const front = (place: Place) => step(place, place.facing);
const ok = (message: string, events: KitchenEvent[] = []): Outcome => ({ ok: true, message, events: events.map(announce), sound: soundOf(events) });
const refuse = (message: string): Outcome => ({ ok: false, message });
const answer = ({ ok: done, message, events = [] }: Done): Outcome => (done ? ok(message, events) : refuse(message));
const between = ([low, high]: readonly [number, number]) => low + Math.random() * (high - low);
// The seconds until the next rat: random, within the spread of the average.
const ratGap = (average: Seconds) => between([average * (1 - service.rats.spread), average * (1 + service.rats.spread)]);
const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

// A fresh kitchen: a station for every place in the floor plan, every plate clean in the rack, and the extinguisher on
// its hook.
export function build(): Record<string, Station> {
  const rackPlace = places.find(place => place.kind === 'plates');
  if (!rackPlace) throw new Error('The floor plan has no plates.');
  const rack = new PlateRack(rackPlace, plateCount);
  const make = (place: Place): Station => {
    switch (place.kind) {
      case 'counter': return new Counter(place);
      case 'board': return new Board(place);
      case 'stove': return new Stove(place);
      case 'delivery': return new Belt(place);
      case 'bin': return new Bin(place);
      case 'plates': return rack;
      case 'sink': return new Sink(place, rack);
      case 'crate': {
        if (!place.food) throw new Error(`The crate at ${place.id} gives no food.`);
        const food = crateFoods[place.food];
        return new Crate(place, () => new food());
      }
      case 'extinguisher_hook': {
        const hook = new Hook(place);
        hook.items.push(new Extinguisher());
        return hook;
      }
    }
  };
  return Object.fromEntries(places.map(place => [place.id, make(place)]));
}

export function create(): State {
  return {
    phase: 'lobby', minutes: service.minutes.default, ratSeconds: service.rats.default, left: null, score: 0, chefs: [], stations: build(), orders: [],
    ordersMade: 0, orderIn: 0, ratIn: 0,
  };
}

const all = (state: State) => Object.values(state.stations);

// ── Chefs ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function join(state: State, player: PlayerRef): Outcome | void {
  const seat = chefRules.starts.findIndex((_, index) => !state.chefs.some(chef => chef.seat === index));
  const start = chefRules.starts[seat];
  if (!start) return refuse(`The kitchen has ${chefRules.starts.length} chefs, all here.`);
  state.chefs.push({
    id: player.id, name: player.name, seat, ...start, facing: 'down', working: null, held: null, ready: false, path: [], stepIn: 0, task: null, at: null, spot: null,
  });
}

export function leave(state: State, player: PlayerRef) {
  const chef = state.chefs.find(each => each.id === player.id);
  chef?.task?.finish(refuse('You left the kitchen.'));
  state.chefs = state.chefs.filter(each => each.id !== player.id);
}

// Once every chef is ready, service starts.
export function ready(state: State, player: PlayerRef) {
  const chef = state.chefs.find(each => each.id === player.id);
  if (chef) chef.ready = true;
  return state.phase !== 'service' && state.chefs.every(each => each.ready);
}

// ── Service ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function start(state: State, options: Record<string, SettingValue>): Outcome {
  if (!state.chefs.length) return refuse('A chef must join first.');
  const minutes = Number(options.minutes ?? service.minutes.default);
  const ratSeconds = Number(options.ratSeconds ?? service.rats.default);
  Object.assign(state, {
    phase: 'service', minutes, ratSeconds, left: minutes * 60, score: 0, stations: build(), orders: [], ordersMade: 0,
    ratIn: ratGap(ratSeconds),
  });
  const firstOrder = placeOrder(state);
  state.chefs.forEach(chef => {
    chef.task?.finish(refuse('Service started over.'));
    Object.assign(chef, { ...chefRules.starts[chef.seat], facing: 'down', working: null, held: null, path: [], task: null, at: null, spot: null });
  });
  return ok('Service starts.', [{ type: 'serviceStarted' }, firstOrder]);
}

export function end(state: State): Outcome {
  const finished = state.phase === 'service';
  state.phase = 'over';
  state.left = null;
  for (const chef of state.chefs) {
    chef.task?.finish(refuse('Service is over.'));
    Object.assign(chef, { working: null, path: [], task: null, ready: false });
  }
  const stars = starScores.filter(score => state.score >= score).length;
  return ok('Service is over.', finished ? [{ type: 'serviceEnded', score: state.score, stars }] : []);
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────────────────────────────

// The chef at a station other than the given one.
const holderOf = (state: State, station: Station, chef: Chef) => state.chefs.find(each => each !== chef && each.at === station);

// The station a step names, when the chef is at it and nothing there stops the step; otherwise why not. A fire stops
// everything but spraying it, and a rat everything but shooing it.
function at(state: State, chef: Chef, id: string, doing?: StepName): Station | Outcome {
  const station = state.stations[id];
  if (!station) return refuse(`There is no station called ${id}.`);
  if (chef.at !== station) return refuse(`Walk to ${id} first.`);
  if (station.fire && doing !== 'spray') return refuse(`${id} is on fire: spray it, holding the extinguisher.`);
  if (station.rat && doing !== 'shoo') return refuse(`A rat is on ${id}: shoo it, with empty hands.`);
  return station;
}

// A chef reaching a station is at it, unless another chef got there first.
function arrive(state: State, chef: Chef, station: Station): Outcome {
  chef.facing = opposite[station.place.facing];
  const other = holderOf(state, station, chef);
  if (other) return refuse(`${other.name} got to ${station.id} first. Only one chef can be at a station.`);
  chef.at = station;
  return ok(`You are at ${station.id}.`);
}

// The cells from one cell to another along the floor, not counting the first, or null when there is no way.
function route(from: Cell, to: Cell): Cell[] | null {
  const came = new Map<string, Cell | null>([[`${from.x},${from.y}`, null]]);
  const queue = [from];
  for (let cell = queue.shift(); cell; cell = queue.shift()) {
    if (same(cell, to)) {
      const path: Cell[] = [];
      for (let back: Cell | null | undefined = cell; back && !same(back, from); back = came.get(`${back.x},${back.y}`)) path.unshift(back);
      return path;
    }
    for (const direction of directionNames) {
      const next = step(cell, direction);
      if (isFloor(next) && !came.has(`${next.x},${next.y}`)) {
        came.set(`${next.x},${next.y}`, cell);
        queue.push(next);
      }
    }
  }
  return null;
}

// Hands a chef a step to work at a station and returns the promise the tick settles when it is done.
const busy = (chef: Chef, doing: StepName, station: Station) => new Promise<Outcome>(finish => {
  chef.task = { doing, station, finish };
  chef.working = doing;
});

// Sets a chef walking to a cell, leaving the station or spot they were at. arrive says what getting there comes to.
function go(chef: Chef, to: Cell, arrive: () => Outcome): Outcome | Promise<Outcome> | null {
  const path = route(chef, to);
  if (!path) return null;
  chef.at = chef.spot = null;
  chef.path = path;
  chef.stepIn = 1 / chefRules.speed;
  return path.length ? new Promise<Outcome>(finish => { chef.task = { doing: 'walk', arrive, finish }; }) : arrive();
}

function walk(state: State, chef: Chef, id: string) {
  const station = state.stations[id];
  if (!station) return refuse(`There is no station called ${id}.`);
  const other = holderOf(state, station, chef);
  if (other) return refuse(`${other.name} is at ${id}. Only one chef can be at a station.`);
  return go(chef, front(station.place), () => arrive(state, chef, station)) ?? refuse(`There is no way to walk to ${id}.`);
}

// A chef on a spot other than the given chef.
const standerOn = (state: State, id: string, chef: Chef) => state.chefs.find(each => each !== chef && each.spot === id);

// A chef moves to a spot they name, out of the way of the stations. Only one chef is on a spot.
function move(state: State, chef: Chef, id: string) {
  const spot = spots.find(each => each.id === id);
  if (!spot) return refuse(`There is no spot called ${id}. Spots: ${spots.map(each => each.id).join(', ')}.`);
  const taken = (other: Chef | undefined, how: string) => (other ? refuse(`${other.name} ${how}. Only one chef can be on a spot.`) : null);
  const land = () => taken(standerOn(state, id, chef), `got to ${id} first`) ?? ((chef.spot = id), ok(`You are on ${id}.`));
  return taken(standerOn(state, id, chef), `is on ${id}`) ?? go(chef, spot, land) ?? refuse(`There is no way to move to ${id}.`);
}

const take = (state: State, chef: Chef, id: string) => {
  const station = at(state, chef, id);
  return station instanceof Station ? answer(station.take(chef)) : station;
};

// A refused put says which kinds of station take what the chef holds, as each station decides for itself.
const put = (state: State, chef: Chef, id: string) => {
  const station = at(state, chef, id);
  if (!(station instanceof Station)) return station;
  const held = chef.held;
  const done = station.put(chef);
  if (done.ok || !held || station.accepts(held)) return answer(done);
  const kinds = [...new Set(all(state).filter(each => each.accepts(held)).map(each => each.place.kind.replace('_', ' ')))];
  return refuse(`${done.message} It goes on: ${kinds.join(', ') || 'nothing; deliver it or throw it in the bin'}.`);
};

// A step a chef keeps at: the station says whether it can be done there, and the tick does it.
const work = (doing: StepName) => (state: State, chef: Chef, id: string) => {
  const station = at(state, chef, id, doing);
  if (!(station instanceof Station)) return station;
  const why = station.canWork(doing, chef);
  return why ? refuse(why) : busy(chef, doing, station);
};

// At a delivery belt, a plate is handed over for an order's ticket. It must hold exactly that dish, and it comes back
// dirty to the sink.
function deliver(state: State, chef: Chef, id: string) {
  const belt = chef.at;
  if (!(belt instanceof Belt)) return refuse('Walk to a delivery belt first.');
  const order = state.orders.find(each => each.id === id);
  if (!order) return refuse(`There is no open order ${id}.`);
  const plate = chef.held;
  if (!(plate instanceof Plate)) return refuse('Deliver a plate.');
  const { foods: needs, points } = dishes[order.dish];
  const on: string[] = plate.foods.map(food => food.kind);
  if (on.length !== needs.length || !needs.every(kind => on.includes(kind))) return refuse(`Order ${id} needs ${needs.join(', ')}; your plate holds ${on.join(', ') || 'nothing'}.`);
  state.orders = state.orders.filter(each => each !== order);
  state.score += points;
  chef.held = null;
  all(state).find((station): station is Sink => station instanceof Sink)?.dirty.push(new DirtyPlate());
  return ok(`Served order ${id}. +${points}`, [{ type: 'orderServed', order: id, dish: order.dish, station: belt.id, chef: chef.name, points }]);
}

// Every step: its form, what it does, and how it runs. The actions agents read and the parser both come from here.
export const steps: Record<string, { form: string; description: string; run: (state: State, chef: Chef, target: string) => Outcome | Promise<Outcome> }> = {
  walk: { form: 'walk <station>', description: 'Walk to the floor in front of a station. Other steps act only on the station you are at.', run: walk },
  move: { form: 'move <spot>', description: 'Give up the station you are at when you are done there: you go to a spot on the floor, away from the stations, and another chef can use the station. To get to a station, use walk.', run: move },
  take: { form: 'take <station>', description: 'Take food from a crate, a plate from the plates, or what is on a station. If you hold a plate, ready food goes onto it.', run: take },
  put: { form: 'put <station>', description: 'Put down what you hold: anything on a counter, food to cut on a board, food to cook on a stove. Ready food put where a plate is goes onto the plate. The bin throws food away and empties a plate.', run: put },
  cut: { form: 'cut <station>', description: 'Cut what is on a board, with empty hands. You keep cutting until it is cut.', run: work('cut') },
  wash: { form: 'wash <station>', description: 'Wash a dirty plate at the sink, with empty hands. It joins the clean plates.', run: work('wash') },
  spray: { form: 'spray <station>', description: 'Put out a fire, holding the extinguisher. You keep spraying until it is out.', run: work('spray') },
  shoo: { form: 'shoo <station>', description: 'Chase a rat off a station, with empty hands.', run: work('shoo') },
  deliver: { form: 'deliver <order>', description: 'At a delivery belt, hand over your plate for an open order. The plate must hold exactly that dish.', run: deliver },
};

export function act(state: State, player: PlayerRef, text: string): Outcome | Promise<Outcome> {
  const [name = '', target = ''] = text.trim().split(/\s+/);
  const entry = steps[name.toLowerCase()];
  if (!entry) return refuse(`Unknown step "${name}". Steps: ${Object.keys(steps).join(', ')}.`);
  if (state.phase !== 'service') return refuse(state.phase === 'lobby' ? 'Service has not started.' : 'Service is over.');
  const chef = state.chefs.find(each => each.id === player.id);
  if (!chef) return refuse('You are not in the kitchen.');
  if (!target) return refuse(`Say which: ${entry.form}.`);
  return entry.run(state, chef, target);
}

// Ends a chef's step under way where it is: a walk stops on the cell they reached, and work keeps what is done.
export function stop(state: State, player: PlayerRef) {
  const chef = state.chefs.find(each => each.id === player.id);
  if (!chef?.task) return;
  chef.path = [];
  finish(chef, ok(chef.task.doing === 'walk' ? 'You stopped walking.' : `You stopped work at ${chef.task.station.id}.`));
}

// A new order for a dish picked at random, open for that dish's seconds.
function placeOrder(state: State): KitchenEvent {
  const dish = pick(Object.keys(dishes) as DishName[]) ?? 'salad';
  const { seconds } = dishes[dish];
  const order = { id: `o${++state.ordersMade}`, dish, seconds, left: seconds };
  state.orders.push(order);
  state.orderIn = service.orders.every;
  return { type: 'orderPlaced', order: order.id, dish };
}

// ── Time ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function finish(chef: Chef, outcome: Outcome) {
  const task = chef.task;
  chef.task = null;
  chef.working = null;
  task?.finish(outcome);
}

// Moves the kitchen on by `seconds`: walks, work, every station's own time, fires spreading, rats, orders and the
// clock. Returns the events, or nothing when nothing anyone can see changed.
export function tick(state: State, seconds: number): { events: KitchenEvent[]; over: boolean } | null {
  if (state.phase !== 'service') return null;
  const events: KitchenEvent[] = [];
  let changed = false;

  // Walking: a cell every 1 / speed seconds, facing the way they go, and the station once they arrive.
  for (const chef of state.chefs) {
    const task = chef.task;
    if (task?.doing !== 'walk') continue;
    chef.stepIn -= seconds;
    while (chef.path.length && chef.stepIn <= 0) {
      const next = chef.path.shift() as Cell;
      chef.facing = directionNames.find(direction => same(step(chef, direction), next)) ?? chef.facing;
      Object.assign(chef, next);
      chef.stepIn += 1 / chefRules.speed;
      changed = true;
    }
    if (!chef.path.length) {
      finish(chef, task.arrive());
      changed = true;
    }
  }

  // Work: the station does the chef's step, a little more each tick.
  for (const chef of state.chefs) {
    const task = chef.task;
    if (!task || task.doing === 'walk') continue;
    const result = task.station.work(task.doing, seconds, chef);
    if (result.status === 'working') continue;
    events.push(...(result.events ?? []));
    finish(chef, result.status === 'done' ? ok(result.message) : refuse(result.message));
    changed = true;
  }

  // Every station's own time; a fire that is ready spreads to a neighbouring station that can burn.
  for (const station of all(state)) {
    const result = station.tick(seconds);
    events.push(...result.events);
    changed ||= result.changed || result.events.length > 0;
    if (!result.spreads) continue;
    const next = pick(all(state).filter(other => other.flammable && !other.fire
      && Math.abs(other.place.x - station.place.x) + Math.abs(other.place.y - station.place.y) === 1));
    if (!next) continue;
    next.ignite();
    events.push({ type: 'fireSpread', from: station.id, station: next.id });
    changed = true;
  }

  // A chef working where a fire has started stops, unless they are putting it out.
  for (const chef of state.chefs) {
    const task = chef.task;
    if (task && task.doing !== 'walk' && task.doing !== 'spray' && task.station.fire) finish(chef, refuse(`${task.station.id} caught fire.`));
  }

  // A rat climbs onto a station with food on it.
  state.ratIn -= seconds;
  if (state.ratIn <= 0) {
    state.ratIn = ratGap(state.ratSeconds);
    const target = pick(all(state).filter(station => station.ratsClimb && station.hasFood() && !station.rat && !station.fire));
    if (target) {
      target.climb();
      events.push({ type: 'ratArrived', station: target.id });
      changed = true;
    }
  }

  // Orders run out, and new ones come in.
  for (const order of state.orders) order.left -= seconds;
  for (const order of state.orders.filter(each => each.left <= 0)) {
    state.orders = state.orders.filter(each => each !== order);
    state.score -= service.orders.missedPenalty;
    events.push({ type: 'orderMissed', order: order.id, dish: order.dish, penalty: service.orders.missedPenalty });
    changed = true;
  }
  state.orderIn -= seconds;
  if (state.orderIn <= 0 && state.orders.length < service.orders.open) {
    events.push(placeOrder(state));
    changed = true;
  }

  if (state.left !== null) state.left -= seconds;
  const over = state.left !== null && state.left <= 0;
  return changed || over ? { events, over } : null;
}

// ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────

const chefView = ({ id, name, seat, x, y, facing, working, held, at: station, spot }: Chef): ChefView => ({
  id, name, seat, x, y, facing, working, at: station?.id ?? null, spot, hands: viewOf(held),
});

// Nothing in the kitchen is secret: every chef sees what the page sees, and themselves as `you`.
// Times are whole seconds left, rounded up, so one shows until it has fully run out.
const secondsLeft = (seconds: Seconds) => Math.max(0, Math.ceil(seconds));

export function view(state: State, playerId: string | null): PageView | ChefOwnView {
  const workingAt = new Set(state.chefs.flatMap(chef => (chef.task && chef.task.doing !== 'walk' ? [chef.task.station] : [])));
  const page: PageView = {
    phase: state.phase,
    score: state.score,
    ...(state.left !== null && { left: secondsLeft(state.left) }),
    orders: state.orders.map(order => ({ ...order, left: secondsLeft(order.left) })),
    chefs: state.chefs.map(chefView),
    stations: Object.fromEntries(all(state).map(station => [station.id, station.view(workingAt.has(station))])),
    spots: Object.fromEntries(spots.map(({ id, x, y }) => [id, { x, y, chef: state.chefs.find(chef => chef.spot === id)?.name ?? null }])),
  };
  const you = state.chefs.find(chef => chef.id === playerId);
  return you ? { ...page, you: chefView(you) } : page;
}
